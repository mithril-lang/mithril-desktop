import Database from "better-sqlite3";
import { expect, it } from "vitest";
import {
  materializeHistoryItem,
  setNativeHistoryCacheOwner,
  clearNativeHistoryCacheOwners,
  mergeNativeHistoryCache,
  replaceNativeHistoryCache,
  replaceRemoteSessionCache,
  readRemoteSessionCache,
} from "./native-history-cache";
import type { HistoryItem } from "./sessions";
import type { ChatSession, ChatEvent } from "@mithril/workspace/sessions";

// @lat: [[cloud-workspace-tests#Cloud history working cache]]
it("restores cloud edits and deletions into the original timeline while preserving agent data", () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE messages(id INTEGER PRIMARY KEY,content TEXT);INSERT INTO messages VALUES(1,'Original');CREATE TABLE executions(id TEXT PRIMARY KEY,status TEXT);INSERT INTO executions VALUES('run','idle')",
  );
  const original: HistoryItem[] = [
    { kind: "user", id: 1, content: "Original", timestamp: 1 },
    { kind: "assistant", id: 2, content: "Older answer", timestamp: 2 },
  ];
  const cloud = [
    {
      id: "user_1",
      kind: "user" as const,
      content: "Cloud edit",
      timestamp: 1,
    },
    {
      id: "assistant_2",
      kind: "assistant" as const,
      content: "Older answer",
      timestamp: 2,
      deleted: true,
    },
  ];
  replaceNativeHistoryCache(
    db,
    "chat",
    "alice",
    original,
    () => original,
    cloud.map((source, index) => ({
      source,
      item: materializeHistoryItem(source, original[index]),
    })),
  );
  setNativeHistoryCacheOwner(db.name, "alice");
  expect(mergeNativeHistoryCache(db, "chat", original)).toEqual([
    { ...original[0], content: "Cloud edit" },
  ]);
  expect(db.prepare("SELECT content FROM messages").get()).toEqual({
    content: "Original",
  });
  expect(db.prepare("SELECT status FROM executions").get()).toEqual({
    status: "idle",
  });
  expect(mergeNativeHistoryCache(db, "other", original)).toEqual(original);
  // A new native edit wins over a stale cached projection until reconciliation.
  const edited = [{ ...original[0], content: "New device edit" }, original[1]];
  expect(mergeNativeHistoryCache(db, "chat", edited)[0].kind).toBe("user");
  expect(mergeNativeHistoryCache(db, "chat", edited)[0]).toEqual(edited[0]);
  setNativeHistoryCacheOwner(db.name, "bob");
  expect(mergeNativeHistoryCache(db, "chat", original)).toEqual(original);
  clearNativeHistoryCacheOwners();
  expect(mergeNativeHistoryCache(db, "chat", original)).toEqual(original);
  db.close();
});
// @lat: [[cloud-workspace-tests#Cloud history working cache]]
it("checks native source under a transaction before changing the working cache", () => {
  const db = new Database(":memory:");
  const original: HistoryItem[] = [
    { kind: "user", id: 1, content: "Original", timestamp: 1 },
  ];
  expect(() =>
    replaceNativeHistoryCache(
      db,
      "chat",
      "alice",
      original,
      () => [{ ...original[0], timestamp: 5 }],
      [],
    ),
  ).toThrow("Native history changed");
  expect(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='mithril_history_cache'")
      .get(),
  ).toBeUndefined();
  db.close();
});

// @lat: [[cloud-workspace-tests#Remote-only chat reconstruction]]
it("retains remote metadata, raw events and original timeline across deletion without changing agent data", () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE sessions(id TEXT);CREATE TABLE messages(id TEXT);CREATE TABLE executions(id TEXT)",
  );
  const session: ChatSession = {
    id: "browser",
    title: "Original title",
    model: "mock",
    revision: 2,
    eventSeq: 1,
    deleted: false,
    activeTurn: null,
  };
  const events: ChatEvent[] = [
    {
      seq: 1,
      type: "user",
      turnId: "turn",
      data: { content: "Full original content" },
      createdAt: 1,
    },
  ];
  const items: HistoryItem[] = [
    { kind: "user", id: -42, content: "Full original content", timestamp: 1 },
  ];
  replaceRemoteSessionCache(db, "alice", session, events, items);
  setNativeHistoryCacheOwner(db.name, "alice");
  expect(readRemoteSessionCache(db, "browser")).toEqual({
    session,
    events,
    items,
  });
  replaceRemoteSessionCache(
    db,
    "alice",
    { ...session, revision: 3, deleted: true },
    [],
    [],
  );
  expect(readRemoteSessionCache(db, "browser")).toEqual({
    session: { ...session, revision: 3, deleted: true },
    events,
    items,
  });
  expect(() =>
    replaceRemoteSessionCache(db, "alice", session, events, items),
  ).toThrow("Stale");
  for (const table of ["sessions", "messages", "executions"])
    expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
      count: 0,
    });
  setNativeHistoryCacheOwner(db.name, "bob");
  expect(readRemoteSessionCache(db, "browser")).toBeNull();
  clearNativeHistoryCacheOwners();
  expect(readRemoteSessionCache(db, "browser")).toBeNull();
  db.close();
});

// @lat: [[cloud-workspace-tests#Chunked remote transcript storage]]
it("stores a transcript beyond the former event and byte bounds in complete owner-bound chunks", () => {
  const db = new Database(":memory:");
  const session: ChatSession = {
    id: "large-browser",
    title: "Full work",
    model: "mock",
    revision: 1,
    eventSeq: 20005,
    deleted: false,
    activeTurn: null,
  };
  const events: ChatEvent[] = Array.from(
    { length: session.eventSeq },
    (_, index) => ({
      seq: index + 1,
      type: "user",
      turnId: null,
      createdAt: index + 1,
      data: { content: index < 600 ? "証".repeat(16000) : `Message ${index}` },
    }),
  );
  const items: HistoryItem[] = events.map((event) => ({
    kind: "user",
    id: event.seq,
    timestamp: event.createdAt,
    content: event.data.content,
  }));
  expect(Buffer.byteLength(JSON.stringify({ events, items }))).toBeGreaterThan(
    50 * 1024 * 1024,
  );
  replaceRemoteSessionCache(db, "alice", session, events, items);
  setNativeHistoryCacheOwner(db.name, "alice");
  expect(readRemoteSessionCache(db, session.id)).toEqual({
    session,
    events,
    items,
  });
  const sizes = db
    .prepare(
      "SELECT MAX(length(CAST(body AS BLOB))) AS largest, COUNT(*) AS count FROM mithril_remote_session_chunks",
    )
    .get() as { largest: number; count: number };
  expect(sizes.largest).toBeLessThanOrEqual(512 * 1024);
  expect(sizes.count).toBeGreaterThan(400);
  setNativeHistoryCacheOwner(db.name, "bob");
  expect(readRemoteSessionCache(db, session.id)).toBeNull();
  clearNativeHistoryCacheOwners();
  db.close();
});

it("migrates the prior cache on write and rolls back a failed chunk replacement without losing history", () => {
  const db = new Database(":memory:");
  const session: ChatSession = {
    id: "legacy-browser",
    title: "Existing work",
    model: "mock",
    revision: 2,
    eventSeq: 1,
    deleted: false,
    activeTurn: null,
  };
  const events: ChatEvent[] = [
    {
      seq: 1,
      type: "user",
      turnId: null,
      createdAt: 1,
      data: { content: "Preserve" },
    },
  ];
  const items: HistoryItem[] = [
    { kind: "user", id: 1, timestamp: 1, content: "Preserve" },
  ];
  db.exec(
    "CREATE TABLE mithril_remote_session_cache(owner TEXT NOT NULL,session_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,session_id))",
  );
  db.prepare("INSERT INTO mithril_remote_session_cache VALUES(?,?,?,?)").run(
    "alice",
    session.id,
    session.revision,
    JSON.stringify({ session, events, items }),
  );
  setNativeHistoryCacheOwner(db.name, "alice");
  expect(readRemoteSessionCache(db, session.id)).toEqual({
    session,
    events,
    items,
  });
  replaceRemoteSessionCache(db, "alice", session, events, items);
  expect(readRemoteSessionCache(db, session.id)).toEqual({
    session,
    events,
    items,
  });
  db.exec(
    "CREATE TRIGGER fail_remote_chunk BEFORE INSERT ON mithril_remote_session_chunks BEGIN SELECT RAISE(ABORT,'disk write failed'); END",
  );
  expect(() =>
    replaceRemoteSessionCache(
      db,
      "alice",
      { ...session, revision: 3, title: "New title" },
      events,
      items,
    ),
  ).toThrow("disk write failed");
  expect(readRemoteSessionCache(db, session.id)).toEqual({
    session,
    events,
    items,
  });
  db.exec("DROP TRIGGER fail_remote_chunk");
  expect(() =>
    replaceRemoteSessionCache(db, "alice", session, events, [
      { ...items[0], timestamp: 2 },
    ]),
  ).toThrow("Inconsistent");
  expect(readRemoteSessionCache(db, session.id)).toEqual({
    session,
    events,
    items,
  });
  const chunk = db
    .prepare(
      "SELECT body FROM mithril_remote_session_chunks WHERE owner='alice' AND kind='items'",
    )
    .get() as { body: string };
  db.prepare(
    "UPDATE mithril_remote_session_chunks SET body=? WHERE owner='alice' AND kind='items'",
  ).run(JSON.stringify([{ ...items[0], timestamp: 9 }]));
  expect(() => readRemoteSessionCache(db, session.id)).toThrow("Incomplete");
  db.prepare(
    "UPDATE mithril_remote_session_chunks SET body=? WHERE owner='alice' AND kind='items'",
  ).run(chunk.body);
  replaceRemoteSessionCache(db, "bob", session, events, [
    { ...items[0], timestamp: 8 },
  ]);
  setNativeHistoryCacheOwner(db.name, "bob");
  expect(readRemoteSessionCache(db, session.id)?.items[0].timestamp).toBe(8);
  setNativeHistoryCacheOwner(db.name, "alice");
  expect(readRemoteSessionCache(db, session.id)?.items[0].timestamp).toBe(1);
  db.prepare(
    "DELETE FROM mithril_remote_session_chunks WHERE kind='items'",
  ).run();
  expect(() => readRemoteSessionCache(db, session.id)).toThrow("Incomplete");
  clearNativeHistoryCacheOwners();
  db.close();
});
