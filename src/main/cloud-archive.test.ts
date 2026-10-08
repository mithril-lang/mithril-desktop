import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeAccountArchive, fileArchiveSource } from "./cloud-archive";
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "mithril-archive-test-"));
  directories.push(path);
  return path;
}
function archive(snapshotId: string): { digest: string; bytes: Buffer } {
  const manifest = Buffer.from(
    JSON.stringify({
      format: "mithril-account-archive-v1",
      userId: "alice",
      snapshotId,
      createdAt: 1,
    }),
  );
  const digest = createHash("sha256").update(manifest).digest("hex");
  const entry = (name: string, bytes: Buffer): Buffer[] => {
    const h = Buffer.alloc(512);
    const text = (at: number, value: string): number => h.write(value, at);
    text(0, name);
    text(100, "0000600\0");
    text(108, "0000000\0");
    text(116, "0000000\0");
    text(124, bytes.length.toString(8).padStart(11, "0") + "\0");
    h.fill(32, 148, 156);
    text(156, "0");
    text(257, "ustar\0");
    text(263, "00");
    text(
      148,
      h
        .reduce((sum, b) => sum + b, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
    );
    return [h, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)];
  };
  return {
    digest,
    bytes: Buffer.concat([
      ...entry("manifest.json", manifest),
      ...entry(
        "receipt.json",
        Buffer.from(
          JSON.stringify({
            format: "mithril-account-export-v1",
            manifestDigest: digest,
          }),
        ),
      ),
      Buffer.alloc(1024),
    ]),
  };
}
it("disk slices are bounded and refuse account changes between I/O stages", async () => {
  const root = await directory(),
    path = join(root, "input.tar");
  await writeFile(path, Buffer.alloc(9 * 1024 * 1024));
  let current = true;
  const file = await fileArchiveSource(path, () => {
    if (!current) throw Error("changed");
  });
  try {
    expect((await file.source.slice(0, 512).arrayBuffer()).byteLength).toBe(
      512,
    );
    await expect(
      file.source.slice(0, 9 * 1024 * 1024).arrayBuffer(),
    ).rejects.toThrow("slice");
    current = false;
    await expect(file.source.slice(0, 512).arrayBuffer()).rejects.toThrow(
      "changed",
    );
  } finally {
    await file.close();
  }
});
it("native export saves actual tar bytes and retains the same snapshot after a failed download", async () => {
  const root = await directory(),
    destination = join(root, "backup.tar");
  let lost = true,
    expected: Buffer | null = null;
  const ids: string[] = [];
  const workspace = {
    nativeContext: vi.fn(async () => ({
      userId: "alice",
      profile: "default",
      epoch: 1,
      actor: "actor",
    })),
    assertNativeContext: vi.fn(),
    archiveRequest: vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/backups")) {
        const { snapshotId } = JSON.parse(String(init?.body));
        ids.push(snapshotId);
        const file = archive(snapshotId);
        expected = file.bytes;
        return Response.json({
          schemaVersion: 1,
          userId: "alice",
          snapshotId,
          digest: file.digest,
          status: "sealed",
        });
      }
      if (lost) {
        lost = false;
        throw Error("lost download");
      }
      return new Response(new Uint8Array(expected!));
    }),
  };
  const native = new NativeAccountArchive({
    workspace,
    directory: join(root, "state"),
    chooseSave: async () => destination,
    chooseOpen: async () => null,
  });
  await expect(native.exportAndSave("alice")).rejects.toThrow("lost download");
  await native.exportAndSave("alice");
  expect(await readFile(destination)).toEqual(expected);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});
it("cancelled dialog and foreign owner perform no archive network operations", async () => {
  const root = await directory();
  const workspace = {
    nativeContext: vi.fn(async () => ({
      userId: "alice",
      profile: "default",
      epoch: 1,
      actor: "actor",
    })),
    assertNativeContext: vi.fn(),
    archiveRequest: vi.fn(),
  };
  const native = new NativeAccountArchive({
    workspace,
    directory: root,
    chooseSave: async () => null,
    chooseOpen: async () => null,
  });
  await native.exportAndSave("alice");
  await expect(native.exportAndSave("bob")).rejects.toThrow("account");
  await expect(native.commit("alice", false)).rejects.toThrow("confirmation");
  expect(workspace.archiveRequest).not.toHaveBeenCalled();
});
it("native selected-file restore retains its operation across an unknown commit and never applies without confirmation", async () => {
  const root = await directory(),
    selected = join(root, "selected.tar"),
    file = archive("source");
  await writeFile(selected, file.bytes);
  let lose = true;
  const commits: string[] = [];
  const workspace = {
    nativeContext: vi.fn(async () => ({
      userId: "alice",
      profile: "default",
      epoch: 1,
      actor: "actor",
    })),
    assertNativeContext: vi.fn(),
    archiveRequest: vi.fn(async (path: string, init?: RequestInit) => {
      const url = new URL("https://api.mithril.fund" + path),
        operationId = url.pathname.split("/")[5];
      const body = init?.method === "POST" ? JSON.parse(String(init.body)) : {};
      if (url.pathname.endsWith("/commit")) {
        commits.push(operationId);
        if (lose) {
          lose = false;
          throw Error("unknown commit");
        }
      }
      return Response.json({
        schemaVersion: 1,
        userId: "alice",
        operationId,
        digest: body.digest ?? url.searchParams.get("digest"),
        ...(url.pathname.endsWith("/entry")
          ? {
              name: url.searchParams.get("name"),
              sha256: url.searchParams.get("sha256"),
              size: (init!.body as Uint8Array).length,
              status: "retained",
            }
          : url.pathname.endsWith("/prepare")
            ? { baselineId: body.baselineId, status: "prepared" }
            : url.pathname.endsWith("/commit")
              ? { baselineId: baseline, status: "applied" }
              : { status: "staged" }),
      });
    }),
  };
  const native = (): NativeAccountArchive =>
    new NativeAccountArchive({
      workspace,
      directory: join(root, "state"),
      chooseSave: async () => null,
      chooseOpen: async () => selected,
    });
  const prepared = await native().chooseAndPrepare("alice");
  const baseline = prepared!.baselineId;
  expect(prepared?.phase).toBe("prepared");
  await expect(native().commit("alice", false)).rejects.toThrow("confirmation");
  expect(commits).toHaveLength(0);
  await expect(native().commit("alice", true)).rejects.toThrow(
    "unknown commit",
  );
  expect(await native().pending("alice")).toEqual(prepared);
  await native().commit("alice", true);
  expect(await native().pending("alice")).toBeNull();
  expect(commits).toEqual([prepared!.operationId, prepared!.operationId]);
});
