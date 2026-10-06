import type Database from "better-sqlite3";
import {
  repositoryFingerprint,
  type JsonValue,
} from "@mithril/workspace/repository";
import {
  kanbanDeviceFields,
  portableKanbanRun,
} from "./kanban-portable-record";

export interface RestoredKanbanHistory {
  comments: Record<string, JsonValue>[];
  events: Record<string, JsonValue>[];
  rawRuns: Record<string, JsonValue>[];
  runs: Record<string, JsonValue>[];
}

/** Admit historical data before inserting a task; active run authority is never restored. */
export function planKanbanHistoryRestore(
  db: Database.Database,
  taskId: string,
  incoming: Record<string, JsonValue>,
  existing?: Record<string, JsonValue>,
): (() => RestoredKanbanHistory) | null {
  if (!db.inTransaction)
    throw Error("History restoration requires a writer transaction");
  const plans: { table: string; values: Record<string, unknown>[] }[] = [];
  const same = (a: JsonValue, b: JsonValue): boolean =>
    repositoryFingerprint({ body: a, deleted: false }) ===
    repositoryFingerprint({ body: b, deleted: false });
  for (const [key, table] of [
    ["comments", "task_comments"],
    ["events", "task_events"],
    ["runs", "task_runs"],
  ]) {
    const rows = incoming[key] ?? [];
    if (!Array.isArray(rows) || rows.length > 20000) return null;
    const retained = existing?.[key] ?? [];
    if (!Array.isArray(retained)) return null;
    const hash = (row: JsonValue): string =>
      repositoryFingerprint({ body: row, deleted: false });
    const retainedHashes = new Set(retained.map(hash)),
      incomingHashes = new Set(rows.map(hash));
    if ([...retainedHashes].some((old) => !incomingHashes.has(old)))
      return null;
    if (!rows.length) continue;
    const schema = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const columns = schema.map((r) => r.name);
    if (
      !columns.includes("id") ||
      !columns.includes("task_id") ||
      columns.some((c) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c))
    )
      return null;
    const ids = new Set<number>(),
      values: Record<string, unknown>[] = [];
    for (const value of rows) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
      const row = value as Record<string, JsonValue>;
      if (
        !Number.isSafeInteger(row.id) ||
        Number(row.id) < 1 ||
        ids.has(Number(row.id)) ||
        row.task_id !== taskId
      )
        return null;
      ids.add(Number(row.id));
      if (retainedHashes.has(hash(row))) continue;
      if (Object.keys(row).some((field) => !columns.includes(field)))
        return null;
      if (
        key === "runs" &&
        (typeof row.status !== "string" ||
          ![
            "done",
            "blocked",
            "crashed",
            "timed_out",
            "failed",
            "released",
          ].includes(row.status) ||
          kanbanDeviceFields.some((field) => field in row))
      )
        return null;
      if (
        schema.some(
          (c) =>
            c.notnull &&
            c.dflt_value === null &&
            (!(c.name in row) || row[c.name] === null),
        )
      )
        return null;
      if (db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(row.id))
        return null;
      const fields: Record<string, unknown> = {};
      for (const field of columns)
        if (field in row) {
          const value = row[field];
          fields[field] =
            key === "events" && field === "payload"
              ? JSON.stringify(value)
              : value;
          if (
            fields[field] !== null &&
            !["string", "number"].includes(typeof fields[field])
          )
            return null;
        }
      values.push(fields);
    }
    plans.push({ table, values });
  }
  const read = (table: string): Record<string, JsonValue>[] => {
    if (
      !db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
    )
      return [];
    return (
      db
        .prepare(`SELECT * FROM ${table} WHERE task_id=? ORDER BY id`)
        .all(taskId) as Record<string, JsonValue>[]
    ).map((row) =>
      table === "task_events" && typeof row.payload === "string"
        ? { ...row, payload: JSON.parse(row.payload) }
        : row,
    );
  };
  return () => {
    for (const plan of plans)
      for (const row of plan.values) {
        const fields = Object.keys(row);
        db.prepare(
          `INSERT INTO ${plan.table} (${fields.map((f) => `"${f}"`).join(",")}) VALUES(${fields.map(() => "?").join(",")})`,
        ).run(...fields.map((f) => row[f]));
        const stored = db
          .prepare(`SELECT * FROM ${plan.table} WHERE id=?`)
          .get(row.id) as Record<string, unknown>;
        if (
          fields.some(
            (f) => JSON.stringify(row[f]) !== JSON.stringify(stored[f]),
          )
        )
          throw Error("History schema changed data; source retained");
      }
    const comments = read("task_comments"),
      events = read("task_events"),
      rawRuns = read("task_runs"),
      runs = rawRuns.map(portableKanbanRun);
    for (const [key, rows] of [
      ["comments", comments],
      ["events", events],
      ["runs", runs],
    ] as const) {
      const authored = incoming[key] ?? [];
      if (!same(rows, authored))
        throw Error("History projection changed; source retained");
    }
    if (!same(incoming.latest_summary ?? null, rawRuns.at(-1)?.summary ?? null))
      throw Error("Historical summary does not match retained runs");
    return { comments, events, rawRuns, runs };
  };
}
