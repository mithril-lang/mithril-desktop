import type Database from "better-sqlite3";
import type { JsonValue } from "@mithril/workspace/repository";
import { portableKanbanRun } from "./kanban-portable-record";

export type HistoryTable = "task_comments" | "task_events" | "task_runs";
export interface HistoryIdentity {
  table_name: HistoryTable;
  task_id: string;
  cloud_id: number;
  native_id: number;
}
export function historyIdentities(
  db: Database.Database,
  taskId: string,
): HistoryIdentity[] {
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='mithril_history_ids'",
      )
      .get()
  )
    return [];
  const rows = db
    .prepare("SELECT * FROM mithril_history_ids WHERE task_id=? LIMIT 60001")
    .all(taskId) as HistoryIdentity[];
  if (
    rows.length > 60000 ||
    rows.some(
      (r) =>
        !["task_comments", "task_events", "task_runs"].includes(r.table_name) ||
        r.task_id !== taskId ||
        !Number.isSafeInteger(r.cloud_id) ||
        r.cloud_id < 1 ||
        !Number.isSafeInteger(r.native_id) ||
        r.native_id < 1,
    )
  )
    throw Error("Invalid history identity map");
  for (const row of rows) {
    const source = db
      .prepare(`SELECT task_id FROM ${row.table_name} WHERE id=?`)
      .get(row.native_id) as { task_id: string } | undefined;
    if (!source || source.task_id !== taskId)
      throw Error("Mapped history source changed; records retained");
  }
  return rows;
}

/** Only the portable projection exposes original cloud IDs; native UI keeps its real SQL keys. */
export function projectKanbanHistory(
  db: Database.Database,
  taskId: string,
  table: HistoryTable,
  rows: Record<string, unknown>[],
): { raw: Record<string, JsonValue>[]; portable: Record<string, JsonValue>[] } {
  const identities = historyIdentities(db, taskId);
  const ids = new Map(
    identities
      .filter((r) => r.table_name === table)
      .map((r) => [r.native_id, r.cloud_id]),
  );
  const runIds = new Map(
    identities
      .filter((r) => r.table_name === "task_runs")
      .map((r) => [r.native_id, r.cloud_id]),
  );
  const paired = rows
    .map((row) => {
      const raw = { ...row } as Record<string, JsonValue>;
      const value: Record<string, JsonValue> = {
        ...raw,
        id: ids.get(Number(raw.id)) ?? raw.id,
      };
      if (table === "task_events") {
        if (typeof value.payload === "string")
          value.payload = JSON.parse(value.payload);
        if (typeof value.run_id === "number")
          value.run_id = runIds.get(value.run_id) ?? value.run_id;
      }
      return {
        raw:
          table === "task_events" && typeof raw.payload === "string"
            ? { ...raw, payload: JSON.parse(raw.payload) }
            : raw,
        portable: table === "task_runs" ? portableKanbanRun(value) : value,
      };
    })
    .sort((a, b) => Number(a.portable.id) - Number(b.portable.id));
  if (new Set(paired.map((r) => r.portable.id)).size !== paired.length)
    throw Error("History identities overlap; source retained");
  return {
    raw: paired.map((r) => r.raw),
    portable: paired.map((r) => r.portable),
  };
}

export function retainHistoryIdentities(
  db: Database.Database,
  rows: HistoryIdentity[],
): void {
  if (!db.inTransaction)
    throw Error("History identity mapping requires a writer transaction");
  db.exec(
    "CREATE TABLE IF NOT EXISTS mithril_history_ids(table_name TEXT NOT NULL,task_id TEXT NOT NULL,cloud_id INTEGER NOT NULL,native_id INTEGER NOT NULL,PRIMARY KEY(table_name,task_id,cloud_id),UNIQUE(table_name,native_id))",
  );
  for (const row of rows)
    db.prepare("INSERT INTO mithril_history_ids VALUES(?,?,?,?)").run(
      row.table_name,
      row.task_id,
      row.cloud_id,
      row.native_id,
    );
}
