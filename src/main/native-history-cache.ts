import { createHash } from "crypto";
import type Database from "better-sqlite3";
import type { HistoryItem } from "./sessions";
import type { ArchivedHistoryItem } from "@mithril/workspace/history";
import type { Attachment } from "../shared/attachments";

const TABLE = "mithril_history_cache";
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
