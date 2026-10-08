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

const REMOTE_CHUNKS = "mithril_remote_session_chunks";
function digestRows(rows: unknown[]): string {
  const hash = createHash("sha256");
  hash.update("[");
  rows.forEach((row, index) => {
    if (index) hash.update(",");
    hash.update(JSON.stringify(row));
  });
  return hash.update("]").digest("hex");
}
function readRemoteBody(
  db: Database.Database,
  owner: string,
  sessionId: string,
  body: string,
): { session: ChatSession; events: ChatEvent[]; items: HistoryItem[] } {
  const value = JSON.parse(body);
  if (value.format !== undefined && value.format !== 2)
    throw Error("Unknown remote history cache format");
  if (value.format === 2) {
    const rows = db
      .prepare(
        `SELECT kind,ordinal,body FROM ${REMOTE_CHUNKS} WHERE owner=? AND session_id=? ORDER BY kind,ordinal`,
      )
      .iterate(owner, sessionId) as Iterable<{
      kind: string;
      ordinal: number;
      body: string;
    }>;
    const events: ChatEvent[] = [],
      items: HistoryItem[] = [];
    const next = { events: 0, items: 0 };
    for (const row of rows) {
      if (
        !(row.kind === "events" || row.kind === "items") ||
        row.ordinal !== next[row.kind]++
      )
        throw Error("Invalid remote history chunk order");
      const chunk = JSON.parse(row.body);
      if (!Array.isArray(chunk) || !chunk.length)
        throw Error("Invalid remote history chunk");
      for (const item of chunk)
        (row.kind === "events" ? events : items).push(item);
    }
    if (
      events.length !== value.eventCount ||
      items.length !== value.itemCount ||
      digestRows(events) !== value.eventDigest ||
      digestRows(items) !== value.itemDigest
    )
      throw Error("Incomplete remote history chunks");
    value.events = events;
    value.items = items;
  }
  if (
    !validateChatSession(value.session) ||
    value.session.id !== sessionId ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.items) ||
    value.events.some(
      (event: ChatEvent, index: number) =>
        !validateChatEvent(event) || event.seq !== index + 1,
    ) ||
    (!value.session.deleted && value.events.length !== value.session.eventSeq)
  )
    throw Error("Invalid retained remote history");
  return { session: value.session, events: value.events, items: value.items };
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
    events.some(
      (event, index) => !validateChatEvent(event) || event.seq !== index + 1,
    ) ||
    (!session.deleted && events.length !== session.eventSeq)
  )
    throw Error("Invalid remote session cache");
  db.transaction(() => {
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${REMOTE_TABLE}(owner TEXT NOT NULL,session_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,session_id));CREATE TABLE IF NOT EXISTS ${REMOTE_CHUNKS}(owner TEXT NOT NULL,session_id TEXT NOT NULL,kind TEXT NOT NULL,ordinal INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,session_id,kind,ordinal))`,
    );
    const previous = db
      .prepare(
        `SELECT revision,body FROM ${REMOTE_TABLE} WHERE owner=? AND session_id=?`,
      )
      .get(owner, session.id) as { revision: number; body: string } | undefined;
    if (previous && previous.revision > session.revision)
      throw Error("Stale remote history reconstruction");
    const retained =
      session.deleted && previous
        ? readRemoteBody(db, owner, session.id, previous.body)
        : { events, items };
    const body = JSON.stringify({
      format: 2,
      session,
      eventCount: retained.events.length,
      itemCount: retained.items.length,
      eventDigest: digestRows(retained.events),
      itemDigest: digestRows(retained.items),
    });
    if (previous?.revision === session.revision) {
      const old = readRemoteBody(db, owner, session.id, previous.body);
      if (
        JSON.stringify(old.session) !== JSON.stringify(session) ||
        digestRows(old.events) !== digestRows(retained.events) ||
        digestRows(old.items) !== digestRows(retained.items)
      )
        throw Error("Inconsistent remote history revision");
    }
    db.prepare(
      `DELETE FROM ${REMOTE_CHUNKS} WHERE owner=? AND session_id=?`,
    ).run(owner, session.id);
    const insert = db.prepare(
      `INSERT INTO ${REMOTE_CHUNKS}(owner,session_id,kind,ordinal,body) VALUES(?,?,?,?,?)`,
    );
    for (const [kind, values] of [
      ["events", retained.events],
      ["items", retained.items],
    ] as const) {
      let ordinal = 0,
        bytes = 2;
      let chunk: string[] = [];
      const flush = (): void => {
        if (chunk.length)
          insert.run(
            owner,
            session.id,
            kind,
            ordinal++,
            "[" + chunk.join(",") + "]",
          );
        chunk = [];
        bytes = 2;
      };
      for (const value of values) {
        const serialized = JSON.stringify(value),
          size = Buffer.byteLength(serialized) + 1;
        if (chunk.length && (bytes + size > 512 * 1024 || chunk.length >= 100))
          flush();
        chunk.push(serialized);
        bytes += size;
      }
      flush();
    }
    db.prepare(
      `INSERT INTO ${REMOTE_TABLE}(owner,session_id,revision,body) VALUES(?,?,?,?) ON CONFLICT(owner,session_id) DO UPDATE SET revision=excluded.revision,body=excluded.body`,
    ).run(owner, session.id, session.revision, body);
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
  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT body FROM ${REMOTE_TABLE} WHERE owner=? AND session_id=?`,
      )
      .get(owner, sessionId) as { body: string } | undefined;
    return row ? readRemoteBody(db, owner, sessionId, row.body) : null;
  })();
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
