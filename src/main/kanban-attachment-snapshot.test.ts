import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { digestBytes } from "@mithril/workspace/files";
import type { JsonValue } from "@mithril/workspace/repository";
import type { TaskAttachmentTransport } from "@mithril/workspace/task-attachments";
const runtime = vi.hoisted(() => ({
  root: "/unused",
  state: "/unused",
  owner: "alice",
  files: vi.fn(),
}));
vi.mock("electron", () => ({ app: { getPath: () => runtime.state } }));
vi.mock("./utils", () => ({ profileHome: () => runtime.root }));
vi.mock("./cloud-workspace-runtime", () => ({
  cloudWorkspace: {
    nativeContext: async () => ({ userId: runtime.owner, profile: "default" }),
    taskAttachments: { forOwner: runtime.files },
    capabilityResources: {
      forOwner: () => {
        throw Error("No fixture resource transport");
      },
    },
  },
}));
vi.mock("./config", () => ({ getConnectionConfig: () => ({ mode: "local" }) }));
vi.mock("./installer", () => ({ HERMES_PYTHON: "/usr/bin/python3" }));
vi.mock("./tools", () => ({ getToolsets: () => [] }));
vi.mock("./mcp-servers", () => ({ listMcpServers: async () => [] }));

import { captureKanbanAttachments } from "./kanban-attachment-snapshot";
import {
  kanbanReplicaSnapshot,
  applyKanbanReplica,
  nativeReplicaSnapshot,
} from "./repository-kanban-runtime";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture(board = "default"): {
  home: string;
  root: string;
  state: string;
  taskId: string;
  file: string;
  bytes: Uint8Array;
  dbFile: string;
  capture: () => ReturnType<typeof captureKanbanAttachments>;
} {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "mithril-task-files-")));
  roots.push(home);
  const taskId = "native-original",
    root = join(home, "profile"),
    state = join(home, "captures");
  const directory =
    board === "default" ? root : join(root, "kanban", "boards", board);
  const taskDirectory =
    board === "default"
      ? join(root, "kanban", "attachments", taskId)
      : join(directory, "attachments", taskId);
  mkdirSync(taskDirectory, { recursive: true });
  const file = join(taskDirectory, "証拠.bin"),
    bytes = new Uint8Array([0, 255, 7]);
  writeFileSync(file, bytes);
  const db = new Database(join(directory, "kanban.db"));
  db.exec(
    readFileSync(
      join(process.cwd(), "tests", "fixtures", "agent-kanban-schema.sql"),
      "utf8",
    ),
  );
  db.prepare(
    "INSERT INTO tasks(id,title,status,created_at) VALUES(?,?,?,?)",
  ).run(taskId, "Original", "done", 10);
  db.prepare(
    "INSERT INTO task_attachments(id,task_id,filename,stored_path,content_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    9,
    taskId,
    "証拠.bin",
    file,
    "application/octet-stream",
    bytes.length,
    "original-author",
    10,
  );
  db.close();
  return {
    home,
    root,
    state,
    taskId,
    file,
    bytes,
    dbFile: join(directory, "kanban.db"),
    capture: () => captureKanbanAttachments(root, "/usr/bin/python3", state),
  };
}
function storage(): {
  transport: TaskAttachmentTransport;
  chunks: Map<string, Uint8Array>;
  uploads: string[];
} {
  const chunks = new Map<string, Uint8Array>();
  const uploads: string[] = [];
  const transport: TaskAttachmentTransport = {
    forOwner: () => transport,
    hasChunk: async (id, digest, size) =>
      chunks.get(id + ":" + digest)?.length === size,
    putChunk: async (id, bytes) => {
      const digest = await digestBytes(bytes);
      chunks.set(id + ":" + digest, new Uint8Array(bytes));
      uploads.push(id + ":" + digest);
      return digest;
    },
    getChunk: async (id, digest) => chunks.get(id + ":" + digest)!,
  };
  return { transport, chunks, uploads };
}
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Original Kanban attachment capture]]
it("captures only registered binary files for every board, keeps original attachment metadata and removes private paths", async () => {
  for (const board of ["default", "evidence"]) {
    const f = fixture(board),
      capture = f.capture(),
      cloud = storage();
    try {
      const snapshot = kanbanReplicaSnapshot(
        f.root,
        "default",
        "alice",
        "device",
        capture.project,
      );
      const record = snapshot.documents.find(
        (row) => row.collection === "task",
      )!;
      const body = record.body as { attachments: Record<string, unknown>[] };
      expect(body.attachments[0]).toMatchObject({
        id: 9,
        task_id: f.taskId,
        filename: "証拠.bin",
        size: 3,
        content_type: "application/octet-stream",
        uploaded_by: "original-author",
        created_at: 10,
        stored_path: null,
      });
      expect(JSON.stringify(record)).not.toContain(f.home);
      await capture.publish(cloud.transport, async () => {});
      const resource = body.attachments[0].resource as {
        taskId: string;
        chunks: string[];
      };
      expect(resource.taskId).toBe(record.id);
      expect(cloud.chunks.get(record.id + ":" + resource.chunks[0])).toEqual(
        f.bytes,
      );
      expect(readFileSync(f.file)).toEqual(Buffer.from(f.bytes));
      const db = new Database(f.dbFile, { readonly: true });
      expect(
        db.prepare("SELECT stored_path FROM task_attachments WHERE id=9").get(),
      ).toEqual({ stored_path: f.file });
      expect(
        db.prepare("SELECT count(*) AS count FROM task_events").get(),
      ).toEqual({ count: 0 });
      db.close();
    } finally {
      capture.dispose();
    }
    expect(readdirSync(f.state)).toEqual([]);
  }
});
it("publishes the immutable capture despite later source edits; re-capture detects changed bytes even when SQL metadata is unchanged", async () => {
  const f = fixture(),
    capture = f.capture(),
    cloud = storage();
  try {
    const first = kanbanReplicaSnapshot(
      f.root,
      "default",
      "alice",
      "device",
      capture.project,
    );
    const original = first.documents.find((row) => row.collection === "task")!;
    writeFileSync(f.file, new Uint8Array([8, 9, 10]));
    await capture.publish(cloud.transport, async () => {});
    expect([...cloud.chunks.values()]).toEqual([f.bytes]);
    const changed = kanbanReplicaSnapshot(
      f.root,
      "default",
      "alice",
      "device",
      capture.project,
    ).documents.find((row) => row.id === original.id)!;
    expect(changed.version).not.toBe(original.version);
    expect(readFileSync(f.file)).toEqual(Buffer.from([8, 9, 10]));
  } finally {
    capture.dispose();
  }
});
it("deduplicates confirmed chunks and refuses to publish on an account change or failed acknowledgement", async () => {
  const f = fixture(),
    capture = f.capture(),
    cloud = storage();
  try {
    kanbanReplicaSnapshot(
      f.root,
      "default",
      "alice",
      "device",
      capture.project,
    );
    await capture.publish(cloud.transport, async () => {});
    await capture.publish(cloud.transport, async () => {});
    expect(cloud.uploads).toHaveLength(1);
    const send = vi.fn(cloud.transport.putChunk);
    await expect(
      capture.publish(
        { ...cloud.transport, hasChunk: async () => false, putChunk: send },
        async () => {
          throw Error("Account changed");
        },
      ),
    ).rejects.toThrow("Account changed");
    expect(send).not.toHaveBeenCalled();
    await expect(
      capture.publish(
        {
          ...cloud.transport,
          hasChunk: async () => false,
          putChunk: async () => "f".repeat(64),
        },
        async () => {},
      ),
    ).rejects.toThrow("integrity");
    expect(readFileSync(f.file)).toEqual(Buffer.from(f.bytes));
  } finally {
    capture.dispose();
  }
});
it("rejects missing, escaped, symlinked, wrong-sized and unknown-schema source files without replacing them", () => {
  for (const mode of [
    "missing",
    "escape",
    "symlink",
    "size",
    "schema",
    "directory-symlink",
    "orphan",
  ]) {
    const f = fixture(),
      db = new Database(f.dbFile),
      outside = join(f.home, "outside.bin");
    writeFileSync(outside, f.bytes);
    if (mode === "missing") rmSync(f.file);
    if (mode === "escape")
      db.prepare("UPDATE task_attachments SET stored_path=?").run(outside);
    if (mode === "symlink") {
      rmSync(f.file);
      symlinkSync(outside, f.file);
    }
    if (mode === "size") db.prepare("UPDATE task_attachments SET size=2").run();
    if (mode === "schema")
      db.exec("ALTER TABLE task_attachments ADD COLUMN unexpected TEXT");
    if (mode === "orphan")
      db.prepare("UPDATE task_attachments SET task_id='missing-task'").run();
    if (mode === "directory-symlink") {
      const dir = join(f.root, "kanban", "attachments", f.taskId);
      rmSync(dir, { recursive: true });
      symlinkSync(f.home, dir);
    }
    db.close();
    const capture = f.capture();
    try {
      expect(() =>
        kanbanReplicaSnapshot(
          f.root,
          "default",
          "alice",
          "device",
          capture.project,
        ),
      ).toThrow();
    } finally {
      capture.dispose();
    }
    expect(readFileSync(outside)).toEqual(Buffer.from(f.bytes));
  }
});
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Kanban attachment metadata CAS]]
it("edits original task metadata with attached files and retains matching source fingerprints and durable receipts", () => {
  const f = fixture(),
    capture = f.capture();
  try {
    const source = kanbanReplicaSnapshot(
      f.root,
      "default",
      "alice",
      "device",
      capture.project,
    ).documents.find((row) => row.collection === "task")!;
    const body = structuredClone(source.body) as Record<string, JsonValue>;
    (body.task as Record<string, JsonValue>).title = "Cloud title";
    const operation = {
      operationId: "attachment-title",
      expectedVersion: source.version,
      expectedRecord: source,
      document: {
        collection: "task" as const,
        id: source.id,
        body,
        revision: 2,
        deleted: false,
        updatedAt: 2,
      },
    };
    const accepted = applyKanbanReplica(
      f.root,
      "default",
      "alice",
      "device",
      operation,
      capture.project,
    );
    expect(accepted.status).toBe("applied");
    expect(accepted.record).toEqual(
      kanbanReplicaSnapshot(
        f.root,
        "default",
        "alice",
        "device",
        capture.project,
      ).documents.find((row) => row.id === source.id),
    );
    writeFileSync(f.file, new Uint8Array([8, 9, 10]));
    expect(
      applyKanbanReplica(
        f.root,
        "default",
        "alice",
        "device",
        operation,
        capture.project,
      ),
    ).toEqual(accepted);
    const fresh = kanbanReplicaSnapshot(
      f.root,
      "default",
      "alice",
      "device",
      capture.project,
    ).documents.find((row) => row.id === source.id)!;
    const replacement = structuredClone(fresh.body) as Record<
      string,
      JsonValue
    >;
    replacement.attachments = [];
    (replacement.task as Record<string, JsonValue>).title =
      "Must defer with attachment change";
    expect(
      applyKanbanReplica(
        f.root,
        "default",
        "alice",
        "device",
        {
          ...operation,
          operationId: "attachment-change",
          expectedVersion: fresh.version,
          expectedRecord: fresh,
          document: { ...operation.document, body: replacement },
        },
        capture.project,
      ).status,
    ).toBe("deferred");
    const db = new Database(f.dbFile, { readonly: true });
    expect(db.prepare("SELECT title FROM tasks").get()).toEqual({
      title: "Cloud title",
    });
    expect(
      db.prepare("SELECT count(*) AS count FROM task_attachments").get(),
    ).toEqual({ count: 1 });
    db.close();
    rmSync(f.file);
    expect(
      applyKanbanReplica(
        f.root,
        "default",
        "alice",
        "device",
        operation,
        capture.project,
      ),
    ).toEqual(accepted);
    expect(() =>
      applyKanbanReplica(
        f.root,
        "default",
        "alice",
        "device",
        {
          ...operation,
          document: { ...operation.document, body: replacement },
        },
        capture.project,
      ),
    ).toThrow("Replica operation was reused");
  } finally {
    capture.dispose();
  }
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Kanban attachment publication barrier]]
it("exposes the native task snapshot only after all byte acknowledgements and retains source rows on failed publication", async () => {
  const f = fixture(),
    cloud = storage();
  runtime.root = f.root;
  runtime.state = join(f.home, "userData");
  runtime.owner = "alice";
  runtime.files.mockReturnValue(cloud.transport);
  vi.stubEnv("HERMES_KANBAN_HOME", "");
  vi.stubEnv("HERMES_KANBAN_DB", "");
  vi.stubEnv("HERMES_KANBAN_ATTACHMENTS_ROOT", "");
  try {
    const ready = await nativeReplicaSnapshot();
    expect(ready.collections).toContain("task");
    const record = ready.documents.find((row) => row.collection === "task")!;
    expect(record).toBeDefined();
    expect(cloud.uploads).toHaveLength(1);
    expect(runtime.files).toHaveBeenCalledWith("alice");
    expect(JSON.stringify(record)).not.toContain(f.home);
    const send = vi.fn(async () => {
      throw Error("offline");
    });
    runtime.files.mockReturnValue({
      ...cloud.transport,
      hasChunk: async () => false,
      putChunk: send,
    });
    const failed = await nativeReplicaSnapshot();
    expect(send).toHaveBeenCalledOnce();
    expect(failed.collections).not.toContain("task");
    expect(failed.collections).not.toContain("board");
    expect(failed.documents.some((row) => row.collection === "task")).toBe(
      false,
    );
    expect(failed.warnings).toContain(
      "Kanban source requires synchronization review; original records are retained",
    );
    expect(readFileSync(f.file)).toEqual(Buffer.from(f.bytes));
    const db = new Database(f.dbFile, { readonly: true });
    expect(
      db.prepare("SELECT count(*) AS count FROM task_attachments").get(),
    ).toEqual({ count: 1 });
    db.close();
  } finally {
    vi.unstubAllEnvs();
    runtime.root = "/unused";
    runtime.state = "/unused";
    runtime.files.mockReset();
  }
});
