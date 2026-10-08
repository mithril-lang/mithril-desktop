import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  readdir,
  symlink,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  digestBytes,
  manifestBytes,
  fileFingerprint,
  type FileManifest,
  type ProjectFileTransport,
} from "@mithril/workspace/files";
import type {
  WorkspaceRecord,
  WorkspaceOperation,
} from "@mithril/workspace/protocol";
import { ProjectFolderSync } from "./project-folder-sync";

interface Fixture {
  root: string;
  files: ProjectFileTransport;
  chunks: Map<string, Uint8Array>;
  manifests: Map<string, FileManifest>;
  operations: WorkspaceOperation[];
  deps(state: string): ConstructorParameters<typeof ProjectFolderSync>[0];
  owner(userId: string): void;
  loseAck(): void;
  restore(): void;
  remote(text: string): Promise<void>;
}
async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "mithril-file-test-"));
  await mkdir(join(root, "a"));
  await mkdir(join(root, "b"));
  let identity = {
    userId: "alice",
    profile: "default",
    actor: "token",
    epoch: 0,
  };
  const chunks = new Map<string, Uint8Array>(),
    manifests = new Map<string, FileManifest>(),
    operations: WorkspaceOperation[] = [];
  let pointer: WorkspaceRecord | undefined,
    loseAck = false,
    datasetGeneration = 0;
  const files: ProjectFileTransport = {
    status: async () => ({ configured: true }),
    putChunk: async (_p, b) => {
      const d = await digestBytes(b);
      chunks.set(d, new Uint8Array(b));
      return d;
    },
    getChunk: async (_p, d) => chunks.get(d)!,
    putManifest: async (m) => {
      const d = await digestBytes(manifestBytes(m));
      manifests.set(d, structuredClone(m));
      return d;
    },
    getManifest: async (_p, d) => structuredClone(manifests.get(d)!),
  };
  const deps = (
    state: string,
  ): ConstructorParameters<typeof ProjectFolderSync>[0] => ({
    stateDir: join(root, state),
    context: async () => identity,
    snapshot: async () => ({
      datasetGeneration,
      records: [
        {
          id: "p",
          kind: "project",
          revision: 1,
          data: { title: "QA" },
          deleted: false,
          updatedAt: 1,
        },
        ...(pointer ? [pointer] : []),
      ] as WorkspaceRecord[],
    }),
    files,
    apply: async (op: WorkspaceOperation) => {
      if ((op.datasetGeneration ?? 0) !== datasetGeneration)
        throw Error("Old dataset operation");
      operations.push(structuredClone(op));
      if (pointer?.revision === op.baseRevision || !pointer) {
        pointer = { ...op, revision: op.baseRevision + 1, updatedAt: 1 };
      } else if (pointer.data.manifest !== op.data.manifest)
        return { status: "conflict" };
      if (loseAck) {
        loseAck = false;
        throw new Error("Connection lost after save");
      }
      return { status: "accepted" };
    },
  });
  return {
    root,
    files,
    chunks,
    manifests,
    operations,
    deps,
    owner: (userId: string) => {
      identity = { ...identity, userId, epoch: identity.epoch + 1 };
    },
    loseAck: () => {
      loseAck = true;
    },
    restore: () => {
      datasetGeneration++;
    },
    remote: async (text: string) => {
      const bytes = new TextEncoder().encode(text),
        d = await files.putChunk("p", bytes),
        m = {
          version: 1 as const,
          projectId: "p",
          files: [
            {
              path: "hello.txt",
              size: bytes.length,
              chunks: [d],
              digest: await fileFingerprint(bytes.length, [d]),
            },
          ],
        };
      const md = await files.putManifest(m);
      pointer = {
        id: pointer!.id,
        kind: "file_set",
        revision: pointer!.revision + 1,
        data: { projectId: "p", manifest: md },
        deleted: false,
        updatedAt: 1,
      };
    },
  };
}
describe("selected project folder synchronization", () => {
  // @lat: [[cloud-workspace#Cloud workspace#Project folder bytes]]
  it("round trips text and binary between devices, preserves excluded files, and pauses simultaneous edits", async () => {
    const f = await fixture(),
      a = new ProjectFolderSync(f.deps("state-a")),
      b = new ProjectFolderSync(f.deps("state-b"));
    await writeFile(join(f.root, "a", "hello.txt"), "hello");
    await writeFile(join(f.root, "a", "data.bin"), new Uint8Array([0, 255, 9]));
    await writeFile(join(f.root, "a", ".env"), "PRIVATE");
    const preview = await a.preview("p", join(f.root, "a"));
    expect(preview).toMatchObject({ count: 2, excluded: 1 });
    await a.connect("p", preview.ticket);
    await a.tick();
    await b.connect("p", (await b.preview("p", join(f.root, "b"))).ticket);
    await b.tick();
    expect(await readFile(join(f.root, "b", "hello.txt"), "utf8")).toBe(
      "hello",
    );
    expect(
      new Uint8Array(await readFile(join(f.root, "b", "data.bin"))),
    ).toEqual(new Uint8Array([0, 255, 9]));
    await writeFile(join(f.root, "a", "hello.txt"), "from A");
    await a.tick();
    await b.tick();
    expect(await readFile(join(f.root, "b", "hello.txt"), "utf8")).toBe(
      "from A",
    );
    await writeFile(join(f.root, "b", "hello.txt"), "local B");
    await f.remote("remote C");
    await b.tick();
    expect((await b.status("p")).error).toContain("Concurrent edits");
    expect(await readFile(join(f.root, "b", "hello.txt"), "utf8")).toBe(
      "local B",
    );
    expect(await readFile(join(f.root, "a", ".env"), "utf8")).toBe("PRIVATE");
  });
  it("persists the operation ID across a lost acknowledgement and restart and isolates accounts", async () => {
    const f = await fixture(),
      a = new ProjectFolderSync(f.deps("state"));
    await writeFile(join(f.root, "a", "hello.txt"), "hello");
    f.loseAck();
    await a.connect("p", (await a.preview("p", join(f.root, "a"))).ticket);
    await a.tick();
    expect((await a.status("p")).error).toContain("Connection lost");
    const old = f.operations[0];
    const restarted = new ProjectFolderSync(f.deps("state"));
    await restarted.tick();
    expect(f.operations[1].operationId).toBe(old.operationId);
    expect((await restarted.status("p")).error).toBeNull();
    f.owner("bob");
    expect(await restarted.status("p")).toEqual({
      connected: false,
      error: null,
    });
    const before = f.operations.length;
    await restarted.tick();
    expect(f.operations).toHaveLength(before);
  });
  it("ignores symlinks and keeps cloud removals recoverable locally", async () => {
    const f = await fixture(),
      a = new ProjectFolderSync(f.deps("state-a")),
      b = new ProjectFolderSync(f.deps("state-b"));
    await writeFile(join(f.root, "outside.txt"), "outside");
    await symlink(join(f.root, "outside.txt"), join(f.root, "a", "link.txt"));
    await writeFile(join(f.root, "a", "hello.txt"), "hello");
    expect((await a.preview("p", join(f.root, "a"))).excluded).toBe(1);
    await a.connect("p", (await a.preview("p", join(f.root, "a"))).ticket);
    await a.tick();
    await b.connect("p", (await b.preview("p", join(f.root, "b"))).ticket);
    await b.tick();
    await unlink(join(f.root, "a", "hello.txt"));
    await a.tick();
    await b.tick();
    expect(await readFile(join(f.root, "outside.txt"), "utf8")).toBe("outside");
    const trash = await readdir(join(f.root, "b", ".mithril-sync-trash"));
    expect(
      await readFile(
        join(f.root, "b", ".mithril-sync-trash", trash[0], "hello.txt"),
        "utf8",
      ),
    ).toBe("hello");
  });
  it("stopping during a download does not publish bytes or re-enable the folder", async () => {
    const f = await fixture(),
      a = new ProjectFolderSync(f.deps("state-a"));
    await writeFile(join(f.root, "a", "hello.txt"), "hello");
    await a.connect("p", (await a.preview("p", join(f.root, "a"))).ticket);
    await a.tick();
    let started!: () => void, release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const getChunk = f.files.getChunk;
    const deps = f.deps("state-b");
    deps.files = {
      ...f.files,
      getChunk: async (p, d) => {
        started();
        await gate;
        return getChunk(p, d);
      },
    };
    const b = new ProjectFolderSync(deps);
    await b.connect("p", (await b.preview("p", join(f.root, "b"))).ticket);
    const connecting = b.tick();
    const result = connecting.catch((error: unknown) => error);
    await waiting;
    await b.disconnect("p");
    release();
    await result;
    expect((await b.status("p")).connected).toBe(false);
    await expect(
      readFile(join(f.root, "b", "hello.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await b.tick();
    expect((await b.status("p")).connected).toBe(false);
  });
});

// @lat: [[cloud-workspace-tests#Project folder restoration generations]]
it("retains an old pending operation after restore and restart without rebasing or resending it", async () => {
  const f = await fixture(),
    sync = new ProjectFolderSync(f.deps("state"));
  await writeFile(join(f.root, "a", "hello.txt"), "saved local bytes");
  await sync.connect("p", (await sync.preview("p", join(f.root, "a"))).ticket);
  f.loseAck();
  await sync.tick();
  const pending = f.operations[0];
  expect(pending.datasetGeneration).toBe(0);
  f.restore();
  await f.remote("restored cloud bytes");
  const restarted = new ProjectFolderSync(f.deps("state"));
  await restarted.tick();
  expect(f.operations).toHaveLength(1);
  expect((await restarted.status("p")).error).toContain("retained for review");
  expect(await readFile(join(f.root, "a", "hello.txt"), "utf8")).toBe(
    "saved local bytes",
  );
  const stateFile = (await readdir(join(f.root, "state"))).find((name) =>
    name.endsWith(".json"),
  )!;
  const links = JSON.parse(
    await readFile(join(f.root, "state", stateFile), "utf8"),
  );
  expect(links[0].pending).toEqual(pending);
});

it("keeps pre-restore local edits while unchanged folders automatically receive restored bytes", async () => {
  const f = await fixture(),
    a = new ProjectFolderSync(f.deps("state-a")),
    b = new ProjectFolderSync(f.deps("state-b"));
  await writeFile(join(f.root, "a", "hello.txt"), "original");
  await a.connect("p", (await a.preview("p", join(f.root, "a"))).ticket);
  await a.tick();
  await b.connect("p", (await b.preview("p", join(f.root, "b"))).ticket);
  await b.tick();
  await writeFile(join(f.root, "a", "hello.txt"), "unsynchronized local edit");
  const before = f.operations.length;
  f.restore();
  await f.remote("restored");
  await a.tick();
  await b.tick();
  expect(f.operations).toHaveLength(before);
  expect(await readFile(join(f.root, "a", "hello.txt"), "utf8")).toBe(
    "unsynchronized local edit",
  );
  expect((await a.status("p")).error).toContain("retained for review");
  expect(await readFile(join(f.root, "b", "hello.txt"), "utf8")).toBe(
    "restored",
  );
  expect((await b.status("p")).error).toBeNull();
});

it("refuses a delayed file replacement when restoration happens during download", async () => {
  const f = await fixture(),
    a = new ProjectFolderSync(f.deps("state-a")),
    b = new ProjectFolderSync(f.deps("state-b"));
  await writeFile(join(f.root, "a", "hello.txt"), "original");
  await a.connect("p", (await a.preview("p", join(f.root, "a"))).ticket);
  await a.tick();
  await b.connect("p", (await b.preview("p", join(f.root, "b"))).ticket);
  const readChunk = f.files.getChunk;
  f.files.getChunk = async (project, digest) => {
    const bytes = await readChunk(project, digest);
    f.restore();
    return bytes;
  };
  const before = f.operations.length;
  await b.tick();
  expect((await b.status("p")).error).toContain("retained for review");
  await expect(readFile(join(f.root, "b", "hello.txt"))).rejects.toThrow(
    "ENOENT",
  );
  expect(f.operations).toHaveLength(before);
  expect(
    (await readdir(join(f.root, "b"))).filter((name) =>
      name.startsWith(".mithril-sync-"),
    ),
  ).toEqual([]);
});
