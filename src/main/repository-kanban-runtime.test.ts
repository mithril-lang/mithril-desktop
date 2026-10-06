import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  realpathSync,
  existsSync,
  readFileSync,
} from "fs";
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

// @lat: [[cloud-workspace-tests#Dependency graph replica receipts]]
it("reconciles dependency edits with task CAS and a durable receipt", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-graph-write-")),
  );
  roots.push(root);
  const db = new Database(join(root, "kanban.db"));
  try {
    db.exec(
      "CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,status TEXT,workspace_path TEXT,claim_lock TEXT,archived INTEGER);CREATE TABLE task_dependencies(parent_id TEXT,child_id TEXT,created_at INTEGER,PRIMARY KEY(parent_id,child_id));INSERT INTO tasks VALUES('a','A','todo','/private/a',NULL,0),('b','B','todo',NULL,NULL,0),('c','C','todo',NULL,NULL,0);INSERT INTO task_dependencies VALUES('a','b',1);",
    );
    const get = (): import("@mithril/workspace/replica-sync").ReplicaRecord =>
      kanbanReplicaSnapshot(root, "default", "alice", "device").documents.find(
        (row) =>
          row.collection === "task" &&
          (row.body as { task: { id: string } }).task.id === "a",
      )!;
    const source = get(),
      body = source.body as Record<
        string,
        import("@mithril/workspace/repository").JsonValue
      >;
    const write = {
      operationId: "graph-choice",
      expectedRecord: source,
      expectedVersion: source.version,
      document: {
        collection: "task" as const,
        id: source.id,
        revision: 2,
        updatedAt: 1,
        deleted: false,
        body: {
          ...body,
          dependencies: [{ parent_id: "a", child_id: "c", created_at: 2 }],
          parents: [],
          children: ["c"],
        },
      },
    };
    const result = applyKanbanReplica(
      root,
      "default",
      "alice",
      "device",
      write,
    );
    expect(result.status).toBe("applied");
    expect(result.record).toEqual(get());
    expect(
      applyKanbanReplica(root, "default", "alice", "device", write),
    ).toEqual(result);
    expect(
      db.prepare("SELECT workspace_path,status FROM tasks WHERE id='a'").get(),
    ).toEqual({ workspace_path: "/private/a", status: "todo" });
    expect(db.prepare("SELECT * FROM task_dependencies").all()).toEqual([
      { parent_id: "a", child_id: "c", created_at: 2 },
    ]);
    const stale = applyKanbanReplica(root, "default", "alice", "device", {
      ...write,
      operationId: "stale-graph-choice",
    });
    expect(stale.status).toBe("conflict");
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM mithril_replica_receipts")
        .get(),
    ).toEqual({ count: 1 });
  } finally {
    db.close();
  }
});

it("rolls task metadata and dependency edits back if relationship insertion fails", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-graph-rollback-")),
  );
  roots.push(root);
  const db = new Database(join(root, "kanban.db"));
  try {
    db.exec(
      "CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,status TEXT,workspace_path TEXT,claim_lock TEXT);CREATE TABLE task_dependencies(parent_id TEXT,child_id TEXT,created_at INTEGER UNIQUE);INSERT INTO tasks VALUES('a','A','todo',NULL,NULL),('b','B','todo',NULL,NULL),('c','C','todo',NULL,NULL);INSERT INTO task_dependencies VALUES('a','b',1),('b','c',2);",
    );
    const source = kanbanReplicaSnapshot(
      root,
      "default",
      "alice",
      "device",
    ).documents.find(
      (row) =>
        row.collection === "task" &&
        (row.body as { task: { id: string } }).task.id === "a",
    )!;
    const body = source.body as {
      task: Record<string, import("@mithril/workspace/repository").JsonValue>;
      [key: string]: import("@mithril/workspace/repository").JsonValue;
    };
    expect(() =>
      applyKanbanReplica(root, "default", "alice", "device", {
        operationId: "graph-rollback",
        expectedRecord: source,
        expectedVersion: source.version,
        document: {
          collection: "task",
          id: source.id,
          revision: 2,
          updatedAt: 1,
          deleted: false,
          body: {
            ...body,
            task: { ...body.task, title: "Cloud edit" },
            dependencies: [{ parent_id: "a", child_id: "c", created_at: 2 }],
            parents: [],
            children: ["c"],
          },
        },
      }),
    ).toThrow();
    expect(db.prepare("SELECT title FROM tasks WHERE id='a'").get()).toEqual({
      title: "A",
    });
    expect(
      db.prepare("SELECT * FROM task_dependencies ORDER BY created_at").all(),
    ).toEqual([
      { parent_id: "a", child_id: "b", created_at: 1 },
      { parent_id: "b", child_id: "c", created_at: 2 },
    ]);
    expect(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='mithril_replica_receipts'",
        )
        .get(),
    ).toBeUndefined();
  } finally {
    db.close();
  }
});

// @lat: [[cloud-workspace-tests#Cloud-created task reconstruction]]
it("restores a Web-created task into the actual Agent schema with a stable repository ID and receipt", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mithril-real-task-")));
  roots.push(root);
  const db = new Database(join(root, "kanban.db"));
  try {
    db.exec(
      readFileSync(
        join(process.cwd(), "tests/fixtures/agent-kanban-schema.sql"),
        "utf8",
      ),
    );
    const task = {
      id: "browser-task",
      title: "Web created",
      body: null,
      assignee: null,
      status: "todo",
      priority: 0,
      tenant: null,
      workspace_kind: "scratch",
      workspace_path: null,
      created_by: "alice",
      created_at: 10,
      started_at: null,
      completed_at: null,
      result: null,
      skills: [],
      max_retries: null,
    };
    const write = {
      operationId: "restore-browser-task",
      expectedRecord: null,
      expectedVersion: null,
      document: {
        collection: "task" as const,
        id: "cloud-original-id",
        revision: 1,
        updatedAt: 10,
        deleted: false,
        body: {
          board: "default",
          task,
          comments: [],
          events: [],
          runs: [],
          parents: [],
          children: [],
          latest_summary: null,
        },
      },
    };
    const result = applyKanbanReplica(
      root,
      "default",
      "alice",
      "device",
      write,
    );
    expect(result.status).toBe("applied");
    const snapshot = kanbanReplicaSnapshot(root, "default", "alice", "device");
    expect(snapshot.documents.find((row) => row.collection === "task")).toEqual(
      result.record,
    );
    expect(result.record?.id).toBe("cloud-original-id");
    expect(
      applyKanbanReplica(root, "default", "alice", "device", write),
    ).toEqual(result);
    expect(db.prepare("SELECT COUNT(*) AS count FROM tasks").get()).toEqual({
      count: 1,
    });
    expect(
      db
        .prepare(
          "SELECT status,claim_lock,worker_pid,workspace_path FROM tasks",
        )
        .get(),
    ).toEqual({
      status: "todo",
      claim_lock: null,
      worker_pid: null,
      workspace_path: null,
    });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM task_events").get(),
    ).toEqual({ count: 0 });
    const after = snapshot.documents.find((row) => row.collection === "task")!;
    const body = after.body as {
      task: Record<string, import("@mithril/workspace/repository").JsonValue>;
      [key: string]: import("@mithril/workspace/repository").JsonValue;
    };
    const edited = applyKanbanReplica(root, "default", "alice", "device", {
      operationId: "rename-restored-task",
      expectedVersion: after.version,
      expectedRecord: after,
      document: {
        ...write.document,
        revision: 2,
        body: { ...body, task: { ...body.task, title: "Updated Web title" } },
      },
    });
    expect(edited.status).toBe("applied");
    expect(edited.record?.id).toBe("cloud-original-id");
  } finally {
    db.close();
  }
});
it("does not create executable tasks, overwrite an existing raw ID or drop nonempty history", async () => {
  const { applyKanbanReplica } = await import("./repository-kanban-runtime");
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-restore-guard-")),
  );
  roots.push(root);
  const db = new Database(join(root, "kanban.db"));
  try {
    db.exec(
      readFileSync(
        join(process.cwd(), "tests/fixtures/agent-kanban-schema.sql"),
        "utf8",
      ),
    );
    const task = {
      id: "source",
      title: "Original",
      status: "todo",
      created_at: 1,
      workspace_path: null,
    };
    const base = {
      operationId: "restore",
      expectedRecord: null,
      expectedVersion: null,
      document: {
        collection: "task" as const,
        id: "cloud-id",
        revision: 1,
        updatedAt: 1,
        deleted: false,
        body: {
          board: "default",
          task,
          comments: [],
          events: [],
          runs: [],
          parents: [],
          children: [],
          latest_summary: null,
        },
      },
    };
    for (const status of ["ready", "scheduled", "running"])
      expect(
        applyKanbanReplica(root, "default", "alice", "device", {
          ...base,
          operationId: "guard-" + status,
          document: {
            ...base.document,
            body: { ...base.document.body, task: { ...task, status } },
          },
        }).status,
      ).toBe("deferred");
    expect(
      applyKanbanReplica(root, "default", "alice", "device", {
        ...base,
        document: {
          ...base.document,
          body: {
            ...base.document.body,
            comments: [{ body: "Preserve history" }],
          },
        },
      }).status,
    ).toBe("deferred");
    db.exec(
      "INSERT INTO tasks(id,title,status,created_at) VALUES('source','Existing device','todo',1)",
    );
    expect(
      applyKanbanReplica(root, "default", "alice", "device", base).status,
    ).toBe("deferred");
    expect(db.prepare("SELECT title FROM tasks").get()).toEqual({
      title: "Existing device",
    });
  } finally {
    db.close();
  }
});
it("reads actual task_links and more than 20000 board-wide events without truncating individual histories", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mithril-real-links-")));
  roots.push(root);
  const db = new Database(join(root, "kanban.db"));
  try {
    db.exec(
      readFileSync(
        join(process.cwd(), "tests/fixtures/agent-kanban-schema.sql"),
        "utf8",
      ),
    );
    db.exec(
      "INSERT INTO tasks(id,title,status,created_at) VALUES('a','A','todo',1),('b','B','todo',1);INSERT INTO task_links VALUES('a','b')",
    );
    db.transaction(() => {
      const insert = db.prepare(
        "INSERT INTO task_events(task_id,kind,payload,created_at) VALUES(?,'changed','null',1)",
      );
      for (let i = 0; i < 21000; i++) insert.run(i % 2 ? "a" : "b");
    })();
    const source = kanbanRepositorySeed(root, "default");
    const tasks = source.filter((row) => row.collection === "task");
    expect(tasks).toHaveLength(2);
    expect(
      tasks.map((row) => (row.body as { events: unknown[] }).events.length),
    ).toEqual([10500, 10500]);
    expect(tasks[0].body).toMatchObject({ children: ["b"] });
  } finally {
    db.close();
  }
});

it("retains populated native attachment tables until byte synchronization is connected", () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-attachment-guard-")),
  );
  roots.push(root);
  const db = new Database(join(root, "kanban.db"));
  try {
    db.exec(
      readFileSync(
        join(process.cwd(), "tests/fixtures/agent-kanban-schema.sql"),
        "utf8",
      ),
    );
    db.exec(
      "INSERT INTO tasks(id,title,status,created_at) VALUES('a','A','todo',1);INSERT INTO task_attachments(task_id,filename,stored_path,size,created_at) VALUES('a','evidence.pdf','/private/retained.pdf',10,1)",
    );
    expect(() => kanbanRepositorySeed(root, "default")).toThrow(
      "byte synchronization",
    );
    expect(
      db.prepare("SELECT stored_path FROM task_attachments").get(),
    ).toEqual({ stored_path: "/private/retained.pdf" });
  } finally {
    db.close();
  }
});

// @lat: [[cloud-workspace-tests#Kanban device execution state isolation]]
it("keeps device claims and process identities outside cloud task/run projections and preserves them during metadata edits", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-runtime-state-")),
  );
  roots.push(root);
  const db = new Database(join(root, "kanban.db"));
  try {
    db.exec(
      readFileSync(
        join(process.cwd(), "tests/fixtures/agent-kanban-schema.sql"),
        "utf8",
      ),
    );
    db.exec(
      "INSERT INTO tasks(id,title,status,created_at,worker_pid,worker_started_at,claim_expires,last_heartbeat_at,current_run_id) VALUES('a','Original','done',1,42,43,44,45,1);INSERT INTO task_runs(id,task_id,status,started_at,claim_lock,worker_pid,worker_started_at,claim_expires,last_heartbeat_at,summary) VALUES(1,'a','done',1,'device-only-claim',52,53,54,55,'Retained result')",
    );
    const source = kanbanReplicaSnapshot(
      root,
      "default",
      "alice",
      "device",
    ).documents.find((row) => row.collection === "task")!;
    expect(JSON.stringify(source.body)).not.toContain("worker_pid");
    expect(JSON.stringify(source.body)).not.toContain("device-only-claim");
    const body = source.body as {
      task: Record<string, import("@mithril/workspace/repository").JsonValue>;
      [key: string]: import("@mithril/workspace/repository").JsonValue;
    };
    const result = applyKanbanReplica(root, "default", "alice", "device", {
      operationId: "metadata-only",
      expectedVersion: source.version,
      expectedRecord: source,
      document: {
        collection: "task",
        id: source.id,
        revision: 2,
        updatedAt: 2,
        deleted: false,
        body: { ...body, task: { ...body.task, title: "Cloud title" } },
      },
    });
    expect(result.status).toBe("applied");
    expect(result.record).toEqual(
      kanbanReplicaSnapshot(root, "default", "alice", "device").documents.find(
        (row) => row.collection === "task",
      ),
    );
    expect(
      db
        .prepare(
          "SELECT worker_pid,worker_started_at,claim_expires,last_heartbeat_at,current_run_id FROM tasks",
        )
        .get(),
    ).toEqual({
      worker_pid: 42,
      worker_started_at: 43,
      claim_expires: 44,
      last_heartbeat_at: 45,
      current_run_id: 1,
    });
    expect(
      db.prepare("SELECT claim_lock,worker_pid FROM task_runs").get(),
    ).toEqual({ claim_lock: "device-only-claim", worker_pid: 52 });
  } finally {
    db.close();
  }
});
