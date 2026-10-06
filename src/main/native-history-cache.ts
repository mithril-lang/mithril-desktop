import { createHash } from "crypto";
import type Database from "better-sqlite3";
import type { HistoryItem } from "./sessions";
import type { ArchivedHistoryItem } from "@mithril/workspace/history";
import type { Attachment } from "../shared/attachments";
import {
  validateChatSession,
  validateChatEvent,
  type ChatSession,
  type ChatEvent,
} from "@mithril/workspace/sessions";

const TABLE = "mithril_history_cache";
const REMOTE_TABLE = "mithril_remote_session_cache";
const owners = new Map<string, string>();
export function setNativeHistoryCacheOwner(path: string, owner: string): void {
  owners.set(path, owner);
}
export function clearNativeHistoryCacheOwners(): void {
  owners.clear();
}
export function nativeHistoryItemId(item: HistoryItem): string {
  return (
    item.kind +
    "_" +
    item.id +
    (item.kind === "tool_call"
      ? "_" +
        createHash("sha256").update(item.callId).digest("hex").slice(0, 16)
      : "")
  );
}
export function nativeHistoryVersion(items: HistoryItem[]): string {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}
interface CachedItem {
  sourceId: string;
  base: string | null;
  item: HistoryItem | null;
}
function syntheticId(id: string): number {
  return (
    -2_000_000_000_000 -
    parseInt(createHash("sha256").update(id).digest("hex").slice(0, 10), 16)
  );
}
export function materializeHistoryItem(
  value: ArchivedHistoryItem,
  base?: HistoryItem,
  attachments?: Attachment[],
): HistoryItem | null {
  if (value.deleted) return null;
  const id = base?.id ?? syntheticId(value.id),
    timestamp = value.timestamp;
  switch (value.kind) {
    case "user":
    case "assistant":
      return {
        kind: value.kind,
        id,
        timestamp,
        content: value.content ?? "",
        ...(attachments?.length ? { attachments } : {}),
        ...(value.kind === "assistant" && value.error
          ? { error: value.error }
          : {}),
      };
    case "reasoning":
      return {
        kind: value.kind,
        id,
        timestamp,
        assistantId:
          base?.kind === "reasoning"
            ? base.assistantId
            : syntheticId(value.assistantId!),
        text: value.text ?? "",
      };
    case "tool_call":
      return {
        kind: value.kind,
        id,
        timestamp,
        assistantId:
          base?.kind === "tool_call"
            ? base.assistantId
            : syntheticId(value.assistantId!),
        callId: value.callId!,
        name: value.name!,
        args: value.args!,
      };
    case "tool_result":
      return {
        kind: value.kind,
        id,
        timestamp,
        callId: value.callId!,
        name: value.name!,
        content: value.content!,
        ...(attachments?.length ? { attachments } : {}),
      };
  }
}
/** Cache writes change renderer data only, never the agent's messages or execution tables. */
export function replaceNativeHistoryCache(
  db: Database.Database,
  sessionId: string,
  owner: string,
  expected: HistoryItem[],
  readSource: () => HistoryItem[],
  rows: { source: ArchivedHistoryItem; item: HistoryItem | null }[],
): void {
  db.transaction(() => {
    if (nativeHistoryVersion(readSource()) !== nativeHistoryVersion(expected))
      throw Error("Native history changed while restoring cloud data");
    const source = new Map(
      expected.map((item) => [nativeHistoryItemId(item), item]),
    );
    const cached: CachedItem[] = rows.map((row) => ({
      sourceId: row.source.id,
      base: source.has(row.source.id)
        ? nativeHistoryVersion([source.get(row.source.id)!])
        : null,
      item: row.item,
    }));
    if (new Set(cached.map((row) => row.sourceId)).size !== cached.length)
      throw Error("Duplicate cloud history cache identity");
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${TABLE}(session_id TEXT PRIMARY KEY,owner TEXT NOT NULL,items TEXT NOT NULL)`,
    );
    db.prepare(
      `INSERT INTO ${TABLE}(session_id,owner,items) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET owner=excluded.owner,items=excluded.items`,
    ).run(sessionId, owner, JSON.stringify(cached));
  }).immediate();
}
export function mergeNativeHistoryCache(
  db: Database.Database,
  sessionId: string,
  source: HistoryItem[],
): HistoryItem[] {
  const owner = owners.get(db.name);
  if (!owner) return source;
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(TABLE)
  )
    return source;
  const row = db
    .prepare(`SELECT items FROM ${TABLE} WHERE session_id=? AND owner=?`)
    .get(sessionId, owner) as { items: string } | undefined;
  if (!row) return source;
  const cached = JSON.parse(row.items) as CachedItem[];
  if (!Array.isArray(cached)) throw Error("Invalid cloud history cache");
  const values = new Map(cached.map((item) => [item.sourceId, item]));
  const result: HistoryItem[] = [];
  for (const original of source) {
    const id = nativeHistoryItemId(original),
      overlay = values.get(id);
    values.delete(id);
    if (overlay && overlay.base === nativeHistoryVersion([original])) {
      if (overlay.item) result.push(overlay.item);
    } else result.push(original);
  }
  for (const overlay of values.values())
    if (overlay.base === null && overlay.item) result.push(overlay.item);
  return result;
}

export function deleteNativeHistoryCache(
  db: Database.Database,
  sessionId: string,
): void {
  if (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(TABLE)
  )
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id=?`).run(sessionId);
}

/** Remote-only sessions are materialized caches, never agent sessions/executions. */
export function replaceRemoteSessionCache(
  db: Database.Database,
  owner: string,
  session: ChatSession,
  events: ChatEvent[],
  items: HistoryItem[],
): void {
  if (
    !owner ||
    owner.length > 128 ||
    !validateChatSession(session) ||
    events.length > 20000 ||
    events.some(
      (event, index) => !validateChatEvent(event) || event.seq !== index + 1,
    ) ||
    (!session.deleted && events.length !== session.eventSeq)
  )
    throw Error("Invalid remote session cache");
  db.transaction(() => {
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${REMOTE_TABLE}(owner TEXT NOT NULL,session_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,session_id))`,
    );
    const previous = db
      .prepare(
        `SELECT revision,body FROM ${REMOTE_TABLE} WHERE owner=? AND session_id=?`,
      )
      .get(owner, session.id) as { revision: number; body: string } | undefined;
    const retained =
      session.deleted && previous
        ? (JSON.parse(previous.body) as {
            events: ChatEvent[];
            items: HistoryItem[];
          })
        : { events, items };
    const serialized = JSON.stringify({
      session,
      events: retained.events,
      items: retained.items,
    });
    if (Buffer.byteLength(serialized) > 50 * 1024 * 1024)
      throw Error("Remote history exceeds supported cache bound");
    if (previous && previous.revision > session.revision)
      throw Error("Stale remote history reconstruction");
    if (previous?.revision === session.revision && previous.body !== serialized)
      throw Error("Inconsistent remote history revision");
    db.prepare(
      `INSERT INTO ${REMOTE_TABLE}(owner,session_id,revision,body) VALUES(?,?,?,?) ON CONFLICT(owner,session_id) DO UPDATE SET revision=excluded.revision,body=excluded.body`,
    ).run(owner, session.id, session.revision, serialized);
  }).immediate();
}

export function readRemoteSessionCache(
  db: Database.Database,
  sessionId: string,
): { session: ChatSession; events: ChatEvent[]; items: HistoryItem[] } | null {
  const owner = owners.get(db.name);
  if (
    !owner ||
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(REMOTE_TABLE)
  )
    return null;
  const row = db
    .prepare(`SELECT body FROM ${REMOTE_TABLE} WHERE owner=? AND session_id=?`)
    .get(owner, sessionId) as { body: string } | undefined;
  if (!row) return null;
  const value = JSON.parse(row.body) as {
    session: ChatSession;
    events: ChatEvent[];
    items: HistoryItem[];
  };
  if (
    !validateChatSession(value.session) ||
    value.session.id !== sessionId ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.items)
  )
    throw Error("Invalid retained remote history");
  return value;
}

export function remoteSessionCacheRevision(
  db: Database.Database,
  sessionId: string,
): number | null {
  const owner = owners.get(db.name);
  if (
    !owner ||
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(REMOTE_TABLE)
  )
    return null;
  const row = db
    .prepare(
      `SELECT revision FROM ${REMOTE_TABLE} WHERE owner=? AND session_id=?`,
    )
    .get(owner, sessionId) as { revision: number } | undefined;
  return row?.revision ?? null;
}
