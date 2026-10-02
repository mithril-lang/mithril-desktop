// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  realpathSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { NativeKanbanStore } from "./native-kanban-store";
function fixture(
  run: (store: NativeKanbanStore, db: Database.Database, root: string) => void,
): void {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "kanban-cas-"));
  const db = new Database(join(root, "kanban.db"));
  db.exec(
    "CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,body TEXT,status TEXT,priority INTEGER,claim_lock TEXT,workspace_path TEXT);CREATE TABLE task_events(id INTEGER PRIMARY KEY,task_id TEXT,kind TEXT,payload TEXT,created_at INTEGER);",
  );
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?)").run(
    "native-id",
    "Original",
    "Body",
    "todo",
    1,
    null,
    "/private/unchanged",
  );
  try {
    run(new NativeKanbanStore(root), db, root);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}
describe("native Kanban actual SQLite CAS", () => {
  it("rejects a current-board switch while obtaining the writer lock", () =>
    fixture((store, db) => {
      const view = store.read();
      vi.spyOn(store as unknown as { board(): string }, "board")
        .mockReturnValueOnce("default")
        .mockReturnValue("other");
      expect(() =>
        store.change(view.revision, "native-id", {
          title: "Changed",
          body: "Body",
          priority: 2,
        }),
      ).toThrow(/board changed/);
      expect(db.prepare("SELECT status FROM tasks").get()).toEqual({
        status: "todo",
      });
      expect(db.prepare("SELECT count(*) AS n FROM task_events").get()).toEqual(
        { n: 0 },
      );
    }));
  it("edits actual metadata and appends native event without changing execution fields", () =>
    fixture((store, db) => {
      const view = store.read();
      store.change(view.revision, "native-id", {
        title: "Edited",
        body: "New body",
        priority: 2,
      });
      expect(db.prepare("SELECT * FROM tasks").get()).toMatchObject({
        title: "Edited",
        body: "New body",
        priority: 2,
        status: "todo",
        claim_lock: null,
        workspace_path: "/private/unchanged",
      });
      expect(
        db.prepare("SELECT kind FROM task_events ORDER BY id").all(),
      ).toEqual([{ kind: "reprioritized" }, { kind: "edited" }]);
    }));
  it("rejects stale full-row revisions after an actual concurrent database write", () =>
    fixture((store, db) => {
      const view = store.read();
      db.prepare("UPDATE tasks SET workspace_path = ?").run("/private/new");
      expect(() =>
        store.change(view.revision, "native-id", {
          title: "Changed",
          body: "Body",
          priority: 2,
        }),
      ).toThrow(/changed/);
      expect(db.prepare("SELECT count(*) AS n FROM task_events").get()).toEqual(
        { n: 0 },
      );
    }));
  it("blocks claimed/running tasks and preserves lifecycle when editing unclaimed rows", () =>
    fixture((store, db) => {
      db.prepare("UPDATE tasks SET status='running',claim_lock='claim'").run();
      expect(() =>
        store.change(store.read().revision, "native-id", {
          title: "Changed",
          body: "Body",
          priority: 2,
        }),
      ).toThrow(/claimed/);
      db.prepare("UPDATE tasks SET status='todo',claim_lock=NULL").run();
      store.change(store.read().revision, "native-id", {
        title: "Changed",
        body: "Body",
        priority: 2,
      });
      expect(db.prepare("SELECT status FROM tasks").get()).toEqual({
        status: "todo",
      });
    }));
  it("rolls back metadata if native event append fails", () =>
    fixture((store, db) => {
      db.exec("DROP TABLE task_events");
      expect(() =>
        store.change(store.read().revision, "native-id", {
          title: "Lost",
          body: "Body",
          priority: 0,
        }),
      ).toThrow();
      expect(db.prepare("SELECT title FROM tasks").get()).toEqual({
        title: "Original",
      });
    }));
  it("binds current board and refuses symlinked storage", () =>
    fixture((store, db, root) => {
      const view = store.read();
      mkdirSync(join(root, "kanban"), { recursive: true });
      writeFileSync(join(root, "kanban", "current"), "other");
      expect(() =>
        store.change(view.revision, "native-id", {
          title: "Changed",
          body: "Body",
          priority: 2,
        }),
      ).toThrow();
      writeFileSync(join(root, "kanban", "current"), "default");
      db.close();
      rmSync(join(root, "kanban.db"));
      symlinkSync(join(root, "elsewhere"), join(root, "kanban.db"));
      expect(() => store.read()).toThrow();
    }));
});
