import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { planKanbanDependencies } from "./kanban-dependency-replica";
function fixture(): Database.Database {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE tasks(id TEXT PRIMARY KEY,status TEXT,claim_lock TEXT); CREATE TABLE task_dependencies(parent_id TEXT,child_id TEXT,created_at INTEGER,PRIMARY KEY(parent_id,child_id));",
  );
  for (const id of ["a", "b", "c", "d"])
    db.prepare("INSERT INTO tasks VALUES(?,'todo',NULL)").run(id);
  db.exec("INSERT INTO task_dependencies VALUES('a','b',1),('c','d',2);");
  return db;
}
const incoming = {
  dependencies: [{ parent_id: "a", child_id: "c", created_at: 3 }],
  parents: [],
  children: ["c"],
};
// @lat: [[cloud-workspace-tests#Native dependency graph reconciliation]]
it("replaces only the reviewed task edges and preserves other graph metadata", () => {
  const db = fixture();
  try {
    db.transaction(() => {
      const plan = planKanbanDependencies(db, "a", incoming)!;
      expect(
        db
          .prepare("SELECT child_id FROM task_dependencies WHERE parent_id='a'")
          .get(),
      ).toEqual({ child_id: "b" });
      plan.apply();
    }).immediate();
    expect(
      db.prepare("SELECT * FROM task_dependencies ORDER BY parent_id").all(),
    ).toEqual([
      { parent_id: "a", child_id: "c", created_at: 3 },
      { parent_id: "c", child_id: "d", created_at: 2 },
    ]);
    expect(db.prepare("SELECT DISTINCT status FROM tasks").all()).toEqual([
      { status: "todo" },
    ]);
  } finally {
    db.close();
  }
});
it("refuses cycles, mismatched projections, duplicate edges and unsupported data without writing", () => {
  const db = fixture();
  try {
    for (const input of [
      { ...incoming, children: ["b"] },
      {
        ...incoming,
        dependencies: [...incoming.dependencies, ...incoming.dependencies],
      },
      {
        dependencies: [
          { parent_id: "a", child_id: "b", created_at: 1 },
          { parent_id: "b", child_id: "a", created_at: 4 },
        ],
        parents: ["b"],
        children: ["b"],
      },
      {
        dependencies: [{ parent_id: "a", child_id: "a", created_at: 4 }],
        parents: ["a"],
        children: ["a"],
      },
      {
        ...incoming,
        dependencies: [
          { parent_id: "a", child_id: "c", created_at: 3, unknown: "lost" },
        ],
      },
    ])
      expect(() =>
        db
          .transaction(() => planKanbanDependencies(db, "a", input))
          .immediate(),
      ).toThrow();
    expect(
      db
        .prepare("SELECT child_id FROM task_dependencies WHERE parent_id='a'")
        .get(),
    ).toEqual({ child_id: "b" });
  } finally {
    db.close();
  }
});
it("defers until endpoints exist and are idle, including a removed edge endpoint", () => {
  const db = fixture();
  try {
    db.exec("UPDATE tasks SET claim_lock='worker' WHERE id='b'");
    expect(planKanbanDependencies(db, "a", incoming)).toBeNull();
    db.exec("UPDATE tasks SET claim_lock=NULL,status='ready' WHERE id='b'");
    expect(planKanbanDependencies(db, "a", incoming)).toBeNull();
    db.exec("UPDATE tasks SET status='todo';DELETE FROM tasks WHERE id='c'");
    expect(planKanbanDependencies(db, "a", incoming)).toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM task_dependencies").get(),
    ).toEqual({ count: 2 });
  } finally {
    db.close();
  }
});
it("rolls graph writes back with the caller's transaction", () => {
  const db = fixture();
  try {
    expect(() =>
      db
        .transaction(() => {
          planKanbanDependencies(db, "a", incoming)!.apply();
          throw Error("metadata failed");
        })
        .immediate(),
    ).toThrow("metadata failed");
    expect(
      db
        .prepare("SELECT child_id FROM task_dependencies WHERE parent_id='a'")
        .get(),
    ).toEqual({ child_id: "b" });
  } finally {
    db.close();
  }
});

it("rolls back silent SQLite value coercion instead of acknowledging a different graph", () => {
  const db = fixture();
  try {
    expect(() =>
      db
        .transaction(() => {
          planKanbanDependencies(db, "a", {
            ...incoming,
            dependencies: [{ parent_id: "a", child_id: "c", created_at: "3" }],
          })!.apply();
        })
        .immediate(),
    ).toThrow("schema changed data");
    expect(
      db
        .prepare("SELECT child_id FROM task_dependencies WHERE parent_id='a'")
        .get(),
    ).toEqual({ child_id: "b" });
  } finally {
    db.close();
  }
});
