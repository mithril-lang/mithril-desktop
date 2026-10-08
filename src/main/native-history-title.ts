import type Database from "better-sqlite3";
import { isDeepStrictEqual } from "util";
/** Apply cloud title only while the exact captured source title is unchanged.
 * The source database remains intact on duplicate titles or stale snapshots.
 */
export function applyCloudSessionTitle(
  db: Database.Database,
  id: string,
  expected: string | null,
  title: string,
): string {
  if (typeof title !== "string" || title.length > 512)
    throw Error("Invalid cloud title");
  db.transaction(() => {
    const row = db.prepare("SELECT title FROM sessions WHERE id=?").get(id) as
      | { title: string | null }
      | undefined;
    if (!row || row.title !== expected)
      throw Error("Native title changed; synchronization deferred");
    const columns = db.prepare("PRAGMA table_info(sessions)").all() as {
      name: string;
    }[];
    const provenance = columns.some((column) => column.name === "title_source")
      ? ",title_source='user'"
      : "";
    const result = db
      .prepare(
        `UPDATE sessions SET title=?${provenance} WHERE id=? AND title IS ?`,
      )
      .run(title, id, expected);
    if (result.changes !== 1)
      throw Error("Native title changed; synchronization deferred");
  })();
  return title || "Chat";
}

/** Update only archival model metadata under source CAS; this never selects a provider or executes a turn. */
export function applyCloudSessionModel(
  db: Database.Database,
  id: string,
  expected: string | null,
  model: string,
): string {
  if (typeof model !== "string" || !model || model.length > 256)
    throw Error("Invalid cloud model");
  db.transaction(() => {
    const row = db.prepare("SELECT model FROM sessions WHERE id=?").get(id) as
      | { model: string | null }
      | undefined;
    if (!row || row.model !== expected)
      throw Error("Native model changed; synchronization deferred");
    if (
      db
        .prepare("UPDATE sessions SET model=? WHERE id=? AND model IS ?")
        .run(model, id, expected).changes !== 1
    )
      throw Error("Native model changed; synchronization deferred");
  })();
  return model;
}

/** Keep every original message and linked field; only the admitted archive flag changes. */
export function applyCloudSessionArchive(
  db: Database.Database,
  id: string,
  expected: boolean,
  archived: boolean,
): boolean {
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "archived"))
    throw Error("Native archive schema unavailable");
  if (typeof expected !== "boolean" || typeof archived !== "boolean")
    throw Error("Invalid archive state");
  const lineageColumns = ["parent_session_id", "end_reason"].map((name) =>
    columns.some((column) => column.name === name),
  );
  if (lineageColumns[0] !== lineageColumns[1])
    throw Error("Incomplete native archive lineage schema");
  db.transaction(() => {
    const row = db.prepare("SELECT * FROM sessions WHERE id=?").get(id) as
      | ({ archived: number } & Record<string, unknown>)
      | undefined;
    if (!row || row.archived !== Number(expected))
      throw Error("Native archive changed; synchronization deferred");
    const lineageQuery = db.prepare(
      lineageColumns[0]
        ? `WITH RECURSIVE ancestors(id) AS (
      SELECT ? UNION SELECT parent.id FROM ancestors a JOIN sessions child ON child.id=a.id JOIN sessions parent ON parent.id=child.parent_session_id WHERE parent.end_reason='compression'
    ), descendants(id) AS (
      SELECT ? UNION SELECT child.id FROM descendants d JOIN sessions parent ON parent.id=d.id JOIN sessions child ON child.parent_session_id=parent.id WHERE parent.end_reason='compression'
    ), lineage(id) AS (SELECT id FROM ancestors UNION SELECT id FROM descendants)
    SELECT s.* FROM sessions s WHERE s.id IN (SELECT id FROM lineage) ORDER BY s.id`
        : "SELECT * FROM sessions WHERE id=? ORDER BY id",
    );
    const readLineage = (): Record<string, unknown>[] =>
      Array.from(
        lineageQuery.iterate(
          ...(lineageColumns[0] ? [id, id] : [id]),
        ) as Iterable<Record<string, unknown>>,
      );
    const lineage = readLineage();
    if (lineage.some((item) => item.archived !== 0 && item.archived !== 1))
      throw Error("Unsupported native archive lineage");
    for (let offset = 0; offset < lineage.length; offset += 100) {
      const ids = lineage
        .slice(offset, offset + 100)
        .map((item) => String(item.id));
      const parameters = ids.map(() => "?").join(",");
      if (
        db
          .prepare(`UPDATE sessions SET archived=? WHERE id IN (${parameters})`)
          .run(Number(archived), ...ids).changes !== ids.length
      )
        throw Error("Native archive changed; synchronization deferred");
    }
    // Recompute membership as well as every retained field after all batches.
    const saved = readLineage();
    if (
      !isDeepStrictEqual(
        saved,
        lineage.map((item) => ({ ...item, archived: Number(archived) })),
      )
    )
      throw Error("Native archive readback mismatch; source retained");
  }).immediate();
  return archived;
}
