import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  validateChatOperation,
  validateChatSession,
  type ChatOperation,
  type ChatOperationResponse,
} from "@mithril/workspace/sessions";

const LINKS = "mithril_history_source_links";
const DELETIONS = "mithril_history_source_deletions";
export interface NativeHistoryDeletion {
  sourceId: string;
  sessionId: string;
  operationId: string;
  baseRevision: number | null;
}
const exists = (db: Database.Database, table: string): boolean =>
  !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
const id = (value: string): boolean =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function schema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${LINKS}(source_id TEXT PRIMARY KEY,owner TEXT NOT NULL,profile TEXT NOT NULL,session_id TEXT NOT NULL,UNIQUE(owner,profile,session_id));
    CREATE TABLE IF NOT EXISTS ${DELETIONS}(operation_id TEXT PRIMARY KEY,source_id TEXT NOT NULL,owner TEXT NOT NULL,profile TEXT NOT NULL,session_id TEXT NOT NULL,base_revision INTEGER,acknowledged INTEGER NOT NULL DEFAULT 0,receipt_json TEXT,UNIQUE(source_id,owner,profile));
    CREATE INDEX IF NOT EXISTS mithril_history_pending_deletions ON ${DELETIONS}(owner,profile,acknowledged,operation_id);`);
}
/** Establish provenance while source rows still exist, before any asynchronous cloud publication. */
export function bindNativeHistorySources(
  db: Database.Database,
  owner: string,
  profile: string,
  sources: Array<{ sourceId: string; sessionId: string }>,
): void {
  if (
    !id(owner) ||
    typeof profile !== "string" ||
    !profile ||
    profile.length > 256 ||
    sources.some(
      (source) =>
        typeof source.sourceId !== "string" ||
        !source.sourceId ||
        source.sourceId.length > 512 ||
        !id(source.sessionId),
    )
  )
    throw Error("Invalid history source mapping");
  db.transaction(() => {
    schema(db);
    for (const source of sources) {
      if (
        !db.prepare("SELECT id FROM sessions WHERE id=?").get(source.sourceId)
      )
        throw Error("Native source changed before mapping");
      const old = db
        .prepare(
          `SELECT owner,profile,session_id FROM ${LINKS} WHERE source_id=?`,
        )
        .get(source.sourceId) as
        | { owner: string; profile: string; session_id: string }
        | undefined;
      if (
        old &&
        (old.owner !== owner ||
          old.profile !== profile ||
          old.session_id !== source.sessionId)
      )
        throw Error("Native history source belongs to another owner");
      db.prepare(
        `INSERT OR IGNORE INTO ${LINKS}(source_id,owner,profile,session_id) VALUES(?,?,?,?)`,
      ).run(source.sourceId, owner, profile, source.sessionId);
    }
  })();
}
/** Must be called inside the exact original session deletion transaction. No network or filesystem writes. */
export function recordNativeHistoryDeletion(
  db: Database.Database,
  sourceId: string,
): void {
  if (!exists(db, LINKS)) return;
  if (!db.inTransaction)
    throw Error("History deletion requires original SQLite transaction");
  const source = db
    .prepare(`SELECT owner,profile,session_id FROM ${LINKS} WHERE source_id=?`)
    .get(sourceId) as
    | { owner: string; profile: string; session_id: string }
    | undefined;
  if (
    !source ||
    !db.prepare("SELECT id FROM sessions WHERE id=?").get(sourceId)
  )
    return;
  if (!id(source.owner) || !id(source.session_id) || !source.profile)
    throw Error("Invalid history deletion owner");
  db.prepare(
    `INSERT INTO ${DELETIONS}(operation_id,source_id,owner,profile,session_id) VALUES(?,?,?,?,?) ON CONFLICT(source_id,owner,profile) DO UPDATE SET operation_id=excluded.operation_id,base_revision=NULL,acknowledged=0,receipt_json=NULL WHERE acknowledged=1`,
  ).run(
    randomUUID(),
    sourceId,
    source.owner,
    source.profile,
    source.session_id,
  );
}
interface DeletionRow {
  source_id: string;
  session_id: string;
  operation_id: string;
  base_revision: number | null;
}
const pendingSourceDeleted =
  "d.owner=? AND d.profile=? AND d.acknowledged=0 AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.id=d.source_id)";
function deletionRow(row: DeletionRow): NativeHistoryDeletion {
  if (
    typeof row.source_id !== "string" ||
    !row.source_id ||
    row.source_id.length > 512 ||
    !id(row.session_id) ||
    !id(row.operation_id) ||
    (row.base_revision !== null &&
      (!Number.isSafeInteger(row.base_revision) || row.base_revision < 1))
  )
    throw Error("Invalid original deletion outbox");
  return {
    sourceId: row.source_id,
    sessionId: row.session_id,
    operationId: row.operation_id,
    baseRevision: row.base_revision,
  };
}
function currentDeletion(
  db: Database.Database,
  owner: string,
  profile: string,
  operationId: string,
): NativeHistoryDeletion | undefined {
  if (!exists(db, DELETIONS)) return undefined;
  const row = db
    .prepare(
      `SELECT d.source_id,d.session_id,d.operation_id,d.base_revision FROM ${DELETIONS} d WHERE ${pendingSourceDeleted} AND d.operation_id=?`,
    )
    .get(owner, profile, operationId) as DeletionRow | undefined;
  return row ? deletionRow(row) : undefined;
}
export function nativeHistoryDeletions(
  db: Database.Database,
  owner: string,
  profile: string,
): NativeHistoryDeletion[] {
  if (!exists(db, DELETIONS)) return [];
  return db.transaction(() => {
    const { total } = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${DELETIONS} d WHERE ${pendingSourceDeleted}`,
      )
      .get(owner, profile) as { total: number };
    const result: NativeHistoryDeletion[] = [];
    let after = "";
    const select = db.prepare(
      `SELECT d.source_id,d.session_id,d.operation_id,d.base_revision FROM ${DELETIONS} d WHERE ${pendingSourceDeleted} AND d.operation_id>? ORDER BY d.operation_id COLLATE BINARY LIMIT 100`,
    );
    for (;;) {
      const page = select.all(owner, profile, after) as DeletionRow[];
      for (const row of page) {
        const intent = deletionRow(row);
        if (intent.operationId <= after)
          throw Error("Invalid original deletion inventory order");
        after = intent.operationId;
        result.push(intent);
      }
      if (result.length > total)
        throw Error("Original deletion inventory changed");
      if (page.length < 100) {
        if (result.length !== total)
          throw Error("Incomplete original deletion inventory");
        return result;
      }
    }
  })();
}
export function prepareNativeHistoryDeletion(
  db: Database.Database,
  owner: string,
  profile: string,
  intent: NativeHistoryDeletion,
  revision: number,
): ChatOperation {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw Error("Invalid deletion revision");
  return db.transaction(() => {
    const current = currentDeletion(db, owner, profile, intent.operationId);
    if (
      !current ||
      current.sourceId !== intent.sourceId ||
      current.sessionId !== intent.sessionId
    )
      throw Error("Native deletion changed");
    db.prepare(
      `UPDATE ${DELETIONS} SET base_revision=? WHERE owner=? AND profile=? AND operation_id=? AND base_revision IS NULL AND acknowledged=0`,
    ).run(revision, owner, profile, intent.operationId);
    const baseRevision = current.baseRevision ?? revision;
    const operation: ChatOperation = {
      type: "delete",
      operationId: intent.operationId,
      baseRevision,
      data: {},
    };
    if (!validateChatOperation(operation))
      throw Error("Invalid original deletion operation");
    return operation;
  })();
}
export function acknowledgeNativeHistoryDeletion(
  db: Database.Database,
  owner: string,
  profile: string,
  intent: NativeHistoryDeletion,
  receipt: ChatOperationResponse,
): void {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.userId !== owner ||
    receipt.operationId !== intent.operationId ||
    receipt.status !== "accepted" ||
    !validateChatSession(receipt.session) ||
    receipt.session.id !== intent.sessionId ||
    !receipt.session.deleted
  )
    throw Error("Invalid original deletion receipt");
  db.transaction(() => {
    const current = currentDeletion(db, owner, profile, intent.operationId);
    if (
      !current ||
      current.sourceId !== intent.sourceId ||
      current.sessionId !== intent.sessionId ||
      current.baseRevision === null ||
      receipt.session!.revision !== current.baseRevision + 1
    )
      throw Error("Original deletion receipt changed");
    if (
      db
        .prepare(
          `UPDATE ${DELETIONS} SET acknowledged=1,receipt_json=? WHERE owner=? AND profile=? AND operation_id=? AND acknowledged=0`,
        )
        .run(JSON.stringify(receipt), owner, profile, intent.operationId)
        .changes !== 1
    )
      throw Error("Original deletion receipt changed");
  })();
}
