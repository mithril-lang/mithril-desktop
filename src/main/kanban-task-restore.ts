import { portableKanbanTask } from "./kanban-portable-record";
import type Database from "better-sqlite3";
import { createHash } from "crypto";
import { validBody, type JsonValue } from "@mithril/workspace/repository";
import type { TaskAttachment } from "@mithril/workspace/task-attachments";
import { planKanbanDependencies } from "./kanban-dependency-replica";
import { planKanbanHistoryRestore } from "./kanban-history-restore";
/** Restore a cloud-created inactive task into an existing board, without CLI/hooks. */
function restoreTask(
  db: Database.Database,
  documentId: string,
  value: JsonValue,
  restoreAttachments?: () => {
    rows: Record<string, unknown>[];
    resources: TaskAttachment[];
  },
): { body: JsonValue; version: string } | null {
  if (!db.inTransaction)
    throw Error("Task restoration requires a writer transaction");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid restored task");
  const incoming = value as Record<string, JsonValue>;
  if (
    !incoming.task ||
    typeof incoming.task !== "object" ||
    Array.isArray(incoming.task)
  )
    throw Error("Invalid restored task");
  const task = incoming.task as Record<string, JsonValue>;
  if (
    typeof task.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(task.id) ||
    typeof task.title !== "string" ||
    !task.title.trim() ||
    task.title.length > 512 ||
    typeof task.status !== "string" ||
    !["triage", "todo", "blocked", "review", "done", "archived"].includes(
      task.status,
    )
  )
    return null;
  for (const field of ["attachments"]) {
    if (field === "attachments" && restoreAttachments) continue;
    if (
      incoming[field] !== undefined &&
      (!Array.isArray(incoming[field]) ||
        (incoming[field] as JsonValue[]).length)
    )
      return null;
  }
  if (
    Object.keys(incoming).some(
      (key) =>
        ![
          "board",
          "task",
          "comments",
          "events",
          "runs",
          "dependencies",
          "parents",
          "children",
          "attachments",
          "latest_summary",
        ].includes(key),
    )
  )
    return null;
  for (const field of [
    "workspace_path",
    "claim_lock",
    "claim_expires",
    "worker_pid",
    "worker_started_at",
    "last_heartbeat_at",
    "current_run_id",
  ]) {
    if (task[field] !== undefined && task[field] !== null) return null;
  }
  if (db.prepare("SELECT 1 FROM tasks WHERE id=?").get(task.id)) return null;
  if (
    (
      db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as {
        count: number;
      }
    ).count >= 1000
  )
    return null;
  const schema = db.prepare("PRAGMA table_info(tasks)").all() as {
    name: string;
    notnull: number;
    dflt_value: string | null;
  }[];
  const columns = schema.map((column) => column.name);
  if (
    !["id", "title", "status"].every((key) => columns.includes(key)) ||
    columns.some((key) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key))
  )
    return null;
  if (
    Object.keys(task).some(
      (key) => !columns.includes(key) && task[key] !== null,
    )
  )
    return null;
  if (
    schema.some(
      (column) =>
        !(column.name in task) && column.notnull && column.dflt_value === null,
    )
  )
    return null;
  const values: Record<string, unknown> = {};
  for (const key of columns)
    if (key in task) {
      const v = task[key];
      values[key] =
        key === "skills" && Array.isArray(v)
          ? JSON.stringify(v)
          : typeof v === "boolean"
            ? Number(v)
            : v;
      if (
        values[key] !== null &&
        !["string", "number"].includes(typeof values[key])
      )
        return null;
    }
  const fields = Object.keys(values);
  const restoreHistory = planKanbanHistoryRestore(db, task.id, incoming);
  if (!restoreHistory) return null;
  db.prepare(
    "INSERT INTO tasks (" +
      fields.map((key) => '"' + key + '"').join(",") +
      ") VALUES(" +
      fields.map(() => "?").join(",") +
      ")",
  ).run(...fields.map((key) => values[key]));
  const raw = db
    .prepare("SELECT * FROM tasks WHERE id=?")
    .get(task.id) as Record<string, JsonValue>;
  // Reject schema coercion rather than acknowledge an altered authored value.
  for (const key of fields)
    if (JSON.stringify(raw[key]) !== JSON.stringify(values[key]))
      throw Error("Task schema changed data; source retained");
  db.exec(
    "CREATE TABLE IF NOT EXISTS mithril_repository_task_ids(task_id TEXT PRIMARY KEY,document_id TEXT UNIQUE NOT NULL)",
  );
  db.prepare("INSERT INTO mithril_repository_task_ids VALUES(?,?)").run(
    task.id,
    documentId,
  );
  const graph = planKanbanDependencies(db, task.id, {
    dependencies: incoming.dependencies ?? [],
    parents: incoming.parents ?? [],
    children: incoming.children ?? [],
  });
  if (!graph) return null;
  const dependencies = graph.apply();
  const projected = portableKanbanTask(raw);
  const history = restoreHistory();
  const attachments = restoreAttachments?.();
  const body = {
    board: incoming.board,
    task: projected,
    comments: history.comments,
    events: history.events,
    runs: history.runs,
    dependencies,
    parents: dependencies
      .filter((edge) => edge.child_id === task.id)
      .map((edge) => edge.parent_id),
    children: dependencies
      .filter((edge) => edge.parent_id === task.id)
      .map((edge) => edge.child_id),
    latest_summary: history.rawRuns.at(-1)?.summary ?? null,
    ...(attachments ? { attachments: attachments.resources } : {}),
  };
  // Match the source snapshot's raw-row/relationship fingerprint.
  const version = createHash("sha256")
    .update(
      JSON.stringify([
        raw,
        history.rawComments,
        history.rawEvents,
        history.rawRuns,
        dependencies,
        ...(attachments?.rows.length
          ? [{ rows: attachments.rows, resources: attachments.resources }]
          : []),
      ]),
    )
    .digest("hex");
  if (!validBody(body)) throw Error("Restored task cannot be represented");
  return { body, version };
}

/** A deferred restore must not commit a partial task, mapping, history or graph. */
export function restoreKanbanTask(
  ...args: Parameters<typeof restoreTask>
): ReturnType<typeof restoreTask> {
  const [db] = args;
  if (!db.inTransaction)
    throw Error("Task restoration requires a writer transaction");
  const deferred = new Error("Task restoration deferred");
  try {
    return db.transaction(() => {
      const result = restoreTask(...args);
      if (!result) throw deferred;
      return result;
    })();
  } catch (error) {
    if (error === deferred) return null;
    throw error;
  }
}
