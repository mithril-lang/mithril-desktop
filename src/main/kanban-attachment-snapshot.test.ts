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
import { digestBytes, fileFingerprint } from "@mithril/workspace/files";
import { prepareKanbanAttachmentWriteback } from "./kanban-attachment-replica";
import type { JsonValue } from "@mithril/workspace/repository";
import type { TaskAttachmentTransport } from "@mithril/workspace/task-attachments";
const runtime = vi.hoisted(() => ({
  root: "/unused",
  state: "/unused",
  owner: "alice",
  files: vi.fn(),
  pages: vi.fn(),
}));
vi.mock("electron", () => ({ app: { getPath: () => runtime.state } }));
vi.mock("./utils", () => ({ profileHome: () => runtime.root }));
vi.mock("./cloud-workspace-runtime", () => ({
  cloudWorkspace: {
    nativeContext: async () => ({ userId: runtime.owner, profile: "default" }),
    taskAttachments: { forOwner: runtime.files },
    repositoryPage: runtime.pages,
    capabilityResources: {
      forOwner: () => {
        throw Error("No fixture resource transport");
      },
    },
  },
}));
vi.mock("./config", () => ({ getConnectionConfig: () => ({ mode: "local" }) }));
vi.mock("./installer", () => ({
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "",
}));
vi.mock("./tools", () => ({ getToolsets: () => [] }));
vi.mock("./mcp-servers", () => ({ listMcpServers: async () => [] }));

import { captureKanbanAttachments } from "./kanban-attachment-snapshot";
import {
  kanbanReplicaSnapshot,
  applyKanbanReplica,
  nativeReplicaSnapshot,
  nativeReplicaApply,
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

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Kanban attachment file writeback]]
it("restores added/replaced/removed cloud attachments into original rows, retains old files, and recovers SQL receipts", async () => {
  for (const board of ["default", "evidence"]) {
    const f = fixture(board),
      capture = f.capture();
    try {
      let source = kanbanReplicaSnapshot(
        f.root,
        "default",
        "alice",
        "device",
        capture.project,
      ).documents.find((r) => r.collection === "task")!;
      const original = structuredClone(source.body) as Record<
        string,
        JsonValue
      >;
      const originalRow = (
        original.attachments as Record<string, JsonValue>[]
      )[0]!;
      const bytes = new Uint8Array([7, 8, 9, 0]),
        digest = await digestBytes(bytes);
      const replacement = {
        ...originalRow,
        filename: "New evidence.html",
        size: bytes.length,
        resource: {
          format: "mithril-task-attachment-v1",
          taskId: source.id,
          size: bytes.length,
          digest: await fileFingerprint(bytes.length, [digest]),
          chunks: [digest],
        },
      };
      const reader = {
        forOwner: () => reader,
        getChunk: vi.fn(async () => bytes),
      };
      const body = { ...original, attachments: [replacement] } as JsonValue;
      const prepared = await prepareKanbanAttachmentWriteback(
        f.root,
        "/usr/bin/python3",
        f.state,
        source.id,
        body,
        reader,
        async () => {},
      );
      const operation = {
        operationId: "replace-files",
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
      const applied = applyKanbanReplica(
        f.root,
        "default",
        "alice",
        "device",
        operation,
        capture.project,
        prepared,
      );
      prepared.dispose();
      expect(applied.status).toBe("applied");
      source = kanbanReplicaSnapshot(
        f.root,
        "default",
        "alice",
        "device",
        capture.project,
      ).documents.find((r) => r.id === source.id)!;
      expect(applied.record).toEqual(source);
      const db = new Database(f.dbFile);
      const row = db
        .prepare("SELECT * FROM task_attachments WHERE id=9")
        .get() as { stored_path: string; filename: string };
      expect(row.filename).toBe("New evidence.html");
      expect(readFileSync(row.stored_path)).toEqual(Buffer.from(bytes));
      expect(readFileSync(f.file)).toEqual(Buffer.from(f.bytes));
      expect(
        db
          .prepare("SELECT count(*) AS n FROM mithril_attachment_history")
          .get(),
      ).toEqual({ n: 1 });
      db.close();
      const added = {
        ...replacement,
        id: 2,
        filename: "Empty.txt",
        size: 0,
        resource: {
          format: "mithril-task-attachment-v1",
          taskId: source.id,
          size: 0,
          digest: await fileFingerprint(0, []),
          chunks: [],
        },
      };
      const additionBody = {
        ...(source.body as Record<string, JsonValue>),
        attachments: [replacement, added],
      } as JsonValue;
      const addition = await prepareKanbanAttachmentWriteback(
        f.root,
        "/usr/bin/python3",
        f.state,
        source.id,
        additionBody,
        reader,
        async () => {},
      );
      const addResult = applyKanbanReplica(
        f.root,
        "default",
        "alice",
        "device",
        {
          ...operation,
          operationId: "add-empty",
          expectedVersion: source.version,
          expectedRecord: source,
          document: { ...operation.document, body: additionBody },
        },
        capture.project,
        addition,
      );
      addition.dispose();
      expect(addResult.status).toBe("applied");
      source = addResult.record!;
      const removalBody = {
        ...(source.body as Record<string, JsonValue>),
        attachments: [],
      } as JsonValue;
      const removal = await prepareKanbanAttachmentWriteback(
        f.root,
        "/usr/bin/python3",
        f.state,
        source.id,
        removalBody,
        reader,
        async () => {},
      );
      const removeOperation = {
        ...operation,
        operationId: "remove-files",
        expectedVersion: source.version,
        expectedRecord: source,
        document: { ...operation.document, body: removalBody },
      };
      const removed = applyKanbanReplica(
        f.root,
        "default",
        "alice",
        "device",
        removeOperation,
        capture.project,
        removal,
      );
      removal.dispose();
      expect(removed.status).toBe("applied");
      expect(removed.record).toEqual(
        kanbanReplicaSnapshot(
          f.root,
          "default",
          "alice",
          "device",
          capture.project,
        ).documents.find((r) => r.id === source.id),
      );
      expect(readFileSync(row.stored_path)).toEqual(Buffer.from(bytes));
      expect(readFileSync(f.file)).toEqual(Buffer.from(f.bytes));
      rmSync(row.stored_path);
      expect(
        applyKanbanReplica(
          f.root,
          "default",
          "alice",
          "device",
          removeOperation,
          capture.project,
        ),
      ).toEqual(removed);
      const audit = new Database(f.dbFile, { readonly: true });
      expect(
        audit.prepare("SELECT count(*) AS n FROM task_attachments").get(),
      ).toEqual({ n: 0 });
      expect(
        audit
          .prepare("SELECT count(*) AS n FROM mithril_attachment_history")
          .get(),
      ).toEqual({ n: 3 });
      expect(
        audit.prepare("SELECT count(*) AS n FROM task_runs").get(),
      ).toEqual({ n: 0 });
      audit.close();
    } finally {
      capture.dispose();
    }
  }
}, 30_000);

it("rejects corrupted bytes, owner changes, source conflicts and SQL coercion without replacing original attachments", async () => {
  for (const mode of ["bytes", "owner", "source", "sql", "symlink"]) {
    const f = fixture(),
      capture = f.capture();
    try {
      const source = kanbanReplicaSnapshot(
        f.root,
        "default",
        "alice",
        "device",
        capture.project,
      ).documents.find((r) => r.collection === "task")!;
      const body = structuredClone(source.body) as Record<string, JsonValue>;
      const row = (body.attachments as Record<string, JsonValue>[])[0]!;
      const bytes = new Uint8Array([8, 9, 10]),
        digest = await digestBytes(bytes);
      row.resource = {
        format: "mithril-task-attachment-v1",
        taskId: source.id,
        size: 3,
        digest: await fileFingerprint(3, [digest]),
        chunks: [digest],
      };
      const reader = {
        forOwner: () => reader,
        getChunk: async () =>
          mode === "bytes" ? new Uint8Array([1, 2, 3]) : bytes,
      };
      if (mode === "bytes" || mode === "owner") {
        await expect(
          prepareKanbanAttachmentWriteback(
            f.root,
            "/usr/bin/python3",
            f.state,
            source.id,
            body,
            reader,
            async () => {
              if (mode === "owner") throw Error("Owner changed");
            },
          ),
        ).rejects.toThrow();
      } else {
        const prepared = await prepareKanbanAttachmentWriteback(
          f.root,
          "/usr/bin/python3",
          f.state,
          source.id,
          body,
          reader,
          async () => {},
        );
        const db = new Database(f.dbFile);
        if (mode === "source")
          db.exec("UPDATE tasks SET title='External edit'");
        if (mode === "sql")
          db.exec(
            "CREATE TRIGGER change_file AFTER INSERT ON task_attachments BEGIN UPDATE task_attachments SET filename='Coerced' WHERE id=NEW.id; END",
          );
        db.close();
        if (mode === "symlink") {
          const target = join(
            f.root,
            "kanban",
            "attachments",
            f.taskId,
            `mithril-9-${(row.resource as Record<string, JsonValue>).digest}.bin`,
          );
          symlinkSync(f.file, target);
        }
        const apply = (): ReturnType<typeof applyKanbanReplica> =>
          applyKanbanReplica(
            f.root,
            "default",
            "alice",
            "device",
            {
              operationId: mode,
              expectedRecord: source,
              expectedVersion: source.version,
              document: {
                collection: "task",
                id: source.id,
                body,
                revision: 2,
                deleted: false,
                updatedAt: 2,
              },
            },
            capture.project,
            prepared,
          );
        if (mode === "source") expect(apply().status).toBe("conflict");
        else expect(apply).toThrow();
        prepared.dispose();
      }
      expect(readFileSync(f.file)).toEqual(Buffer.from(f.bytes));
      const db = new Database(f.dbFile, { readonly: true });
      expect(
        db.prepare("SELECT stored_path FROM task_attachments WHERE id=9").get(),
      ).toEqual({ stored_path: f.file });
      expect(db.prepare("SELECT count(*) AS n FROM task_runs").get()).toEqual({
        n: 0,
      });
      db.close();
    } finally {
      capture.dispose();
    }
  }
}, 30_000);

it("restores a cloud-created inactive task with files into the existing original board exactly once", async () => {
  const f = fixture(),
    capture = f.capture();
  try {
    const historyDb = new Database(f.dbFile);
    historyDb.exec(
      "INSERT INTO task_comments(id,task_id,author,body,created_at) VALUES(1,'native-original','alice','Retained comment with file',1);INSERT INTO task_runs(id,task_id,status,started_at,ended_at,summary) VALUES(2,'native-original','done',1,2,'Retained summary with file');INSERT INTO task_events(id,task_id,run_id,kind,payload,created_at) VALUES(3,'native-original',2,'completed','{\"receipt\":391}',2)",
    );
    historyDb.close();
    const source = kanbanReplicaSnapshot(
      f.root,
      "default",
      "alice",
      "device",
      capture.project,
    ).documents.find((r) => r.collection === "task")!;
    const body = structuredClone(source.body) as Record<string, JsonValue>;
    (body.task as Record<string, JsonValue>).id = "new-cloud-task";
    (body.task as Record<string, JsonValue>).title =
      "Cloud task with original files";
    const comment = (body.comments as Record<string, JsonValue>[])[0];
    comment.id = 40;
    comment.task_id = "new-cloud-task";
    const run = (body.runs as Record<string, JsonValue>[])[0];
    run.id = 42;
    run.task_id = "new-cloud-task";
    const event = (body.events as Record<string, JsonValue>[])[0];
    event.id = 41;
    event.task_id = "new-cloud-task";
    event.run_id = 42;
    const row = (body.attachments as Record<string, JsonValue>[])[0]!;
    row.id = 20;
    row.task_id = "new-cloud-task";
    (row.resource as Record<string, JsonValue>).taskId = "new-cloud-record";
    const reader = { forOwner: () => reader, getChunk: async () => f.bytes };
    const prepared = await prepareKanbanAttachmentWriteback(
      f.root,
      "/usr/bin/python3",
      f.state,
      "new-cloud-record",
      body,
      reader,
      async () => {},
    );
    const operation = {
      operationId: "create-task-with-files",
      expectedVersion: null,
      expectedRecord: null,
      document: {
        collection: "task" as const,
        id: "new-cloud-record",
        body,
        revision: 1,
        deleted: false,
        updatedAt: 1,
      },
    };
    const accepted = applyKanbanReplica(
      f.root,
      "default",
      "alice",
      "device",
      operation,
      capture.project,
      prepared,
    );
    prepared.dispose();
    expect(accepted.status).toBe("applied");
    expect(accepted.record).toEqual(
      kanbanReplicaSnapshot(
        f.root,
        "default",
        "alice",
        "device",
        capture.project,
      ).documents.find((r) => r.id === "new-cloud-record"),
    );
    const db = new Database(f.dbFile, { readonly: true });
    const restored = db
      .prepare("SELECT stored_path FROM task_attachments WHERE id=20")
      .get() as { stored_path: string };
    expect(readFileSync(restored.stored_path)).toEqual(Buffer.from(f.bytes));
    expect(db.prepare("SELECT count(*) AS n FROM tasks").get()).toEqual({
      n: 2,
    });
    expect(db.prepare("SELECT count(*) AS n FROM task_runs").get()).toEqual({
      n: 2,
    });
    db.close();
    rmSync(restored.stored_path);
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
  } finally {
    capture.dispose();
  }
});

it("connects the main replica route to owner-pinned restoration and skips downloads on retained receipts and unchanged files", async () => {
  const f = fixture(),
    capture = f.capture();
  runtime.root = f.root;
  runtime.state = f.state;
  runtime.owner = "alice";
  try {
    const source = kanbanReplicaSnapshot(
      f.root,
      "default",
      "alice",
      "device",
      capture.project,
    ).documents.find((r) => r.collection === "task")!;
    const body = structuredClone(source.body) as Record<string, JsonValue>;
    (body.task as Record<string, JsonValue>).title = "Main route updated";
    const operation = {
      operationId: "main-route-title",
      expectedRecord: source,
      expectedVersion: source.version,
      document: {
        collection: "task" as const,
        id: source.id,
        body,
        revision: 2,
        deleted: false,
        updatedAt: 2,
      },
    };
    runtime.files.mockClear();
    const title = await nativeReplicaApply(operation);
    expect(title.status).toBe("applied");
    expect(runtime.files).not.toHaveBeenCalled();
    const replacement = structuredClone(title.record!.body) as Record<
      string,
      JsonValue
    >;
    const row = (replacement.attachments as Record<string, JsonValue>[])[0]!;
    const bytes = new Uint8Array([20, 30, 40]),
      digest = await digestBytes(bytes);
    row.resource = {
      format: "mithril-task-attachment-v1",
      taskId: source.id,
      size: 3,
      digest: await fileFingerprint(3, [digest]),
      chunks: [digest],
    };
    const reader = {
      forOwner: () => reader,
      getChunk: vi.fn(async () => bytes),
    };
    runtime.files.mockReturnValue(reader);
    const update = {
      ...operation,
      operationId: "main-route-files",
      expectedRecord: title.record!,
      expectedVersion: title.record!.version,
      document: { ...operation.document, body: replacement },
    };
    const accepted = await nativeReplicaApply(update);
    expect(accepted.status).toBe("applied");
    expect(runtime.files).toHaveBeenCalledWith("alice");
    reader.getChunk.mockRejectedValue(Error("Offline"));
    expect(await nativeReplicaApply(update)).toEqual(accepted);
    expect(reader.getChunk).toHaveBeenCalledOnce();
    expect(readFileSync(f.file)).toEqual(Buffer.from(f.bytes));
  } finally {
    capture.dispose();
    runtime.files.mockReset();
  }
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Connected component attachment restoration]]
it("restores every connected task file through the main owner-scoped route and retains the original source on group refusal", async () => {
  const f = fixture(),
    capture = f.capture();
  runtime.root = f.root;
  runtime.state = f.state;
  runtime.owner = "alice";
  try {
    const source = kanbanReplicaSnapshot(
      f.root,
      "default",
      "alice",
      "device",
      capture.project,
    ).documents.find((row) => row.collection === "task")!;
    const documents = ["a", "b"].map((id, index) => {
      const body = structuredClone(source.body) as Record<string, JsonValue>;
      (body.task as Record<string, JsonValue>).id = id;
      (body.task as Record<string, JsonValue>).title = id;
      body.dependencies = [{ parent_id: "a", child_id: "b" }];
      body.parents = id === "b" ? ["a"] : [];
      body.children = id === "a" ? ["b"] : [];
      const row = (body.attachments as Record<string, JsonValue>[])[0];
      row.id = 21 + index;
      row.task_id = id;
      const documentId = "cloud-component-" + id;
      (row.resource as Record<string, JsonValue>).taskId = documentId;
      return {
        collection: "task" as const,
        id: documentId,
        body,
        deleted: false,
        revision: 1,
        updatedAt: 1,
      };
    });
    const operation = {
      operationId: "component-files-main",
      document: documents[0],
      expectedRecord: null,
      expectedVersion: null,
    };
    const reader = {
      forOwner: () => reader,
      getChunk: vi.fn(async () => f.bytes),
    };
    runtime.files.mockReturnValue(reader);
    const unavailable = documents.map((document) =>
      document.id.endsWith("b")
        ? {
            ...document,
            body: {
              ...document.body,
              task: {
                ...(document.body.task as Record<string, JsonValue>),
                status: "running",
              },
            },
          }
        : document,
    );
    runtime.pages.mockResolvedValue({
      schemaVersion: 1,
      userId: "alice",
      documents: unavailable,
      nextAfter: null,
    });
    expect((await nativeReplicaApply(operation)).status).toBe("deferred");
    const db = new Database(f.dbFile);
    try {
      expect(db.prepare("SELECT id FROM tasks ORDER BY id").all()).toEqual([
        { id: f.taskId },
      ]);
      expect(
        db.prepare("SELECT id FROM task_attachments ORDER BY id").all(),
      ).toEqual([{ id: 9 }]);
      expect(readFileSync(f.file)).toEqual(Buffer.from(f.bytes));
      runtime.pages.mockResolvedValue({
        schemaVersion: 1,
        userId: "alice",
        documents,
        nextAfter: null,
      });
      const accepted = await nativeReplicaApply(operation);
      expect(accepted.status).toBe("applied");
      const fresh = f.capture();
      try {
        const snapshot = kanbanReplicaSnapshot(
          f.root,
          "default",
          "alice",
          accepted.replicaId,
          fresh.project,
        );
        expect(accepted.record).toEqual(
          snapshot.documents.find((row) => row.id === documents[0].id),
        );
        for (const document of documents)
          expect(
            snapshot.documents.find((row) => row.id === document.id)?.body,
          ).toEqual(document.body);
      } finally {
        fresh.dispose();
      }
      const rows = db
        .prepare(
          "SELECT stored_path FROM task_attachments WHERE id IN (21,22) ORDER BY id",
        )
        .all() as { stored_path: string }[];
      expect(rows).toHaveLength(2);
      for (const row of rows)
        expect(readFileSync(row.stored_path)).toEqual(Buffer.from(f.bytes));
      const reads = reader.getChunk.mock.calls.length;
      runtime.pages.mockRejectedValue(Error("Offline"));
      reader.getChunk.mockRejectedValue(Error("Offline"));
      expect(await nativeReplicaApply(operation)).toEqual(accepted);
      expect(reader.getChunk.mock.calls.length).toBe(reads);
      expect(readFileSync(f.file)).toEqual(Buffer.from(f.bytes));
    } finally {
      db.close();
    }
  } finally {
    capture.dispose();
  }
}, 30_000);

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Attachment identity collision reconciliation]]
it("retains existing files across attachment ID collisions, alias overlaps, updates and removal", async () => {
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
    (body.task as Record<string, JsonValue>).id = "aliased-task";
    const row = (body.attachments as Record<string, JsonValue>[])[0];
    row.task_id = "aliased-task";
    (row.resource as Record<string, JsonValue>).taskId = "aliased-document";
    const reader = { forOwner: () => reader, getChunk: async () => f.bytes };
    const apply = async (
      body: Record<string, JsonValue>,
      operationId: string,
      previous: typeof source | null,
    ): Promise<ReturnType<typeof applyKanbanReplica>> => {
      const plan = await prepareKanbanAttachmentWriteback(
        f.root,
        "/usr/bin/python3",
        f.state,
        "aliased-document",
        body,
        reader,
        async () => {},
      );
      try {
        return applyKanbanReplica(
          f.root,
          "default",
          "alice",
          "device",
          {
            operationId,
            document: {
              collection: "task",
              id: "aliased-document",
              body,
              deleted: false,
              revision: 1,
              updatedAt: 1,
            },
            expectedRecord: previous,
            expectedVersion: previous?.version ?? null,
          },
          capture.project,
          plan,
        );
      } finally {
        plan.dispose();
      }
    };
    let accepted = await apply(body, "alias-create", null);
    expect(accepted.status).toBe("applied");
    const db = new Database(f.dbFile);
    try {
      const native = db
        .prepare(
          "SELECT id,stored_path FROM task_attachments WHERE task_id='aliased-task'",
        )
        .get() as { id: number; stored_path: string };
      expect(native.id).not.toBe(9);
      expect(readFileSync(native.stored_path)).toEqual(Buffer.from(f.bytes));
      row.filename = "updated.bin";
      accepted = await apply(body, "alias-update", accepted.record!);
      expect(accepted.status).toBe("applied");
      const extra = structuredClone(row);
      extra.id = native.id;
      extra.filename = "overlapping-id.bin";
      (body.attachments as JsonValue[]).push(extra);
      accepted = await apply(body, "alias-overlap", accepted.record!);
      expect(accepted.status).toBe("applied");
      expect(
        kanbanReplicaSnapshot(
          f.root,
          "default",
          "alice",
          "device",
          capture.project,
        ).documents.find((r) => r.id === "aliased-document"),
      ).toEqual(accepted.record);
      body.attachments = [extra];
      accepted = await apply(body, "alias-remove", accepted.record!);
      expect(accepted.status).toBe("applied");
      expect(
        kanbanReplicaSnapshot(
          f.root,
          "default",
          "alice",
          "device",
          capture.project,
        ).documents.find((r) => r.id === "aliased-document"),
      ).toEqual(accepted.record);
      expect(
        db.prepare("SELECT * FROM task_attachments WHERE id=9").get(),
      ).toMatchObject({ task_id: f.taskId, stored_path: f.file });
      expect(readFileSync(f.file)).toEqual(Buffer.from(f.bytes));
      const remaining = db
        .prepare("SELECT id FROM task_attachments WHERE task_id='aliased-task'")
        .get() as { id: number };
      db.prepare("DELETE FROM task_attachments WHERE id=?").run(remaining.id);
      expect(() =>
        kanbanReplicaSnapshot(
          f.root,
          "default",
          "alice",
          "device",
          capture.project,
        ),
      ).toThrow("Mapped attachment source changed");
    } finally {
      db.close();
    }
  } finally {
    capture.dispose();
  }
}, 30_000);
