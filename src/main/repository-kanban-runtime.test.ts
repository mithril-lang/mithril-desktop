import { mkdtempSync, mkdirSync, rmSync, realpathSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => "/unused" } }));
vi.mock("./utils", () => ({ profileHome: () => "/unused" }));
vi.mock("./cloud-workspace-runtime", () => ({
  cloudWorkspace: { nativeContext: vi.fn() },
}));
vi.mock("./config", () => ({ getConnectionConfig: () => ({ mode: "local" }) }));
import {
  kanbanRepositorySeed,
  bindRepositorySource,
  repositorySourceOwned,
} from "./repository-kanban-runtime";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
// @lat: [[cloud-workspace-tests#Rich Kanban migration snapshot]]
it("reads every board with comments, run metadata, dependencies and stable IDs without changing device storage", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mithril-rich-board-")));
  roots.push(root);
  mkdirSync(join(root, "kanban", "boards", "evidence"), { recursive: true });
  for (const [slug, file] of [
    ["default", join(root, "kanban.db")],
    ["evidence", join(root, "kanban", "boards", "evidence", "kanban.db")],
  ]) {
    const db = new Database(file);
    db.exec(
      "CREATE TABLE tasks(id TEXT,title TEXT,status TEXT,skills TEXT,workspace_path TEXT,claim_lock TEXT);CREATE TABLE task_comments(id INTEGER,task_id TEXT,body TEXT);CREATE TABLE task_events(id INTEGER,task_id TEXT,kind TEXT,payload TEXT);CREATE TABLE task_runs(id INTEGER,task_id TEXT,summary TEXT);CREATE TABLE task_dependencies(parent_id TEXT,child_id TEXT);",
    );
    db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?)").run(
      "task",
      "Evidence " + slug,
      "review",
      '["investigation"]',
      "/private/device/path",
      "active-device-lock",
    );
    db.prepare("INSERT INTO task_comments VALUES(1,?,?)").run(
      "task",
      "Full comment",
    );
    db.prepare("INSERT INTO task_events VALUES(1,?,?,?)").run(
      "task",
      "completed",
      '{"result":391}',
    );
    db.prepare("INSERT INTO task_runs VALUES(1,?,?)").run(
      "task",
      "Full summary",
    );
    db.prepare("INSERT INTO task_dependencies VALUES(?,?)").run(
      "parent",
      "task",
    );
    db.close();
  }
  const snapshot = kanbanRepositorySeed(root, "default");
  expect(snapshot.filter((row) => row.collection === "board")).toHaveLength(2);
  expect(snapshot.filter((row) => row.collection === "task")).toHaveLength(2);
  expect(kanbanRepositorySeed(root, "default")).toEqual(snapshot);
  const task = snapshot.find((row) => row.collection === "task")!.body;
  expect(task).toMatchObject({
    task: { skills: ["investigation"], workspace_path: null },
    comments: [{ body: "Full comment" }],
    events: [{ payload: { result: 391 } }],
    runs: [{ summary: "Full summary" }],
    parents: ["parent"],
    latest_summary: "Full summary",
  });
  expect(JSON.stringify(snapshot)).not.toContain("active-device-lock");
  expect(JSON.stringify(snapshot)).not.toContain("/private/device/path");
  const db = new Database(join(root, "kanban.db"), { readonly: true });
  expect(
    (
      db.prepare("SELECT workspace_path,claim_lock FROM tasks").get() as {
        workspace_path: string;
      }
    ).workspace_path,
  ).toBe("/private/device/path");
  db.close();
});

// @lat: [[cloud-workspace-tests#Native migration owner binding]]
it("binds native migration to one owner and never adopts a different account silently", () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-repository-owner-")),
  );
  roots.push(root);
  bindRepositorySource(root, "default", "alice");
  bindRepositorySource(root, "default", "alice");
  expect(() => bindRepositorySource(root, "default", "bob")).toThrow(
    "another account",
  );
  bindRepositorySource(root, "default", "alice");
  bindRepositorySource(root, "second", "bob");
});

// @lat: [[cloud-workspace-tests#Continuous Kanban replica]]
it("writes metadata with CAS and durable receipts while preserving private paths and rich history", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-replica-write-")),
  );
  roots.push(root);
  const db = new Database(join(root, "kanban.db"));
  db.exec(
    "CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,body TEXT,status TEXT,priority INTEGER,skills TEXT,workspace_path TEXT,claim_lock TEXT,archived INTEGER);CREATE TABLE task_comments(id INTEGER,task_id TEXT,body TEXT);",
  );
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)").run(
    "one",
    "Original",
    "Evidence",
    "review",
    1,
    '["investigate"]',
    "/device/private",
    null,
    0,
  );
  db.prepare("INSERT INTO task_comments VALUES(1,?,?)").run(
    "one",
    "Retain this evidence",
  );
  const snapshot = kanbanReplicaSnapshot(
    root,
    "default",
    "alice",
    "device-one",
  );
  const source = snapshot.documents.find((row) => row.collection === "task")!;
  const body = source.body as {
    task: Record<string, import("@mithril/workspace/repository").JsonValue>;
    [key: string]: import("@mithril/workspace/repository").JsonValue;
  };
  const document = {
    collection: "task" as const,
    id: source.id,
    revision: 2,
    updatedAt: 1,
    deleted: false,
    body: { ...body, task: { ...body.task, title: "Cloud title" } },
  };
  const write = {
    operationId: "cloud-change-one",
    document,
    expectedVersion: source.version,
    expectedRecord: source,
  };
  expect(
    applyKanbanReplica(root, "default", "alice", "device-one", write).status,
  ).toBe("applied");
  expect(
    applyKanbanReplica(root, "default", "alice", "device-one", write).record
      ?.version,
  ).toBe(
    kanbanReplicaSnapshot(
      root,
      "default",
      "alice",
      "device-one",
    ).documents.find((row) => row.collection === "task")?.version,
  );
  expect(db.prepare("SELECT title,workspace_path FROM tasks").get()).toEqual({
    title: "Cloud title",
    workspace_path: "/device/private",
  });
  expect(db.prepare("SELECT body FROM task_comments").get()).toEqual({
    body: "Retain this evidence",
  });
  expect(
    applyKanbanReplica(root, "default", "alice", "device-one", write).status,
  ).toBe("applied");
  expect(
    db.prepare("SELECT COUNT(*) AS count FROM mithril_replica_receipts").get(),
  ).toEqual({ count: 1 });
  expect(
    applyKanbanReplica(root, "default", "alice", "device-one", {
      ...write,
      operationId: "stale-change",
    }).status,
  ).toBe("conflict");
  const latest = kanbanReplicaSnapshot(
    root,
    "default",
    "alice",
    "device-one",
  ).documents.find((row) => row.collection === "task")!;
  db.prepare("UPDATE tasks SET claim_lock='busy'").run();
  const claimed = kanbanReplicaSnapshot(
    root,
    "default",
    "alice",
    "device-one",
  ).documents.find((row) => row.collection === "task")!;
  expect(
    applyKanbanReplica(root, "default", "alice", "device-one", {
      ...write,
      operationId: "busy-change",
      expectedVersion: claimed.version,
      expectedRecord: claimed,
    }).status,
  ).toBe("deferred");
  expect(latest.version).not.toBe(claimed.version);
  db.prepare("UPDATE tasks SET claim_lock=NULL").run();
  const unclaimed = kanbanReplicaSnapshot(
    root,
    "default",
    "alice",
    "device-one",
  ).documents.find((row) => row.collection === "task")!;
  expect(
    applyKanbanReplica(root, "default", "alice", "device-one", {
      ...write,
      operationId: "delete-change",
      document: { ...document, deleted: true },
      expectedVersion: unclaimed.version,
      expectedRecord: unclaimed,
    }).status,
  ).toBe("applied");
  expect(db.prepare("SELECT archived,workspace_path FROM tasks").get()).toEqual(
    { archived: 1, workspace_path: "/device/private" },
  );
  db.close();
});

// @lat: [[cloud-workspace-tests#Continuous Kanban replica]]
it("keeps replica identity stable across restart and distinct across devices", async () => {
  const { repositoryReplicaId } = await import("./repository-kanban-runtime");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mithril-replica-id-")));
  roots.push(root);
  const first = repositoryReplicaId(join(root, "first"), "default");
  expect(repositoryReplicaId(join(root, "first"), "default")).toBe(first);
  expect(repositoryReplicaId(join(root, "second"), "default")).not.toBe(first);
  expect(repositoryReplicaId(join(root, "first"), "other")).not.toBe(first);
});

// @lat: [[cloud-workspace-tests#Continuous Kanban replica]]
it("appends synchronized comments and status events atomically without launching work", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-replica-history-")),
  );
  roots.push(root);
  const db = new Database(join(root, "kanban.db"));
  db.exec(
    "CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,body TEXT,status TEXT,priority INTEGER,workspace_path TEXT,claim_lock TEXT);CREATE TABLE task_comments(id INTEGER PRIMARY KEY,task_id TEXT,body TEXT);CREATE TABLE task_events(id INTEGER PRIMARY KEY,task_id TEXT,kind TEXT,payload TEXT,created_at INTEGER);",
  );
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?)").run(
    "one",
    "Original",
    "Evidence",
    "review",
    1,
    "/device/private",
    null,
  );
  const source = kanbanReplicaSnapshot(
    root,
    "default",
    "alice",
    "device-one",
  ).documents.find((row) => row.collection === "task")!;
  const body = source.body as {
    task: Record<string, import("@mithril/workspace/repository").JsonValue>;
    [key: string]: import("@mithril/workspace/repository").JsonValue;
  };
  const document = {
    collection: "task" as const,
    id: source.id,
    revision: 2,
    updatedAt: 1,
    deleted: false,
    body: {
      ...body,
      task: { ...body.task, status: "blocked" },
      comments: [{ id: 1, task_id: "one", body: "New evidence" }],
      events: [
        {
          id: 2,
          task_id: "one",
          kind: "status_changed",
          payload: { from: "review", to: "blocked" },
          created_at: 1,
          run_id: null,
        },
      ],
    },
  };
  const write = {
    operationId: "history-one",
    document,
    expectedVersion: source.version,
    expectedRecord: source,
  };
  const result = applyKanbanReplica(
    root,
    "default",
    "alice",
    "device-one",
    write,
  );
  expect(result.status).toBe("applied");
  const fresh = kanbanReplicaSnapshot(
    root,
    "default",
    "alice",
    "device-one",
  ).documents.find((row) => row.collection === "task")!;
  expect(result.record?.version).toBe(fresh.version);
  expect(fresh.body).toMatchObject({
    task: { status: "blocked" },
    comments: [{ body: "New evidence" }],
    events: [{ payload: { to: "blocked" } }],
  });
  const ready = {
    ...write,
    operationId: "do-not-dispatch",
    expectedRecord: fresh,
    expectedVersion: fresh.version,
    document: {
      ...document,
      body: {
        ...document.body,
        task: { ...document.body.task, status: "ready" },
      },
    },
  };
  expect(
    applyKanbanReplica(root, "default", "alice", "device-one", ready).status,
  ).toBe("deferred");
  expect(db.prepare("SELECT status FROM tasks").get()).toEqual({
    status: "blocked",
  });
  expect(db.prepare("SELECT count(*) AS count FROM task_events").get()).toEqual(
    { count: 1 },
  );
  db.close();
});

it("reads an existing profile binding without adopting another account", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mithril-owner-read-")));
  roots.push(root);
  expect(repositorySourceOwned(join(root, "absent"), "default", "alice")).toBe(
    false,
  );
  expect(existsSync(join(root, "absent"))).toBe(false);
  bindRepositorySource(root, "default", "alice");
  expect(repositorySourceOwned(root, "default", "alice")).toBe(true);
  expect(() => repositorySourceOwned(root, "default", "bob")).toThrow(
    "another account",
  );
  expect(repositorySourceOwned(root, "other", "bob")).toBe(false);
});
