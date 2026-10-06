import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "fs";
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
