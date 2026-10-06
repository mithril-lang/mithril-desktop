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
