import type Database from "better-sqlite3";

interface AttachmentIdentity {
  task_id: string;
  cloud_id: number;
  native_id: number;
}
/** Private aliases keep original SQLite attachment keys out of cloud identity collisions. */
export function attachmentIdentities(
  db: Database.Database,
  taskId: string,
): AttachmentIdentity[] {
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='mithril_attachment_ids'",
      )
      .get()
  )
    return [];
  const rows = db
    .prepare("SELECT * FROM mithril_attachment_ids WHERE task_id=? LIMIT 10001")
    .all(taskId) as AttachmentIdentity[];
  if (
    rows.length > 10000 ||
    rows.some(
      (row) =>
        row.task_id !== taskId ||
        !Number.isSafeInteger(row.cloud_id) ||
        row.cloud_id < 1 ||
        !Number.isSafeInteger(row.native_id) ||
        row.native_id < 1,
    )
  )
    throw Error("Invalid attachment identity map");
  for (const row of rows) {
    const source = db
      .prepare("SELECT task_id FROM task_attachments WHERE id=?")
      .get(row.native_id) as { task_id: string } | undefined;
    if (source?.task_id !== taskId)
      throw Error("Mapped attachment source changed; files retained");
  }
  return rows;
}
export function portableAttachmentRows(
  db: Database.Database,
  taskId: string,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const ids = new Map(
    attachmentIdentities(db, taskId).map((row) => [
      row.native_id,
      row.cloud_id,
    ]),
  );
  const projected = rows.map((row) => ({
    ...row,
    id: ids.get(Number(row.id)) ?? row.id,
  }));
  if (new Set(projected.map((row) => row.id)).size !== projected.length)
    throw Error("Attachment identities overlap; files retained");
  return projected;
}
