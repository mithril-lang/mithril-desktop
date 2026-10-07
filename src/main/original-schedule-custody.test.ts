import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { CloudWorkspace } from "./cloud-workspace";
import type { OriginalScheduleCustodyCommand } from "./original-schedule-custody";

const scopes = ["workspace:read", "workspace:write", "chat:write", "inference"];
const occurrence = {
  profile: "default",
  jobId: "original-job",
  scheduledInstant: "2026-10-07T00:17:00.000001+00:00",
  operationId: "original-operation",
  sourceRevision: 2,
  sourceDigest: "a".repeat(64),
  authorityRevision: 1,
};
interface Peer {
  cloud: CloudWorkspace;
  calls: { path: string; token: string; command: Record<string, unknown> }[];
  mode(value: string): void;
  allowed(value: string[]): void;
  identity(value: "a" | "b", profile?: string): void;
  paused(): Promise<void>;
  release(): void;
  close(): Promise<void>;
}
async function peer(): Promise<Peer> {
  const calls: {
    path: string;
    token: string;
    command: Record<string, unknown>;
  }[] = [];
  let mode = "normal",
    allowed = scopes,
    token = `mf_${"a".repeat(43)}`,
    profile = "default";
  let paused: (() => void) | undefined, response: ServerResponse | undefined;
  const server = createServer(async (req, res) => {
    const auth = req.headers.authorization ?? "";
    const userId = auth.includes("b".repeat(43)) ? "b" : "a";
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/me") {
      res.end(
        JSON.stringify({
          via: "api_token",
          scopes: allowed,
          user: { id: userId },
        }),
      );
      return;
    }
    let text = "";
    for await (const bytes of req) text += bytes.toString();
    const command = JSON.parse(text);
    calls.push({ path: req.url!, token: auth, command });
    const receipt: Record<string, unknown> = {
      userId,
      profile: command.profile,
    };
    if (command.action === "status" || command.action === "select")
      Object.assign(receipt, {
        selected: true,
        revision:
          command.action === "select" ? command.expectedRevision + 1 : 1,
      });
    else if (command.action === "claim")
      Object.assign(receipt, {
        operationId: command.operationId,
        status: "admitted",
        fresh: mode !== "replay",
      });
    else
      Object.assign(receipt, {
        operationId: command.operationId,
        changed: mode !== "replay",
      });
    if (mode === "foreign") receipt.userId = "foreign-owner";
    if (mode === "profile") receipt.profile = "other-profile";
    if (mode === "extra") receipt.private = "private-response";
    if (mode === "status-array") {
      receipt.status = ["admitted"];
      receipt.fresh = false;
    }
    if (mode === "lost") {
      res.destroy();
      return;
    }
    if (mode === "redirect") {
      res.writeHead(307, { location: "/credential-leak" });
      res.end();
      return;
    }
    if (mode === "oversize") {
      res.write(" ".repeat(9000));
      res.end(JSON.stringify(receipt));
      return;
    }
    if (mode === "pause") {
      response = res;
      res.write(" ");
      paused?.();
      return;
    }
    res.end(JSON.stringify(receipt));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing test peer");
  const cloud = new CloudWorkspace({
    token: () => token,
    profile: () => profile,
    origin: () => `http://127.0.0.1:${address.port}`,
    fetch: (input, init) => fetch(input, init),
    changed: () => {},
  });
  return {
    cloud,
    calls,
    mode: (v: string) => {
      mode = v;
    },
    allowed: (v: string[]) => {
      allowed = v;
    },
    identity: (v: "a" | "b", p = "default") => {
      token = `mf_${v.repeat(43)}`;
      profile = p;
    },
    paused: () =>
      new Promise<void>((resolve) => {
        paused = resolve;
      }),
    release: () =>
      response?.end(
        JSON.stringify({
          userId: "a",
          profile: "default",
          selected: true,
          revision: 1,
        }),
      ),
    close: async () => {
      response?.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

// @lat: [[cloud-workspace-tests#Original schedule main execution receipts]]
it("uses current A/B/A identity and exact original occurrence, refusing foreign, oversized and lost receipts without retry", async () => {
  const p = await peer();
  try {
    for (const owner of ["a", "b", "a"] as const) {
      p.identity(owner);
      await p.cloud.enable();
      expect(
        await p.cloud.originalScheduleCustody({
          action: "status",
          profile: "default",
        }),
      ).toEqual({
        userId: owner,
        profile: "default",
        selected: true,
        revision: 1,
      });
      await p.cloud.originalScheduleCustody({
        action: "select",
        profile: "default",
        expectedRevision: 1,
      });
      const claim = await p.cloud.originalScheduleCustody({
        action: "claim",
        ...occurrence,
      });
      expect(claim).toMatchObject({
        userId: owner,
        fresh: true,
        operationId: occurrence.operationId,
      });
      expect(p.calls.at(-1)).toEqual({
        path: "/v1/schedules/original/execution",
        token: `Bearer mf_${owner.repeat(43)}`,
        command: { action: "claim", ...occurrence },
      });
    }
    for (const mode of [
      "foreign",
      "profile",
      "extra",
      "oversize",
      "lost",
      "redirect",
    ]) {
      p.mode(mode);
      const count = p.calls.length;
      await expect(
        p.cloud.originalScheduleCustody({
          action: "transition",
          ...occurrence,
          from: "admitted",
          to: "running",
        }),
      ).rejects.toThrow(
        ["lost", "redirect"].includes(mode)
          ? "network unavailable"
          : "receipt unconfirmed",
      );
      expect(p.calls).toHaveLength(count + 1);
    }
    p.mode("replay");
    expect(
      await p.cloud.originalScheduleCustody({ action: "claim", ...occurrence }),
    ).toMatchObject({ fresh: false });
    expect(
      await p.cloud.originalScheduleCustody({
        action: "transition",
        ...occurrence,
        from: "admitted",
        to: "running",
      }),
    ).toMatchObject({ changed: false });
    p.mode("status-array");
    const count = p.calls.length;
    await expect(
      p.cloud.originalScheduleCustody({ action: "claim", ...occurrence }),
    ).rejects.toThrow("receipt unconfirmed");
    expect(p.calls).toHaveLength(count + 1);
  } finally {
    await p.close();
  }
});

// @lat: [[cloud-workspace-tests#Original schedule main execution identity fence]]
it("requires existing scopes and rejects supplied identities or changed accounts while a receipt is streaming", async () => {
  const p = await peer();
  try {
    p.allowed(["workspace:read", "workspace:write"]);
    await p.cloud.enable();
    await expect(
      p.cloud.originalScheduleCustody({ action: "status", profile: "default" }),
    ).rejects.toThrow("execution authorization required");
    expect(p.calls).toHaveLength(0);
    p.allowed(scopes);
    const invalid = [
      { action: "status", profile: "other" },
      { action: "status", profile: "default", owner: "spoofed" },
      {
        action: "select",
        profile: "default",
        expectedRevision: Number.MAX_SAFE_INTEGER,
      },
      { action: "claim", ...occurrence, executorId: "spoofed" },
      { action: "claim", ...occurrence, sourceRevision: true },
      {
        action: "claim",
        ...occurrence,
        scheduledInstant: "2026-02-30T00:17:00+00:00",
      },
      {
        action: "transition",
        ...occurrence,
        from: "admitted",
        to: "completed",
      },
    ];
    for (const command of invalid)
      await expect(
        p.cloud.originalScheduleCustody(
          command as OriginalScheduleCustodyCommand,
        ),
      ).rejects.toThrow("Invalid original");
    expect(p.calls).toHaveLength(0);
    for (const change of [
      () => p.identity("b"),
      () => p.identity("a", "other"),
    ]) {
      p.identity("a");
      p.mode("pause");
      await p.cloud.enable();
      const waiting = p.paused();
      const result = p.cloud.originalScheduleCustody({
        action: "status",
        profile: "default",
      });
      const rejected = expect(result).rejects.toThrow("account changed");
      await waiting;
      change();
      p.release();
      await rejected;
    }
    expect(p.calls).toHaveLength(2);
  } finally {
    await p.close();
  }
});
