import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
  statSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, expect, it } from "vitest";
import {
  memoryReplicaSnapshot,
  applyMemoryReplica,
} from "./memory-replica-files";
import type { ReplicaWrite } from "@mithril/workspace/replica-sync";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(): string {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-memory-replica-")),
  );
  roots.push(root);
  mkdirSync(join(root, "memories"));
  writeFileSync(
    join(root, "config.yaml"),
    "memory:\n  memory_char_limit: 4096\n  user_char_limit: 2048\nAPI_SERVER_KEY: DO_NOT_SYNC\n",
  );
  writeFileSync(join(root, "memories", "MEMORY.md"), " First\n§\nSecond ");
  writeFileSync(join(root, "memories", "USER.md"), "Profile\n");
  writeFileSync(join(root, "SOUL.md"), "Original persona");
  return root;
}
function write(
  root: string,
  kind: string,
  content: string,
  operationId = "operation",
): ReplicaWrite {
  const source = memoryReplicaSnapshot(root, "default").find(
    (row) => (row.body as { kind: string }).kind === kind,
  )!;
  return {
    operationId,
    document: {
      collection: "memory",
      id: source.id,
      body: { ...(source.body as object), content },
      deleted: false,
      revision: 2,
      updatedAt: 1000,
    },
    expectedVersion: source.version,
    expectedRecord: source,
  };
}
const apply = (
  root: string,
  operation: ReplicaWrite,
): ReturnType<typeof applyMemoryReplica> =>
  applyMemoryReplica(
    root,
    "default",
    "alice",
    "replica",
    "/usr/bin/python3",
    operation,
  );
it("reads exact original files and configured limits without copying config or credentials", () => {
  const root = fixture(),
    rows = memoryReplicaSnapshot(root, "default");
  expect(rows).toHaveLength(3);
  expect((rows[0].body as { content: string }).content).toBe(
    " First\n§\nSecond ",
  );
  expect((rows[0].body as { charLimit: number }).charLimit).toBe(4096);
  expect(JSON.stringify(rows)).not.toContain("DO_NOT_SYNC");
  expect(readdirSync(join(root, "memories"))).toHaveLength(2);
});
it("writes under original locks, retains pre-edit receipt, and recovers a missed acknowledgement without rewriting data", () => {
  const root = fixture(),
    operation = write(root, "memory", "Cloud edit");
  expect(apply(root, operation).status).toBe("applied");
  const target = join(root, "memories", "MEMORY.md"),
    mtime = statSync(target).mtimeMs;
  const receipt = join(root, "memories", "mithril-receipt-operation.json");
  const body = JSON.parse(readFileSync(receipt, "utf8"));
  expect(body.before.content).toBe(" First\n§\nSecond ");
  body.state = "pending";
  writeFileSync(receipt, JSON.stringify(body));
  expect(apply(root, operation).status).toBe("applied");
  expect(readFileSync(target, "utf8")).toBe("Cloud edit");
  expect(statSync(target).mtimeMs).toBe(mtime);
  writeFileSync(target, "Later device edit");
  expect(apply(root, operation).status).toBe("applied");
  expect(readFileSync(target, "utf8")).toBe("Later device edit");
  expect(() =>
    apply(root, {
      ...operation,
      document: {
        ...operation.document,
        body: { ...(operation.document.body as object), content: "Reused" },
      },
    }),
  ).toThrow("reused");
});
it("refuses stale writes, synchronizes USER and SOUL independently, and retains deletion tombstones", () => {
  const root = fixture(),
    stale = write(root, "memory", "Overwrite");
  writeFileSync(join(root, "memories", "MEMORY.md"), "Device edit");
  expect(apply(root, stale).status).toBe("conflict");
  expect(readFileSync(join(root, "memories", "MEMORY.md"), "utf8")).toBe(
    "Device edit",
  );
  expect(
    apply(root, write(root, "user", "Cloud profile", "profile-op")).status,
  ).toBe("applied");
  expect(readFileSync(join(root, "memories", "USER.md"), "utf8")).toBe(
    "Cloud profile",
  );
  expect(
    apply(root, write(root, "soul", "Cloud persona", "persona-op")).status,
  ).toBe("applied");
  expect(readFileSync(join(root, "SOUL.md"), "utf8")).toBe("Cloud persona");
  const deletion = write(root, "soul", "Cloud persona", "delete-op");
  deletion.document.deleted = true;
  expect(apply(root, deletion).status).toBe("applied");
  expect(
    memoryReplicaSnapshot(root, "default").find(
      (row) => row.id === deletion.document.id,
    )?.deleted,
  ).toBe(true);
  writeFileSync(join(root, "SOUL.md"), "Restored on device");
  expect(
    memoryReplicaSnapshot(root, "default").find(
      (row) => row.id === deletion.document.id,
    )?.deleted,
  ).toBe(false);
});
it("rejects symlinks and ignores another profile or unsupported capacity changes", () => {
  const root = fixture(),
    operation = write(root, "memory", "Cloud edit");
  expect(
    applyMemoryReplica(
      root,
      "another",
      "alice",
      "replica",
      "/usr/bin/python3",
      operation,
    ).status,
  ).toBe("deferred");
  const unsupported = {
    ...operation,
    document: {
      ...operation.document,
      body: { ...(operation.document.body as object), charLimit: 8192 },
    },
  };
  expect(apply(root, unsupported).status).toBe("deferred");
  const target = join(root, "memories", "MEMORY.md");
  rmSync(target);
  symlinkSync(join(root, "SOUL.md"), target);
  expect(() => memoryReplicaSnapshot(root, "default")).toThrow("Unsafe Memory");
  expect(readFileSync(join(root, "SOUL.md"), "utf8")).toBe("Original persona");
});
