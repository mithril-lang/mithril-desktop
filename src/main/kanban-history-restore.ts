import type Database from "better-sqlite3";
import {
  repositoryFingerprint,
  type JsonValue,
} from "@mithril/workspace/repository";
import { kanbanDeviceFields } from "./kanban-portable-record";
import {
  historyIdentities,
  projectKanbanHistory,
  retainHistoryIdentities,
  type HistoryIdentity,
  type HistoryTable,
} from "./kanban-history-identity";

export interface RestoredKanbanHistory {
  comments: Record<string, JsonValue>[];
  events: Record<string, JsonValue>[];
  rawComments: Record<string, JsonValue>[];
  rawEvents: Record<string, JsonValue>[];
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
  const plans: {
    table: HistoryTable;
    values: Record<string, unknown>[];
    authored: JsonValue[];
  }[] = [];
  const mappings: HistoryIdentity[] = [],
    prior = historyIdentities(db, taskId);
  const mappedCloudIds = new Set(
    prior.map((r) => `${r.table_name}:${r.cloud_id}`),
  );
  const mappedNativeIds = new Map(
    prior.map((r) => [`${r.table_name}:${r.native_id}`, r.cloud_id]),
  );
  const runIds = new Map(
    prior
      .filter((r) => r.table_name === "task_runs")
      .map((r) => [r.cloud_id, r.native_id]),
  );
  if (Array.isArray(existing?.runs))
    for (const row of existing.runs) {
      if (
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        typeof row.id === "number" &&
        !runIds.has(row.id)
      )
        runIds.set(row.id, row.id);
    }
  const hash = (row: JsonValue): string =>
    repositoryFingerprint({ body: row, deleted: false });
  const same = (a: JsonValue, b: JsonValue): boolean => hash(a) === hash(b);
  for (const [key, table] of [
    ["runs", "task_runs"],
    ["comments", "task_comments"],
    ["events", "task_events"],
  ] as const) {
    const rows = incoming[key] ?? [],
      retained = existing?.[key] ?? [];
    if (!Array.isArray(rows) || rows.length > 20000 || !Array.isArray(retained))
      return null;
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
    const largest = db.prepare(`SELECT MAX(id) AS id FROM ${table}`).get() as {
      id: number | null;
    };
    if (largest.id !== null && !Number.isSafeInteger(largest.id)) return null;
    let next =
      Math.max(
        largest.id ?? 0,
        ...rows.map((row) =>
          row &&
          typeof row === "object" &&
          !Array.isArray(row) &&
          typeof row.id === "number"
            ? row.id
            : 0,
        ),
      ) + 1;
    const ids = new Set<number>(),
      values: Record<string, unknown>[] = [],
      authored: JsonValue[] = [];
    for (const value of rows) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
      const row = value as Record<string, JsonValue>,
        cloudId = Number(row.id);
      if (
        !Number.isSafeInteger(row.id) ||
        cloudId < 1 ||
        ids.has(cloudId) ||
        row.task_id !== taskId
      )
        return null;
      ids.add(cloudId);
      if (Object.keys(row).some((f) => !columns.includes(f) && row[f] !== null))
        return null;
      authored.push(
        Object.fromEntries(
          Object.entries(row).filter(([f]) => columns.includes(f)),
        ) as JsonValue,
      );
      if (retainedHashes.has(hash(row))) continue;
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
          kanbanDeviceFields.some((f) => f in row))
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
      if (mappedCloudIds.has(`${table}:${cloudId}`)) return null;
      const collision = db
        .prepare(`SELECT task_id FROM ${table} WHERE id=?`)
        .get(cloudId) as { task_id: string } | undefined;
      if (
        collision?.task_id === taskId &&
        (!mappedNativeIds.has(`${table}:${cloudId}`) ||
          mappedNativeIds.get(`${table}:${cloudId}`) === cloudId)
      )
        return null;
      const nativeId = collision ? next++ : cloudId;
      if (!Number.isSafeInteger(nativeId)) return null;
      mappings.push({
        table_name: table,
        task_id: taskId,
        cloud_id: cloudId,
        native_id: nativeId,
      });
      if (key === "runs") runIds.set(cloudId, nativeId);
      const fields: Record<string, unknown> = {};
      for (const f of columns)
        if (f in row) {
          const v = row[f];
          fields[f] =
            key === "events" && f === "payload" ? JSON.stringify(v) : v;
          if (
            fields[f] !== null &&
            !["string", "number"].includes(typeof fields[f])
          )
            return null;
        }
      fields.id = nativeId;
      if (key === "events" && typeof row.run_id === "number") {
        if (!runIds.has(row.run_id)) return null;
        fields.run_id = runIds.get(row.run_id)!;
      }
      values.push(fields);
    }
    plans.push({ table, values, authored });
  }
  const read = (
    table: HistoryTable,
  ): ReturnType<typeof projectKanbanHistory> => {
    if (
      !db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
    )
      return { raw: [], portable: [] };
    return projectKanbanHistory(
      db,
      taskId,
      table,
      db
        .prepare(`SELECT * FROM ${table} WHERE task_id=?`)
        .all(taskId) as Record<string, unknown>[],
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
    retainHistoryIdentities(db, mappings);
    const comments = read("task_comments"),
      events = read("task_events"),
      runs = read("task_runs");
    for (const [table, rows] of [
      ["task_comments", comments.portable],
      ["task_events", events.portable],
      ["task_runs", runs.portable],
    ] as const) {
      if (!same(rows, plans.find((p) => p.table === table)?.authored ?? []))
        throw Error("History projection changed; source retained");
    }
    if (
      !same(
        incoming.latest_summary ?? null,
        runs.portable.at(-1)?.summary ?? null,
      )
    )
      throw Error("Historical summary does not match retained runs");
    return {
      comments: comments.portable,
      events: events.portable,
      rawComments: comments.raw,
      rawEvents: events.raw,
      rawRuns: runs.raw,
      runs: runs.portable,
    };
  };
}
