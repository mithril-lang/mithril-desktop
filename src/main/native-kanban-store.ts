import Database from "better-sqlite3";
import { createHash } from "crypto";
import { existsSync, lstatSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type { KanbanTask } from "./kanban";
import { portableText } from "@mithril/workspace/runtime";

export interface NativeKanbanState {
  boardSlug: string;
  revision: string;
  tasks: (KanbanTask & { claim_lock?: string | null })[];
}
export type NativeKanbanChange = {
  title: string;
  body: string;
  priority: number;
};
const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function noSymlinks(path: string): void {
  let current = resolve(path);
  for (;;) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error("Unsafe native Kanban storage");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
/** Fixed existing local Hermes store. No CLI, hooks, dispatch, path inputs or file upload. */
export class NativeKanbanStore {
  constructor(
    private root: string,
    private boardOverride = "",
  ) {}
  private board(): string {
    const file = join(this.root, "kanban", "current");
    noSymlinks(file);
    if (
      existsSync(file) &&
      (!lstatSync(file).isFile() || lstatSync(file).size > 256)
    )
      throw new Error("Native Kanban board selector is unsupported");
    const slug =
      this.boardOverride.trim() ||
      (existsSync(file) ? readFileSync(file, "utf8").trim() : "default");
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug))
      throw new Error("Native Kanban board unavailable");
    return slug;
  }
  private open(slug: string, readonly: boolean): Database.Database {
    const file =
      slug === "default"
        ? join(this.root, "kanban.db")
        : join(this.root, "kanban", "boards", slug, "kanban.db");
    noSymlinks(file);
    const db = new Database(file, { readonly, fileMustExist: true });
    db.pragma("busy_timeout = 5000");
    return db;
  }
  private state(db: Database.Database, boardSlug: string): NativeKanbanState {
    const columns = db.prepare("PRAGMA table_info(tasks)").all() as {
      name: string;
    }[];
    if (
      !["id", "title", "body", "status", "priority", "claim_lock"].every(
        (name) => columns.some((column) => column.name === name),
      )
    )
      throw new Error("Native Kanban schema is unsupported");
    const rows = db
      .prepare("SELECT * FROM tasks ORDER BY id LIMIT 1001")
      .all() as Record<string, unknown>[];
    if (rows.length > 1000)
      throw new Error("Native Kanban has more than the supported task bound");
    return {
      boardSlug,
      revision: digest([boardSlug, rows]),
      tasks: rows as unknown as NativeKanbanState["tasks"],
    };
  }
  read(): NativeKanbanState {
    const board = this.board();
    const db = this.open(board, true);
    try {
      return db.transaction(() => this.state(db, board))();
    } finally {
      db.close();
    }
  }
  /** CAS and event append share SQLite's writer lock with actual Hermes writers. */
  change(
    expectedRevision: string,
    taskId: string,
    change: NativeKanbanChange,
  ): void {
    if (
      Object.keys(change).length !== 3 ||
      !portableText(change.title) ||
      !change.title.trim() ||
      change.title.length > 512 ||
      !portableText(change.body) ||
      !Number.isSafeInteger(change.priority) ||
      change.priority < -100 ||
      change.priority > 100
    )
      throw new Error("Invalid native Kanban edit");
    const board = this.board();
    const db = this.open(board, false);
    try {
      db.transaction(() => {
        if (this.board() !== board)
          throw new Error("Native Kanban board changed; inspect again");
        const state = this.state(db, board);
        if (state.revision !== expectedRevision)
          throw new Error("Native Kanban changed; inspect again");
        const task = state.tasks.find((row) => row.id === taskId);
        if (
          !task ||
          ![
            "triage",
            "todo",
            "scheduled",
            "ready",
            "blocked",
            "review",
            "done",
          ].includes(task.status) ||
          task.claim_lock
        )
          throw new Error("Task is claimed or unavailable for editing");
        if (this.board() !== board)
          throw new Error("Native Kanban board changed; inspect again");
        db.prepare(
          "UPDATE tasks SET title = ?, body = ?, priority = ? WHERE id = ?",
        ).run(change.title, change.body, change.priority, taskId);
        const event = db.prepare(
          "INSERT INTO task_events(task_id,kind,payload,created_at) VALUES (?,?,?,?)",
        );
        const now = Math.floor(Date.now() / 1000);
        event.run(
          taskId,
          "reprioritized",
          JSON.stringify({ priority: change.priority }),
          now,
        );
        event.run(
          taskId,
          "edited",
          JSON.stringify({
            fields: ["title", "body"],
          }),
          now,
        );
      }).immediate();
    } finally {
      db.close();
    }
  }
}
