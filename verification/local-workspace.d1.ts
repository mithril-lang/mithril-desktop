// @vitest-environment node
import { beforeAll, afterAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localEnv } from "../../mithril-fund/packages/testing/src/d1";
import {
  createApiToken,
  nowSec,
} from "../../mithril-fund/packages/server/src/index";
import { app } from "../../mithril-fund/apps/api/src/index";
import type { Env } from "../../mithril-fund/apps/api/src/env";
import { CloudWorkspace } from "../src/main/cloud-workspace";
import { LocalWorkspace } from "../src/main/local-workspace";
type QAGlobal = {
  qaStartupError?: string;
  qaStartupStage?: string;
  workspaceQA: { local: LocalWorkspace; online(): void };
};
let env: Env, dispose: () => Promise<void>;
const roots: string[] = [],
  services: LocalWorkspace[] = [];
beforeAll(async () => {
  const proxy = await localEnv<Env>(
    new URL("../../mithril-fund/apps/api/wrangler.jsonc", import.meta.url)
      .pathname,
  );
  env = proxy.env as Env;
  dispose = proxy.dispose;
}, 90000);
afterAll(async () => {
  for (const service of services) service.close();
  await dispose?.();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
async function device(owner: string): Promise<{
  service: LocalWorkspace;
  offline(): void;
  online(): void;
  lose(): void;
}> {
  const token = await createApiToken(env.DB, owner, [
    "workspace:read",
    "workspace:write",
  ]);
  let online = true,
    lost = false;
  const remote = new CloudWorkspace({
    token: () => token.token,
    profile: () => "default",
    origin: () => "https://api.mithril.fund",
    changed: () => {},
    fetch: async (url, init) => {
      if (!online) throw Error("offline");
      const response = await app.request(
        new Request(String(url), init),
        undefined,
        env,
      );
      if (lost && String(url).endsWith("/workspace/operations")) {
        lost = false;
        throw Error("response lost after D1 commit");
      }
      return response;
    },
  });
  const root = mkdtempSync(join(tmpdir(), "mithril-real-d1-device-"));
  roots.push(root);
  const service = new LocalWorkspace(
    join(root, "workspace.sqlite"),
    () => token.token.slice(-10),
    remote,
  );
  services.push(service);
  await service.enable();
  await service.sync();
  expect(
    service.syncStatus(),
    JSON.stringify(service.syncStatus()),
  ).toMatchObject({ ready: true, phase: "synced" });
  return {
    service,
    offline: () => {
      online = false;
    },
    online: () => {
      online = true;
    },
    lose: () => {
      lost = true;
    },
  };
}
// @lat: [[local-workspace#Local SQLite workspace#Canonical D1 verification]]
it("runs independent SQLite devices through the canonical Worker and actual local D1, with offline edits and lost acknowledgements", async () => {
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID();
  for (const id of [owner, other])
    await env.DB.prepare("INSERT INTO users(id,created_at) VALUES(?,?)")
      .bind(id, nowSec())
      .run();
  const a = await device(owner),
    b = await device(owner),
    outsider = await device(other);
  const operationId = crypto.randomUUID(),
    id = crypto.randomUUID();
  a.offline();
  a.service.applyOperations(
    [
      {
        operationId,
        id,
        kind: "project",
        baseRevision: 0,
        data: { title: "D1 offline proof" },
        deleted: false,
        datasetGeneration: 0,
      },
    ],
    owner,
  );
  await a.service.sync();
  expect(a.service.syncStatus()).toMatchObject({
    phase: "offline",
    pending: 1,
  });
  expect(a.service.getSnapshot().records[0].data.title).toBe(
    "D1 offline proof",
  );
  a.online();
  a.lose();
  await a.service.sync();
  expect(a.service.syncStatus().pending).toBe(1);
  await a.service.sync();
  await b.service.sync();
  await outsider.service.sync();
  expect(a.service.syncStatus().pending).toBe(0);
  expect(
    b.service.getSnapshot().records.find((row) => row.id === id),
  ).toMatchObject({ revision: 1, data: { title: "D1 offline proof" } });
  expect(outsider.service.getSnapshot().records).toEqual([]);
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM workspace_history WHERE user_id=? AND operation_id=?",
  )
    .bind(owner, operationId)
    .first<{ count: number }>();
  expect(count?.count).toBe(1);
  b.offline();
  b.service.repositoryApply({
    operationId: crypto.randomUUID(),
    collection: "task",
    id: "d1-task",
    baseRevision: 0,
    deleted: false,
    body: { title: "Offline Kanban", status: "todo" },
    datasetGeneration: 0,
  });
  await b.service.sync();
  b.online();
  await b.service.sync();
  await a.service.sync();
  await expect
    .poll(
      async () => {
        await a.service.sync();
        return a.service.repositoryPage("task").documents[0]?.body;
      },
      { timeout: 20000 },
    )
    .toEqual({ title: "Offline Kanban", status: "todo" });
}, 90000);

// @lat: [[local-workspace#Local SQLite workspace#Electron screen verification]]
it.skipIf(process.env.RUN_ELECTRON_SQLITE_QA !== "1")(
  "opens actual Desktop Projects in two Electron windows, renders cached data offline, and synchronizes an offline UI edit",
  async () => {
    const { createServer } = await import("node:http");
    const { writeFileSync, copyFileSync, mkdirSync, symlinkSync } =
      await import("node:fs");
    const { build: bundle } = await import("esbuild");
    const { build } = await import("vite");
    const { default: react } = await import("@vitejs/plugin-react");
    const { _electron } = await import("playwright");
    const root = mkdtempSync(join(tmpdir(), "mithril-sqlite-electron-"));
    roots.push(root);
    const fixture = new URL("./electron-ui/", import.meta.url).pathname;
    const owner = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users(id,created_at) VALUES(?,?)")
      .bind(owner, nowSec())
      .run();
    const token = await createApiToken(env.DB, owner, [
      "workspace:read",
      "workspace:write",
    ]);
    await app.request(
      "/v1/workspace/operations",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + token.token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          operations: [
            {
              operationId: crypto.randomUUID(),
              id: "cached-project",
              kind: "project",
              baseRevision: 0,
              data: { title: "ローカルから即表示するプロジェクト" },
              deleted: false,
            },
          ],
        }),
      },
      env,
    );
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await app.request(
        new Request("https://api.mithril.fund" + req.url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
        }),
        undefined,
        env,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const endpoint =
      "http://127.0.0.1:" + (server.address() as { port: number }).port;
    let desktop: Awaited<ReturnType<typeof _electron.launch>> | undefined;
    try {
      await build({
        configFile: false,
        root: fixture,
        base: "./",
        plugins: [react()],
        resolve: {
          dedupe: [
            "react",
            "react-dom",
            "three",
            "@react-three/fiber",
            "@react-three/drei",
          ],
        },
        build: { outDir: join(root, "renderer"), emptyOutDir: true },
        logLevel: "error",
      });
      await bundle({
        entryPoints: [join(fixture, "main.ts")],
        outfile: join(root, "main.cjs"),
        platform: "node",
        format: "cjs",
        bundle: true,
        external: ["electron", "better-sqlite3"],
        logLevel: "silent",
      });
      copyFileSync(join(fixture, "preload.cjs"), join(root, "preload.cjs"));
      mkdirSync(join(root, "userData"));
      symlinkSync(
        new URL("../node_modules", import.meta.url).pathname,
        join(root, "node_modules"),
        "dir",
      );
      desktop = await _electron.launch({
        args: [join(root, "main.cjs")],
        env: {
          ...process.env,
          NODE_PATH: new URL("../node_modules", import.meta.url).pathname,
          WORKSPACE_QA_HOME: join(root, "userData"),
          WORKSPACE_QA_TOKEN: token.token,
          WORKSPACE_QA_ENDPOINT: endpoint,
        },
        timeout: 60000,
      });
      await expect
        .poll(
          async () =>
            await desktop!.evaluate(
              () =>
                (globalThis as unknown as QAGlobal).qaStartupError ||
                (globalThis as unknown as QAGlobal).qaStartupStage,
            ),
          { timeout: 60000 },
        )
        .toBe("windows");
      const startupError = await desktop.evaluate(
        () => (globalThis as unknown as QAGlobal).qaStartupError,
      );
      if (startupError) throw Error(startupError);
      const first = await desktop.firstWindow();
      const errors: string[] = [];
      first.on("pageerror", (error) => errors.push(error.message));
      await expect
        .poll(() => desktop!.windows().length, { timeout: 30000 })
        .toBe(2);
      const second = desktop.windows()[1];
      await first
        .getByRole("heading", { name: "ローカルから即表示するプロジェクト" })
        .waitFor();
      await first.setViewportSize({ width: 960, height: 700 });
      const started = Date.now();
      await first.reload();
      await first
        .getByRole("heading", { name: "ローカルから即表示するプロジェクト" })
        .waitFor();
      const cachedDisplayMs = Date.now() - started;
      await first
        .getByRole("button", { name: "Close page", exact: true })
        .click();
      const navigationStarted = Date.now();
      await first
        .getByRole("button", { name: "Open Projects", exact: true })
        .click();
      await first
        .getByRole("heading", { name: "ローカルから即表示するプロジェクト" })
        .waitFor();
      const cachedNavigationMs = Date.now() - navigationStarted;
      expect(await first.getByText("Connecting to Cloud…").isVisible()).toBe(
        false,
      );
      await first
        .getByLabel("タイトル", { exact: true })
        .fill("オフラインで保存した編集");
      await first
        .getByLabel("説明", { exact: true })
        .fill("SQLite と送信待ちキューへ保存");
      await first
        .getByRole("button", { name: "保存して同期", exact: true })
        .click();
      await first
        .getByRole("heading", { name: "オフラインで保存した編集" })
        .waitFor();
      await second
        .getByRole("heading", { name: "オフラインで保存した編集" })
        .waitFor({ timeout: 12000 });
      const queued = await desktop.evaluate(() =>
        (globalThis as unknown as QAGlobal).workspaceQA.local.syncStatus(),
      );
      expect(queued).toMatchObject({ phase: "offline", pending: 1 });
      const output = process.env.WORKSPACE_QA_OUTPUT;
      if (output) {
        mkdirSync(output, { recursive: true });
        await first.screenshot({
          path: join(output, "desktop-sqlite-offline.png"),
          fullPage: true,
        });
      }
      await desktop.evaluate(async () => {
        const qa = (globalThis as unknown as QAGlobal).workspaceQA;
        qa.online();
        await qa.local.sync();
      });
      const row = await env.DB.prepare(
        "SELECT data FROM workspace_records WHERE user_id=? AND kind='project' AND json_extract(data,'$.title')=?",
      )
        .bind(owner, "オフラインで保存した編集")
        .first<{ data: string }>();
      expect(JSON.parse(row!.data).title).toBe("オフラインで保存した編集");
      expect(errors).toEqual([]);
      if (output)
        writeFileSync(
          join(output, "electron-sqlite-qa.json"),
          JSON.stringify(
            {
              cachedDisplayMs,
              cachedNavigationMs,
              windows: 2,
              offlineUiEdit: true,
              sharedWindowRead: true,
              canonicalD1ReadBack: true,
              errors,
            },
            null,
            2,
          ),
        );
    } finally {
      await desktop?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  180000,
);

// @lat: [[local-workspace#Local SQLite workspace#Physical remote device verification]]
it.skipIf(process.env.RUN_GAD_SQLITE_QA !== "1")(
  "synchronizes a physical gad host with Mac through canonical local D1, including remote offline restart",
  async () => {
    const { createServer } = await import("node:http");
    const { mkdirSync, copyFileSync, cpSync, writeFileSync } =
      await import("node:fs");
    const { build } = await import("esbuild");
    const { execFile, spawn } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execute = promisify(execFile);
    const root = mkdtempSync(join(tmpdir(), "mithril-gad-sqlite-"));
    roots.push(root);
    const remoteRoot = "/tmp/mithril-sqlite-qa-" + crypto.randomUUID();
    const owner = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users(id,created_at) VALUES(?,?)")
      .bind(owner, nowSec())
      .run();
    const token = await createApiToken(env.DB, owner, [
      "workspace:read",
      "workspace:write",
    ]);
    const mac = await device(owner);
    mac.service.applyOperations([
      {
        operationId: crypto.randomUUID(),
        id: "mac-to-gad",
        kind: "project",
        baseRevision: 0,
        data: { title: "Mac to gad" },
        deleted: false,
      },
    ]);
    await mac.service.sync();
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await app.request(
        new Request("https://api.mithril.fund" + req.url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
        }),
        undefined,
        env,
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    const remotePort = 24000 + Math.floor(Math.random() * 10000);
    let tunnel: ReturnType<typeof spawn> | undefined;
    try {
      await build({
        entryPoints: [new URL("./remote-device.ts", import.meta.url).pathname],
        outfile: join(root, "remote.cjs"),
        platform: "node",
        format: "cjs",
        bundle: true,
        external: ["better-sqlite3"],
        logLevel: "silent",
      });
      const moduleRoot = new URL(
        "../node_modules/better-sqlite3/",
        import.meta.url,
      ).pathname;
      const target = join(root, "node_modules", "better-sqlite3");
      mkdirSync(join(target, "prebuilds"), { recursive: true });
      cpSync(join(moduleRoot, "lib"), join(target, "lib"), { recursive: true });
      copyFileSync(
        join(moduleRoot, "package.json"),
        join(target, "package.json"),
      );
      copyFileSync(
        join(moduleRoot, "prebuilds", "linux-x64.node"),
        join(target, "prebuilds", "linux-x64.node"),
      );
      await execute("ssh", [
        "-o",
        "BatchMode=yes",
        "gad",
        "mkdir -m 700 " + remoteRoot,
      ]);
      await execute(
        "scp",
        [
          "-r",
          join(root, "remote.cjs"),
          join(root, "node_modules"),
          "gad:" + remoteRoot + "/",
        ],
        {
          timeout: 30000,
        },
      );
      tunnel = spawn(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "ExitOnForwardFailure=yes",
          "-N",
          "-R",
          `${remotePort}:127.0.0.1:${port}`,
          "gad",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (tunnel.exitCode !== null) throw Error("QA SSH reverse tunnel failed");
      const command = `docker run --rm -i --user=1000:1000 --read-only --tmpfs /tmp --network=host --cpus=1 --memory=512m --pids-limit=128 --cap-drop=ALL --security-opt=no-new-privileges --mount type=bind,src=${remoteRoot},dst=/work --workdir /work mithril-ci-app-runtime:2d3080845faa7ed9 node remote.cjs`;
      const child = spawn("ssh", ["-o", "BatchMode=yes", "gad", command], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdin.end(
        JSON.stringify({
          token: token.token,
          owner,
          endpoint: `http://127.0.0.1:${remotePort}`,
        }),
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const code = await new Promise<number | null>((resolve) =>
        child.on("exit", resolve),
      );
      expect(code, stderr).toBe(0);
      const report = JSON.parse(stdout);
      expect(report).toMatchObject({
        macToRemote: true,
        offlineRestart: true,
        remoteToD1: true,
      });
      await expect
        .poll(
          async () => {
            await mac.service.sync();
            return mac.service
              .getSnapshot()
              .records.some(
                (r) => r.data.title === "gad to Mac after offline restart",
              );
          },
          { timeout: 20000 },
        )
        .toBe(true);
      const count = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM workspace_history WHERE user_id=? AND operation_id=?",
      )
        .bind(owner, "gad-offline-op")
        .first<{ count: number }>();
      expect(count?.count).toBe(1);
      if (process.env.WORKSPACE_QA_OUTPUT)
        writeFileSync(
          join(process.env.WORKSPACE_QA_OUTPUT, "gad-sqlite-qa.json"),
          JSON.stringify(
            {
              ...report,
              remoteToMac: true,
              canonicalD1HistoryRows: count?.count,
            },
            null,
            2,
          ),
        );
    } finally {
      tunnel?.kill();
      await execute("ssh", [
        "-o",
        "BatchMode=yes",
        "gad",
        "rm -rf -- " + remoteRoot,
      ]).catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  180000,
);
