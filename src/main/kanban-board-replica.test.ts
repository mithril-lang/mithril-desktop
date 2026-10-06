import { kanbanBoardRecord, pendingKanbanBoards } from "./kanban-board-replica";
import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  existsSync,
  chmodSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  applyKanbanReplica,
  kanbanReplicaSnapshot,
} from "./repository-kanban-runtime";
import type { ReplicaWrite } from "@mithril/workspace/replica-sync";
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
function root(): string {
  const r = realpathSync(mkdtempSync(join(tmpdir(), "mithril-board-replica-")));
  roots.push(r);
  return r;
}
function operation(): ReplicaWrite {
  return {
    operationId: "new-original-board",
    expectedRecord: null,
    expectedVersion: null,
    document: {
      collection: "board",
      id: "evidence",
      revision: 1,
      updatedAt: 1,
      deleted: false,
      body: {
        slug: "evidence",
        name: "証拠整理",
        is_current: false,
        total: 0,
        counts: {},
        description: "Original display metadata",
        icon: "folder",
        color: "#123456",
        archived: false,
        project_id: null,
        created_at: 123,
      },
    },
  };
}
function apply(
  r: string,
  w = operation(),
): ReturnType<typeof applyKanbanReplica> {
  return applyKanbanReplica(
    r,
    "default",
    "alice",
    "replica",
    w,
    undefined,
    undefined,
    "/usr/bin/python3",
  );
}
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud-created board working copy]]
it("publishes the original empty schema, metadata and receipt together, then accepts tasks through the original working copy", () => {
  const r = root(),
    w = operation(),
    result = apply(r, w);
  expect(result.status).toBe("applied");
  expect(kanbanBoardRecord(r, "original-work", []).body).toMatchObject({
    name: "Original Work",
  });
  expect(result.record).toEqual(
    kanbanReplicaSnapshot(r, "default", "alice", "replica").documents.find(
      (d) => d.collection === "board",
    ),
  );
  const file = join(r, "kanban", "boards", "evidence", "kanban.db"),
    db = new Database(file);
  expect(db.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM kanban_notify_subs").get(),
  ).toEqual({ n: 0 });
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM mithril_replica_receipts").get(),
  ).toEqual({ n: 1 });
  expect(
    JSON.parse(
      readFileSync(
        join(r, "kanban", "boards", "evidence", "board.json"),
        "utf8",
      ),
    ),
  ).toMatchObject({
    name: "証拠整理",
    description: "Original display metadata",
  });
  db.close();
  expect(apply(r, w)).toEqual(result);
  expect(() =>
    apply(r, {
      ...w,
      document: {
        ...w.document,
        body: { ...(w.document.body as object), name: "Changed operation" },
      },
    }),
  ).toThrow("Replica operation was reused");
  expect(
    applyKanbanReplica(r, "default", "alice", "replica", {
      operationId: "new-task-in-restored-board",
      expectedRecord: null,
      expectedVersion: null,
      document: {
        collection: "task",
        id: "cloud-task",
        revision: 1,
        updatedAt: 1,
        deleted: false,
        body: {
          board: "evidence",
          task: {
            id: "native-task",
            title: "Restored task",
            status: "todo",
            created_at: 123,
          },
          comments: [],
          events: [],
          runs: [],
          dependencies: [],
          parents: [],
          children: [],
          latest_summary: null,
        },
      },
    }).status,
  ).toBe("applied");
  const native = new Database(file, { readonly: true });
  expect(native.prepare("SELECT id,title,status FROM tasks").get()).toEqual({
    id: "native-task",
    title: "Restored task",
    status: "todo",
  });
  native.close();
  expect(readdirSync(join(r, "kanban", "boards"))).toEqual(["evidence"]);
});
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Board publication refusal]]
it("retains existing directories and refuses symlinks, execution metadata and unsupported publication before creating a board", () => {
  const r = root(),
    target = join(r, "kanban", "boards", "evidence");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "original"), "retained");
  expect(apply(r).status).toBe("conflict");
  expect(readFileSync(join(target, "original"), "utf8")).toBe("retained");
  expect(existsSync(join(target, "kanban.db"))).toBe(false);
  const unsafe = root();
  mkdirSync(join(unsafe, "kanban"));
  symlinkSync(r, join(unsafe, "kanban", "boards"));
  expect(() => apply(unsafe)).toThrow("Unsafe");
  const rejected = root(),
    w = operation();
  expect(
    apply(rejected, {
      ...w,
      document: {
        ...w.document,
        body: {
          ...(w.document.body as object),
          default_workdir: "/private/device",
        },
      },
    }).status,
  ).toBe("deferred");
  expect(existsSync(join(rejected, "kanban"))).toBe(false);
  const stopped = root();
  expect(() =>
    applyKanbanReplica(
      stopped,
      "default",
      "alice",
      "replica",
      w,
      undefined,
      undefined,
      "/missing/python",
    ),
  ).toThrow();
  expect(existsSync(join(stopped, "kanban", "boards", "evidence"))).toBe(false);
  expect(readdirSync(join(stopped, "kanban", "boards"))).toEqual([]);
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Concurrent board publication]]
it("never replaces a target created during publication and recovers an exact receipt after acknowledgement loss", () => {
  const r = root(),
    scripts = root();
  const wrapper = join(scripts, "publisher.py"),
    launcher = join(scripts, "python");
  writeFileSync(
    wrapper,
    "import os,sys\ntarget=sys.argv[-1]\nos.mkdir(target)\nopen(os.path.join(target,'winner'),'w').write('other writer')\nos.execv(sys.executable,[sys.executable]+sys.argv[1:])\n",
  );
  writeFileSync(
    launcher,
    `#!/bin/sh\nexec /usr/bin/python3 -I '${wrapper}' "$@"\n`,
  );
  chmodSync(launcher, 0o700);
  const w = operation();
  expect(
    applyKanbanReplica(
      r,
      "default",
      "alice",
      "replica",
      w,
      undefined,
      undefined,
      launcher,
    ).status,
  ).toBe("conflict");
  expect(
    readFileSync(join(r, "kanban", "boards", "evidence", "winner"), "utf8"),
  ).toBe("other writer");
  expect(readdirSync(join(r, "kanban", "boards"))).toEqual(["evidence"]);
  const restored = root(),
    receipt = apply(restored, w);
  writeFileSync(
    join(restored, "kanban", "boards", "evidence", "board.json"),
    JSON.stringify({
      name: "Later original edit",
      default_workdir: "/private/original",
    }),
  );
  expect(apply(restored, w)).toEqual(receipt);
  const fresh = kanbanReplicaSnapshot(
    restored,
    "default",
    "alice",
    "replica",
  ).documents.find((d) => d.collection === "board")!;
  expect(fresh.body).toMatchObject({ name: "Later original edit" });
  expect(fresh.version).not.toBe(receipt.record!.version);
  expect(JSON.stringify(fresh.body)).not.toContain("/private/original");
  expect(() =>
    applyKanbanReplica(
      restored,
      "default",
      "bob",
      "replica",
      w,
      undefined,
      undefined,
      "/usr/bin/python3",
    ),
  ).toThrow("Invalid retained task receipt");
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Default board initialization]]
it("initializes a missing default DB without changing original display metadata, current selection or existing boards", () => {
  const r = root(),
    w = operation();
  w.document.id = "default";
  w.operationId = "initialize-default";
  w.document.body = {
    slug: "default",
    name: "Default",
    is_current: false,
    total: 0,
    counts: {},
  };
  mkdirSync(join(r, "kanban"), { recursive: true });
  writeFileSync(join(r, "kanban", "current"), "another-board\n");
  const result = apply(r, w);
  expect(result.status).toBe("applied");
  expect(result.record).toEqual(
    kanbanReplicaSnapshot(r, "default", "alice", "replica").documents.find(
      (d) => d.id === "default",
    ),
  );
  expect(readFileSync(join(r, "kanban", "current"), "utf8")).toBe(
    "another-board\n",
  );
  expect(existsSync(join(r, "kanban", "boards", "default", "board.json"))).toBe(
    false,
  );
  const db = new Database(join(r, "kanban.db"));
  expect(db.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM task_runs").get()).toEqual({
    n: 0,
  });
  db.close();
  expect(apply(r, w)).toEqual(result);
  expect(
    applyKanbanReplica(r, "default", "alice", "replica", {
      operationId: "task-in-default",
      expectedRecord: null,
      expectedVersion: null,
      document: {
        collection: "task",
        id: "default-task",
        revision: 1,
        updatedAt: 1,
        deleted: false,
        body: {
          board: "default",
          task: {
            id: "original-task",
            title: "Default original task",
            status: "todo",
            created_at: 12,
          },
          comments: [],
          events: [],
          runs: [],
          dependencies: [],
          parents: [],
          children: [],
          latest_summary: null,
        },
      },
    }).status,
  ).toBe("applied");
  const withMetadata = root(),
    path = join(withMetadata, "kanban", "boards", "default", "board.json");
  mkdirSync(join(withMetadata, "kanban", "boards", "default"), {
    recursive: true,
  });
  writeFileSync(
    path,
    JSON.stringify({
      name: "Original default",
      description: "Keep original display",
      default_workdir: "/private/original",
    }),
  );
  const originalBytes = readFileSync(path, "utf8"),
    incoming = {
      ...w,
      operationId: "default-with-native-metadata",
      document: {
        ...w.document,
        body: kanbanBoardRecord(withMetadata, "default", []).body,
      },
    };
  expect(apply(withMetadata, incoming).status).toBe("applied");
  expect(readFileSync(path, "utf8")).toBe(originalBytes);
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Default board publication collision]]
it("retains a concurrently created default database and refuses incompatible original metadata", () => {
  const r = root(),
    scripts = root(),
    w = operation();
  w.document.id = "default";
  w.operationId = "default-collision";
  w.document.body = {
    slug: "default",
    name: "Default",
    is_current: false,
    total: 0,
    counts: {},
  };
  const wrapper = join(scripts, "default-writer.py"),
    launcher = join(scripts, "python");
  writeFileSync(
    wrapper,
    "import os,sys,sqlite3\nfile=os.path.join(sys.argv[-1],'kanban.db')\ndb=sqlite3.connect(file)\ndb.execute('CREATE TABLE original_marker(value TEXT)')\ndb.execute(\"INSERT INTO original_marker VALUES('other writer')\")\ndb.commit();db.close()\nos.execv(sys.executable,[sys.executable]+sys.argv[1:])\n",
  );
  writeFileSync(
    launcher,
    `#!/bin/sh\nexec /usr/bin/python3 -I '${wrapper}' "$@"\n`,
  );
  chmodSync(launcher, 0o700);
  expect(
    applyKanbanReplica(
      r,
      "default",
      "alice",
      "replica",
      w,
      undefined,
      undefined,
      launcher,
    ).status,
  ).toBe("conflict");
  const original = new Database(join(r, "kanban.db"));
  expect(original.prepare("SELECT value FROM original_marker").get()).toEqual({
    value: "other writer",
  });
  expect(
    original.prepare("SELECT name FROM sqlite_master WHERE name='tasks'").get(),
  ).toBeUndefined();
  original.close();
  expect(readdirSync(r)).toEqual(["kanban.db"]);
  const changed = root();
  mkdirSync(join(changed, "kanban", "boards", "default"), { recursive: true });
  writeFileSync(
    join(changed, "kanban", "boards", "default", "board.json"),
    JSON.stringify({ name: "Another original title" }),
  );
  expect(apply(changed, w).status).toBe("deferred");
  expect(existsSync(join(changed, "kanban.db"))).toBe(false);
});

function metadataFixture(): {
  r: string;
  w: ReplicaWrite;
  file: string;
  db: string;
} {
  const r = root();
  apply(r);
  const file = join(r, "kanban", "boards", "evidence", "board.json");
  unlinkSync(file);
  const observed = kanbanReplicaSnapshot(
    r,
    "default",
    "alice",
    "replica",
  ).documents.find((row) => row.collection === "board")!;
  const w: ReplicaWrite = {
    ...operation(),
    operationId: "adopt-original-metadata",
    expectedRecord: observed,
    expectedVersion: observed.version,
  };
  return {
    r,
    w,
    file,
    db: join(r, "kanban", "boards", "evidence", "kanban.db"),
  };
}
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Absent board metadata adoption]]
it("adopts cloud display metadata into an existing original DB without changing tasks, selection or dispatch", () => {
  const { r, w, file, db: fileDb } = metadataFixture();
  const db = new Database(fileDb);
  db.prepare(
    "INSERT INTO tasks(id,title,status,created_at) VALUES('original','Retained','todo',1)",
  ).run();
  db.close();
  const observed = kanbanReplicaSnapshot(
    r,
    "default",
    "alice",
    "replica",
  ).documents.find((row) => row.collection === "board")!;
  w.expectedRecord = observed;
  w.expectedVersion = observed.version;
  writeFileSync(join(r, "kanban", "current"), "another-board\n");
  const accepted = apply(r, w);
  expect(accepted.status).toBe("applied");
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
    name: "証拠整理",
    description: "Original display metadata",
  });
  expect(accepted.record).toEqual(
    kanbanReplicaSnapshot(r, "default", "alice", "replica").documents.find(
      (row) => row.collection === "board",
    ),
  );
  expect(apply(r, w)).toEqual(accepted);
  expect(pendingKanbanBoards(r)).toEqual([]);
  const original = new Database(fileDb, { readonly: true });
  expect(original.prepare("SELECT id,title,status FROM tasks").all()).toEqual([
    { id: "original", title: "Retained", status: "todo" },
  ]);
  expect(original.prepare("SELECT COUNT(*) AS n FROM task_runs").get()).toEqual(
    { n: 0 },
  );
  original.close();
  expect(readFileSync(join(r, "kanban", "current"), "utf8")).toBe(
    "another-board\n",
  );
});
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Board metadata crash recovery]]
it("recovers exact preparation after publication interruption and retains its receipt across later source edits", () => {
  const { r, w, file, db: fileDb } = metadataFixture(),
    wrapper = join(r, "interrupted-python");
  writeFileSync(
    wrapper,
    '#!/usr/bin/python3\nimport subprocess,sys\np=subprocess.run(["/usr/bin/python3",*sys.argv[1:]])\nsys.exit(71)\n',
  );
  chmodSync(wrapper, 0o700);
  expect(() =>
    applyKanbanReplica(
      r,
      "default",
      "alice",
      "replica",
      w,
      undefined,
      undefined,
      wrapper,
    ),
  ).toThrow();
  expect(existsSync(file)).toBe(true);
  expect(pendingKanbanBoards(r)).toEqual(["evidence"]);
  expect(() => kanbanReplicaSnapshot(r, "default", "alice", "replica")).toThrow(
    "requires recovery",
  );
  expect(() =>
    applyKanbanReplica(
      r,
      "default",
      "bob",
      "replica",
      w,
      undefined,
      undefined,
      "/usr/bin/python3",
    ),
  ).toThrow("owner");
  expect(() =>
    apply(r, {
      ...w,
      document: {
        ...w.document,
        body: { ...(w.document.body as object), name: "Changed operation" },
      },
    }),
  ).toThrow("reused");
  const db = new Database(fileDb);
  db.prepare(
    "INSERT INTO tasks(id,title,status,created_at) VALUES('later','Later original edit','todo',2)",
  ).run();
  db.close();
  const accepted = apply(r, w);
  expect(accepted.status).toBe("applied");
  expect(pendingKanbanBoards(r)).toEqual([]);
  expect(
    kanbanReplicaSnapshot(r, "default", "alice", "replica").documents.some(
      (row) => row.collection === "task",
    ),
  ).toBe(true);
  writeFileSync(
    file,
    JSON.stringify({
      slug: "evidence",
      name: "Later name",
      default_workdir: "/private/native",
    }),
  );
  expect(apply(r, w)).toEqual(accepted);
  expect(kanbanBoardRecord(r, "evidence", []).body).toMatchObject({
    name: "Later name",
  });
});
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Board metadata concurrent creation]]
it("preserves another writer metadata created during publication and resumes complete source reads", () => {
  const { r, w, file } = metadataFixture(),
    wrapper = join(r, "concurrent-python");
  writeFileSync(
    wrapper,
    '#!/usr/bin/python3\nimport subprocess,sys,json\nwith open(sys.argv[-1],"x") as f:json.dump({"slug":"evidence","name":"Concurrent original","default_workdir":"/private/native"},f)\nsys.exit(subprocess.run(["/usr/bin/python3",*sys.argv[1:]]).returncode)\n',
  );
  chmodSync(wrapper, 0o700);
  const result = applyKanbanReplica(
    r,
    "default",
    "alice",
    "replica",
    w,
    undefined,
    undefined,
    wrapper,
  );
  expect(result.status).toBe("conflict");
  expect(result.record?.body).toMatchObject({ name: "Concurrent original" });
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
    default_workdir: "/private/native",
  });
  expect(pendingKanbanBoards(r)).toEqual([]);
  expect(kanbanReplicaSnapshot(r, "default", "alice", "replica").complete).toBe(
    true,
  );
});
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Board metadata preparation refusal]]
it("rejects stale metadata preparation and preserves existing files including private settings", () => {
  const { r, w, file, db: fileDb } = metadataFixture();
  const db = new Database(fileDb);
  db.prepare(
    "INSERT INTO tasks(id,title,status,created_at) VALUES('later','Later','todo',1)",
  ).run();
  db.close();
  expect(apply(r, w).status).toBe("conflict");
  expect(existsSync(file)).toBe(false);
  expect(pendingKanbanBoards(r)).toEqual([]);
  writeFileSync(
    file,
    JSON.stringify({
      slug: "evidence",
      name: "Original",
      default_workdir: "/private/native",
    }),
  );
  const original = readFileSync(file, "utf8");
  expect(apply(r, w).status).toBe("deferred");
  expect(readFileSync(file, "utf8")).toBe(original);
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Unpublished metadata recovery conflict]]
it("abandons unpublished preparation if original tasks change before recovery without suppressing the new source", () => {
  const { r, w, file, db: fileDb } = metadataFixture(),
    wrapper = join(r, "before-publication-python");
  writeFileSync(wrapper, "#!/usr/bin/python3\nimport sys\nsys.exit(71)\n");
  chmodSync(wrapper, 0o700);
  expect(() =>
    applyKanbanReplica(
      r,
      "default",
      "alice",
      "replica",
      w,
      undefined,
      undefined,
      wrapper,
    ),
  ).toThrow();
  expect(existsSync(file)).toBe(false);
  expect(pendingKanbanBoards(r)).toEqual(["evidence"]);
  const db = new Database(fileDb);
  db.prepare(
    "INSERT INTO tasks(id,title,status,created_at) VALUES('later','Retained original edit','todo',2)",
  ).run();
  db.close();
  expect(apply(r, w).status).toBe("conflict");
  expect(pendingKanbanBoards(r)).toEqual([]);
  expect(existsSync(file)).toBe(false);
  expect(
    kanbanReplicaSnapshot(r, "default", "alice", "replica").documents.some(
      (row) => row.collection === "task",
    ),
  ).toBe(true);
  const oversized = metadataFixture();
  expect(
    apply(oversized.r, {
      ...oversized.w,
      document: {
        ...oversized.w.document,
        body: {
          ...(oversized.w.document.body as object),
          description: "界".repeat(16000),
          icon: "界".repeat(16000),
        },
      },
    }).status,
  ).toBe("deferred");
  expect(existsSync(oversized.file)).toBe(false);
  expect(pendingKanbanBoards(oversized.r)).toEqual([]);
});
