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

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Historical task reconstruction]]
it("restores actual-schema comments, events and terminal runs with original IDs, exact source snapshots and retained receipts", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const sourceRoot = realpathSync(
      mkdtempSync(join(tmpdir(), "mithril-history-source-")),
    ),
    targetRoot = realpathSync(
      mkdtempSync(join(tmpdir(), "mithril-history-target-")),
    );
  roots.push(sourceRoot, targetRoot);
  const source = new Database(join(sourceRoot, "kanban.db")),
    target = new Database(join(targetRoot, "kanban.db"));
  try {
    const schema = readFileSync(
      join(process.cwd(), "tests/fixtures/agent-kanban-schema.sql"),
      "utf8",
    );
    source.exec(schema);
    target.exec(schema);
    source.exec(
      "INSERT INTO tasks(id,title,status,created_at,completed_at,result) VALUES('original','Original history','done',1,9,'Retained result');INSERT INTO task_comments(id,task_id,author,body,created_at) VALUES(17,'original','alice','Full original comment',3);INSERT INTO task_runs(id,task_id,profile,status,started_at,ended_at,outcome,summary,metadata,error,worker_pid,claim_lock) VALUES(23,'original','default','failed',2,4,'spawn_failed','Prior failure','{\"source\":\"original\"}','Retained error',555,'old-device');INSERT INTO task_runs(id,task_id,profile,status,started_at,ended_at,outcome,summary,metadata) VALUES(29,'original','default','done',5,9,'completed','Final original summary','{\"receipt\":391}');INSERT INTO task_events(id,task_id,run_id,kind,payload,created_at) VALUES(31,'original',23,'failed','{\"detail\":[1,2,3]}',4);INSERT INTO task_events(id,task_id,run_id,kind,payload,created_at) VALUES(37,'original',29,'completed','{\"receipt\":391}',9)",
    );
    const original = kanbanReplicaSnapshot(
      sourceRoot,
      "default",
      "alice",
      "source-device",
    ).documents.find((r) => r.collection === "task")!;
    const operation = {
      operationId: "restore-full-history",
      expectedVersion: null,
      expectedRecord: null,
      document: {
        collection: "task" as const,
        id: original.id,
        body: original.body,
        revision: 1,
        deleted: false,
        updatedAt: 10,
      },
    };
    const accepted = applyKanbanReplica(
      targetRoot,
      "default",
      "alice",
      "target-device",
      operation,
    );
    expect(accepted.status).toBe("applied");
    expect(accepted.record?.body).toEqual(original.body);
    expect(accepted.record).toEqual(
      kanbanReplicaSnapshot(
        targetRoot,
        "default",
        "alice",
        "target-device",
      ).documents.find((r) => r.id === original.id),
    );
    expect(
      applyKanbanReplica(
        targetRoot,
        "default",
        "alice",
        "target-device",
        operation,
      ),
    ).toEqual(accepted);
    expect(
      target.prepare("SELECT id,task_id FROM task_comments").all(),
    ).toEqual([{ id: 17, task_id: "original" }]);
    expect(
      target
        .prepare(
          "SELECT id,status,worker_pid,claim_lock,last_heartbeat_at FROM task_runs ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: 23,
        status: "failed",
        worker_pid: null,
        claim_lock: null,
        last_heartbeat_at: null,
      },
      {
        id: 29,
        status: "done",
        worker_pid: null,
        claim_lock: null,
        last_heartbeat_at: null,
      },
    ]);
    expect(
      target.prepare("SELECT id,run_id FROM task_events ORDER BY id").all(),
    ).toEqual([
      { id: 31, run_id: 23 },
      { id: 37, run_id: 29 },
    ]);
    expect(
      target.prepare("SELECT count(*) AS n FROM kanban_notify_subs").get(),
    ).toEqual({ n: 0 });
    expect(
      target
        .prepare(
          "SELECT count(*) AS n FROM tasks WHERE status IN ('ready','scheduled','running')",
        )
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    source.close();
    target.close();
  }
});

it("retains the entire task restoration on invalid history, conflicting IDs, SQL coercion or active run authority", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  for (const mode of [
    "running",
    "lease",
    "duplicate",
    "unknown",
    "summary",
    "coercion",
  ]) {
    const sourceRoot = realpathSync(
        mkdtempSync(join(tmpdir(), "mithril-history-admission-source-")),
      ),
      targetRoot = realpathSync(
        mkdtempSync(join(tmpdir(), "mithril-history-admission-target-")),
      );
    roots.push(sourceRoot, targetRoot);
    const source = new Database(join(sourceRoot, "kanban.db")),
      target = new Database(join(targetRoot, "kanban.db"));
    try {
      const schema = readFileSync(
        join(process.cwd(), "tests/fixtures/agent-kanban-schema.sql"),
        "utf8",
      );
      source.exec(schema);
      target.exec(schema);
      source.exec(
        "INSERT INTO tasks(id,title,status,created_at) VALUES('original','History','done',1);INSERT INTO task_comments(id,task_id,author,body,created_at) VALUES(17,'original','alice','Retain me',1);INSERT INTO task_runs(id,task_id,status,started_at,ended_at,summary) VALUES(23,'original','done',1,2,'Original summary')",
      );
      const original = kanbanReplicaSnapshot(
        sourceRoot,
        "default",
        "alice",
        "source-device",
      ).documents.find((r) => r.collection === "task")!;
      const body = structuredClone(original.body) as Record<
        string,
        import("@mithril/workspace/repository").JsonValue
      >;
      const runs = body.runs as Record<
        string,
        import("@mithril/workspace/repository").JsonValue
      >[];
      if (mode === "running") runs[0].status = "running";
      if (mode === "lease") runs[0].claim_lock = "other-device";
      if (mode === "duplicate")
        (body.comments as unknown[]).push(
          structuredClone((body.comments as unknown[])[0]),
        );
      if (mode === "unknown") runs[0].unsupported = "Retain unknown field";
      if (mode === "summary") body.latest_summary = "Invented summary";
      if (mode === "collision")
        target.exec(
          "INSERT INTO tasks(id,title,status,created_at) VALUES('existing','Existing','done',1);INSERT INTO task_comments(id,task_id,author,body,created_at) VALUES(17,'existing','owner','Existing original row',1)",
        );
      if (mode === "coercion")
        target.exec(
          "CREATE TRIGGER coerce_history AFTER INSERT ON task_comments BEGIN UPDATE task_comments SET body='Changed' WHERE id=NEW.id; END",
        );
      const apply = (): ReturnType<typeof applyKanbanReplica> =>
        applyKanbanReplica(targetRoot, "default", "alice", "target-device", {
          operationId: mode,
          expectedRecord: null,
          expectedVersion: null,
          document: {
            collection: "task",
            id: original.id,
            body,
            revision: 1,
            deleted: false,
            updatedAt: 10,
          },
        });
      if (mode === "summary" || mode === "coercion") expect(apply).toThrow();
      else expect(apply().status).toBe("deferred");
      expect(
        target.prepare("SELECT id FROM tasks WHERE id='original'").get(),
      ).toBeUndefined();
      expect(
        target.prepare("SELECT count(*) AS n FROM task_runs").get(),
      ).toEqual({ n: 0 });
      expect(
        target.prepare("SELECT count(*) AS n FROM task_comments").get(),
      ).toEqual({ n: mode === "collision" ? 1 : 0 });
      expect(
        target.prepare("SELECT count(*) AS n FROM kanban_notify_subs").get(),
      ).toEqual({ n: 0 });
    } finally {
      source.close();
      target.close();
    }
  }
});

it("appends terminal run receipts to an existing task without replacing prior history or native process authority", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-history-append-")),
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
      "INSERT INTO tasks(id,title,status,created_at) VALUES('original','History','done',1);INSERT INTO task_runs(id,task_id,status,started_at,ended_at,summary,worker_pid,claim_lock) VALUES(1,'original','failed',1,2,'Earlier failure',555,'old-source-lock')",
    );
    const original = kanbanReplicaSnapshot(
      root,
      "default",
      "alice",
      "device",
    ).documents.find((r) => r.collection === "task")!;
    db.exec(
      "INSERT INTO task_runs(id,task_id,status,started_at,ended_at,outcome,summary,metadata) VALUES(2,'original','done',3,4,'completed','Remote completion','{\"receipt\":391}');INSERT INTO task_events(id,task_id,run_id,kind,payload,created_at) VALUES(3,'original',2,'completed','{\"receipt\":391}',4)",
    );
    const incoming = kanbanReplicaSnapshot(
      root,
      "default",
      "alice",
      "device",
    ).documents.find((r) => r.id === original.id)!;
    db.exec(
      "DELETE FROM task_events WHERE id=3;DELETE FROM task_runs WHERE id=2",
    );
    const operation = {
      operationId: "append-terminal-run",
      expectedRecord: original,
      expectedVersion: original.version,
      document: {
        collection: "task" as const,
        id: original.id,
        body: incoming.body,
        revision: 2,
        deleted: false,
        updatedAt: 4,
      },
    };
    const accepted = applyKanbanReplica(
      root,
      "default",
      "alice",
      "device",
      operation,
    );
    expect(accepted.status).toBe("applied");
    expect(accepted.record?.body).toEqual(incoming.body);
    expect(accepted.record).toEqual(
      kanbanReplicaSnapshot(root, "default", "alice", "device").documents.find(
        (r) => r.id === original.id,
      ),
    );
    expect(
      db
        .prepare("SELECT worker_pid,claim_lock FROM task_runs WHERE id=1")
        .get(),
    ).toEqual({ worker_pid: 555, claim_lock: "old-source-lock" });
    expect(
      db
        .prepare("SELECT worker_pid,claim_lock FROM task_runs WHERE id=2")
        .get(),
    ).toEqual({ worker_pid: null, claim_lock: null });
    expect(
      applyKanbanReplica(root, "default", "alice", "device", operation),
    ).toEqual(accepted);
    const changed = structuredClone(accepted.record!.body) as Record<
      string,
      import("@mithril/workspace/repository").JsonValue
    >;
    (
      changed.runs as Record<
        string,
        import("@mithril/workspace/repository").JsonValue
      >[]
    )[0].summary = "Rewritten older history";
    expect(
      applyKanbanReplica(root, "default", "alice", "device", {
        ...operation,
        operationId: "history-overwrite",
        expectedRecord: accepted.record!,
        expectedVersion: accepted.record!.version,
        document: { ...operation.document, body: changed },
      }).status,
    ).toBe("deferred");
    expect(
      db.prepare("SELECT summary FROM task_runs WHERE id=1").get(),
    ).toEqual({ summary: "Earlier failure" });
  } finally {
    db.close();
  }
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Historical row identity collisions]]
it("reconciles colliding history IDs without overwriting existing rows, preserves event/run links and converges native additions back to the source", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const sourceRoot = realpathSync(
      mkdtempSync(join(tmpdir(), "mithril-history-id-source-")),
    ),
    targetRoot = realpathSync(
      mkdtempSync(join(tmpdir(), "mithril-history-id-target-")),
    );
  roots.push(sourceRoot, targetRoot);
  const source = new Database(join(sourceRoot, "kanban.db")),
    target = new Database(join(targetRoot, "kanban.db"));
  try {
    const schema = readFileSync(
      join(process.cwd(), "tests/fixtures/agent-kanban-schema.sql"),
      "utf8",
    );
    source.exec(schema);
    target.exec(schema);
    source.exec(
      "INSERT INTO tasks(id,title,status,created_at) VALUES('remote','Remote history','done',1);INSERT INTO task_comments(id,task_id,author,body,created_at) VALUES(1,'remote','alice','Remote comment',1);INSERT INTO task_runs(id,task_id,status,started_at,ended_at,summary) VALUES(1,'remote','done',1,2,'Remote summary');INSERT INTO task_events(id,task_id,run_id,kind,payload,created_at) VALUES(1,'remote',1,'completed','\"Receipt 391\"',2)",
    );
    target.exec(
      "INSERT INTO tasks(id,title,status,created_at) VALUES('existing','Existing history','done',1);INSERT INTO task_comments(id,task_id,author,body,created_at) VALUES(1,'existing','owner','Existing comment',1);INSERT INTO task_comments(id,task_id,author,body,created_at) VALUES(7,'existing','owner','Existing later comment',3);INSERT INTO task_runs(id,task_id,status,started_at,ended_at,summary) VALUES(1,'existing','done',1,2,'Existing summary');INSERT INTO task_runs(id,task_id,status,started_at,ended_at,summary) VALUES(7,'existing','failed',2,3,'Existing later run');INSERT INTO task_events(id,task_id,run_id,kind,payload,created_at) VALUES(1,'existing',1,'completed','{\"existing\":true}',2);INSERT INTO task_events(id,task_id,run_id,kind,payload,created_at) VALUES(7,'existing',7,'failed','{\"existing\":true}',3)",
    );
    const original = kanbanReplicaSnapshot(
      sourceRoot,
      "default",
      "alice",
      "source",
    ).documents.find((r) => r.collection === "task")!;
    const before = kanbanReplicaSnapshot(
      targetRoot,
      "default",
      "alice",
      "target",
    ).documents.find((r) => r.collection === "task")!;
    const operation = {
      operationId: "colliding-history",
      expectedRecord: null,
      expectedVersion: null,
      document: {
        collection: "task" as const,
        id: original.id,
        body: original.body,
        revision: 1,
        deleted: false,
        updatedAt: 2,
      },
    };
    const accepted = applyKanbanReplica(
      targetRoot,
      "default",
      "alice",
      "target",
      operation,
    );
    expect(accepted.status).toBe("applied");
    expect(accepted.record?.body).toEqual(original.body);
    expect(
      applyKanbanReplica(targetRoot, "default", "alice", "target", operation),
    ).toEqual(accepted);
    expect(
      kanbanReplicaSnapshot(
        targetRoot,
        "default",
        "alice",
        "target",
      ).documents.find((r) => r.id === before.id),
    ).toEqual(before);
    expect(accepted.record).toEqual(
      kanbanReplicaSnapshot(
        targetRoot,
        "default",
        "alice",
        "target",
      ).documents.find((r) => r.id === original.id),
    );
    const identities = target
      .prepare(
        "SELECT table_name,cloud_id,native_id FROM mithril_history_ids ORDER BY table_name",
      )
      .all();
    expect(identities).toEqual([
      { table_name: "task_comments", cloud_id: 1, native_id: 8 },
      { table_name: "task_events", cloud_id: 1, native_id: 8 },
      { table_name: "task_runs", cloud_id: 1, native_id: 8 },
    ]);
    expect(
      target
        .prepare("SELECT id,run_id FROM task_events WHERE task_id='remote'")
        .get(),
    ).toEqual({ id: 8, run_id: 8 });
    target.exec(
      "INSERT INTO task_comments(task_id,author,body,created_at) VALUES('remote','native','Original Agent addition',5)",
    );
    const changed = kanbanReplicaSnapshot(
      targetRoot,
      "default",
      "alice",
      "target",
    ).documents.find((r) => r.id === original.id)!;
    expect(changed.body).toMatchObject({
      comments: [
        { id: 1, body: "Remote comment" },
        { id: 9, body: "Original Agent addition" },
      ],
      events: [{ id: 1, run_id: 1, payload: "Receipt 391" }],
    });
    const mirrored = applyKanbanReplica(
      sourceRoot,
      "default",
      "alice",
      "source",
      {
        operationId: "native-addition-back",
        expectedRecord: original,
        expectedVersion: original.version,
        document: { ...operation.document, body: changed.body, revision: 2 },
      },
    );
    expect(mirrored.status).toBe("applied");
    expect(mirrored.record?.body).toEqual(changed.body);
    expect(mirrored.record).toEqual(
      kanbanReplicaSnapshot(
        sourceRoot,
        "default",
        "alice",
        "source",
      ).documents.find((r) => r.id === original.id),
    );
    source.exec(
      "INSERT INTO task_comments(id,task_id,author,body,created_at) VALUES(8,'remote','source','Later original ID overlaps target alias',6)",
    );
    const sourceAdded = kanbanReplicaSnapshot(
      sourceRoot,
      "default",
      "alice",
      "source",
    ).documents.find((r) => r.id === original.id)!;
    const targetAdded = applyKanbanReplica(
      targetRoot,
      "default",
      "alice",
      "target",
      {
        operationId: "later-cloud-id-overlaps-alias",
        expectedRecord: changed,
        expectedVersion: changed.version,
        document: {
          ...operation.document,
          body: sourceAdded.body,
          revision: 3,
        },
      },
    );
    expect(targetAdded.status).toBe("applied");
    expect(targetAdded.record?.body).toEqual(sourceAdded.body);
    expect(
      target.prepare("SELECT body FROM task_comments WHERE id=8").get(),
    ).toEqual({ body: "Remote comment" });
    expect(
      target
        .prepare(
          "SELECT id,body FROM task_comments WHERE body='Later original ID overlaps target alias'",
        )
        .get(),
    ).toEqual({ id: 10, body: "Later original ID overlaps target alias" });
    target.exec("DELETE FROM task_comments WHERE id=8");
    expect(() =>
      kanbanReplicaSnapshot(targetRoot, "default", "alice", "target"),
    ).toThrow("Mapped history source changed");
    expect(
      source.prepare("SELECT body FROM task_comments WHERE id=1").get(),
    ).toEqual({ body: "Remote comment" });
    target.exec(
      "DELETE FROM task_comments WHERE task_id='remote';DELETE FROM task_events WHERE task_id='remote';DELETE FROM task_runs WHERE task_id='remote';DELETE FROM tasks WHERE id='remote'",
    );
    expect(() =>
      kanbanReplicaSnapshot(targetRoot, "default", "alice", "target"),
    ).toThrow("Mapped history task changed");
  } finally {
    source.close();
    target.close();
  }
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#New task dependency reconstruction]]
it("restores new inactive task dependencies with exact source receipts and rolls deferred endpoints back", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mithril-task-graph-")));
  roots.push(root);
  const db = new Database(join(root, "kanban.db"));
  try {
    db.exec(
      readFileSync(
        join(process.cwd(), "tests/fixtures/agent-kanban-schema.sql"),
        "utf8",
      ),
    );
    db.prepare(
      "INSERT INTO tasks(id,title,status,created_at,workspace_path) VALUES(?,?,?,?,?)",
    ).run("parent", "Parent", "todo", 10, "/private/parent");
    const source = kanbanReplicaSnapshot(
      root,
      "default",
      "alice",
      "device",
    ).documents.find((row) => row.collection === "task")!;
    const body = source.body as Record<
      string,
      import("@mithril/workspace/repository").JsonValue
    >;
    const task = body.task as Record<
      string,
      import("@mithril/workspace/repository").JsonValue
    >;
    const write = {
      operationId: "new-task-graph",
      expectedRecord: null,
      expectedVersion: null,
      document: {
        collection: "task" as const,
        id: "cloud-child",
        revision: 1,
        updatedAt: 1,
        deleted: false,
        body: {
          ...body,
          task: { ...task, id: "child", title: "Child" },
          dependencies: [{ parent_id: "parent", child_id: "child" }],
          parents: ["parent"],
          children: [],
        },
      },
    };
    const missing = {
      ...write,
      document: {
        ...write.document,
        body: {
          ...write.document.body,
          dependencies: [{ parent_id: "missing", child_id: "child" }],
          parents: ["missing"],
        },
      },
    };
    expect(
      applyKanbanReplica(root, "default", "alice", "device", missing).status,
    ).toBe("deferred");
    expect(db.prepare("SELECT id FROM tasks ORDER BY id").all()).toEqual([
      { id: "parent" },
    ]);
    expect(db.prepare("SELECT * FROM task_links").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM mithril_replica_receipts").all()).toEqual(
      [],
    );
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='mithril_repository_task_ids'",
        )
        .all(),
    ).toEqual([]);
    db.prepare("UPDATE tasks SET status='ready' WHERE id='parent'").run();
    expect(
      applyKanbanReplica(root, "default", "alice", "device", write).status,
    ).toBe("deferred");
    expect(db.prepare("SELECT id FROM tasks ORDER BY id").all()).toEqual([
      { id: "parent" },
    ]);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='mithril_repository_task_ids'",
        )
        .all(),
    ).toEqual([]);
    db.prepare("UPDATE tasks SET status='todo' WHERE id='parent'").run();
    const result = applyKanbanReplica(
      root,
      "default",
      "alice",
      "device",
      write,
    );
    expect(result.status).toBe("applied");
    expect(result.record).toEqual(
      kanbanReplicaSnapshot(root, "default", "alice", "device").documents.find(
        (row) => row.id === "cloud-child",
      ),
    );
    expect(
      applyKanbanReplica(root, "default", "alice", "device", write),
    ).toEqual(result);
    expect(db.prepare("SELECT * FROM task_links").all()).toEqual(
      write.document.body.dependencies,
    );
    expect(
      db.prepare("SELECT workspace_path FROM tasks WHERE id='parent'").get(),
    ).toEqual({ workspace_path: "/private/parent" });
  } finally {
    db.close();
  }
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Connected task group restoration]]
it("restores an entire absent task component atomically with source equality and retained receipt", async () => {
  const { kanbanReplicaSnapshot, applyKanbanReplica } =
    await import("./repository-kanban-runtime");
  const sourceRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-graph-source-")),
  );
  const targetRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-graph-target-")),
  );
  roots.push(sourceRoot, targetRoot);
  const schema = readFileSync(
    join(process.cwd(), "tests/fixtures/agent-kanban-schema.sql"),
    "utf8",
  );
  for (const root of [sourceRoot, targetRoot]) {
    const db = new Database(join(root, "kanban.db"));
    db.exec(schema);
    db.close();
  }
  const source = new Database(join(sourceRoot, "kanban.db"));
  source.exec(
    "INSERT INTO tasks(id,title,status,created_at) VALUES('a','A','todo',1),('b','B','todo',2),('c','C','todo',3);INSERT INTO task_links VALUES('a','b'),('b','c');INSERT INTO task_comments(task_id,author,body,created_at) VALUES('b','alice','Original comment',4)",
  );
  source.close();
  const documents = kanbanReplicaSnapshot(
    sourceRoot,
    "default",
    "alice",
    "device",
  )
    .documents.filter((row) => row.collection === "task")
    .map((row) => ({
      collection: row.collection,
      id: row.id,
      body: row.body,
      deleted: false,
      revision: 1,
      updatedAt: 1,
    }));
  const requested = documents.find(
    (row) => (row.body as { task: { id: string } }).task.id === "b",
  )!;
  const write = {
    operationId: "component",
    document: requested,
    expectedRecord: null,
    expectedVersion: null,
  };
  const apply = (docs = documents): ReturnType<typeof applyKanbanReplica> =>
    applyKanbanReplica(
      targetRoot,
      "default",
      "alice",
      "device",
      write,
      undefined,
      undefined,
      undefined,
      false,
      docs,
    );
  const incomplete = documents.filter(
    (row) => (row.body as { task: { id: string } }).task.id !== "c",
  );
  expect(apply(incomplete).status).toBe("deferred");
  const target = new Database(join(targetRoot, "kanban.db"));
  try {
    expect(target.prepare("SELECT * FROM tasks").all()).toEqual([]);
    expect(target.prepare("SELECT * FROM task_links").all()).toEqual([]);
    expect(target.prepare("SELECT * FROM task_comments").all()).toEqual([]);
    const executable = documents.map((document) => {
      const body = document.body as Record<
        string,
        import("@mithril/workspace/repository").JsonValue
      >;
      const task = body.task as Record<
        string,
        import("@mithril/workspace/repository").JsonValue
      >;
      return task.id === "c"
        ? {
            ...document,
            body: { ...body, task: { ...task, status: "running" } },
          }
        : document;
    });
    expect(apply(executable).status).toBe("deferred");
    expect(target.prepare("SELECT * FROM tasks").all()).toEqual([]);
    expect(target.prepare("SELECT * FROM task_comments").all()).toEqual([]);
    expect(
      target
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='mithril_repository_task_ids'",
        )
        .all(),
    ).toEqual([]);
    const result = apply();
    expect(result.status).toBe("applied");
    const snapshot = kanbanReplicaSnapshot(
      targetRoot,
      "default",
      "alice",
      "device",
    );
    expect(result.record).toEqual(
      snapshot.documents.find((row) => row.id === requested.id),
    );
    expect(
      snapshot.documents
        .filter((row) => row.collection === "task")
        .map((row) => ({ id: row.id, body: row.body }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      documents
        .map((row) => ({ id: row.id, body: row.body }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(apply()).toEqual(result);
    expect(
      target.prepare("SELECT COUNT(*) AS count FROM task_comments").get(),
    ).toEqual({ count: 1 });
  } finally {
    target.close();
  }
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Stable task component inventory]]
it("requires complete repeated cloud inventories with the same owner and revisions", async () => {
  const { readStableKanbanTasks } = await import("./kanban-task-group-restore");
  const document = {
    collection: "task" as const,
    id: "task-a",
    body: { task: { id: "a" } },
    deleted: false,
    revision: 1,
    updatedAt: 1,
  };
  const guard = vi.fn(async () => undefined);
  const page = vi.fn(async () => ({
    schemaVersion: 1 as const,
    userId: "alice",
    documents: [document],
    nextAfter: null,
  }));
  expect(await readStableKanbanTasks(page, "alice", guard)).toEqual([document]);
  expect(page).toHaveBeenCalledTimes(2);
  expect(guard).toHaveBeenCalledTimes(4);
  page.mockResolvedValueOnce({
    schemaVersion: 1,
    userId: "bob",
    documents: [document],
    nextAfter: null,
  });
  await expect(readStableKanbanTasks(page, "alice", guard)).rejects.toThrow(
    "owner/page",
  );
  page
    .mockResolvedValueOnce({
      schemaVersion: 1,
      userId: "alice",
      documents: [document],
      nextAfter: null,
    })
    .mockResolvedValueOnce({
      schemaVersion: 1,
      userId: "alice",
      documents: [{ ...document, revision: 2 }],
      nextAfter: null,
    });
  await expect(readStableKanbanTasks(page, "alice", guard)).rejects.toThrow(
    "revisions changed",
  );
});
