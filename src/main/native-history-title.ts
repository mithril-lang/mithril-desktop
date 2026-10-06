import type Database from "better-sqlite3";
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
