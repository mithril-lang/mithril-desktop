import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import {
  bindNativeHistorySources,
  nativeHistoryDeletions,
  prepareNativeHistoryDeletion,
  acknowledgeNativeHistoryDeletion,
  recordNativeHistoryDeletion,
} from "./native-history-deletions";
import { nativeCloudSessionId } from "./native-history-sync";
import type { ChatOperationResponse } from "@mithril/workspace/sessions";
const binding = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./db", () => ({ getDbConnection: () => binding.db }));
vi.mock("./session-cache", () => ({ removeSessionFromCache: vi.fn() }));
vi.mock("./attachment-staging", () => ({ clearStagedAttachments: vi.fn() }));
import { deleteSession, deleteSessions } from "./sessions";
const databases: Database.Database[] = [];
function fixture(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  binding.db = db;
  db.exec(
    "CREATE TABLE sessions(id TEXT PRIMARY KEY,parent_session_id TEXT REFERENCES sessions(id),title TEXT);CREATE TABLE messages(session_id TEXT,content TEXT);INSERT INTO sessions VALUES('one',NULL,'Original'),('child','one','Retained'),('other',NULL,'Other');INSERT INTO messages VALUES('one','Original text'),('child','Child text'),('other','Other text');",
  );
  bindNativeHistorySources(db, "alice", "default", [
    { sourceId: "one", sessionId: nativeCloudSessionId("default", "one") },
    { sourceId: "child", sessionId: nativeCloudSessionId("default", "child") },
  ]);
  return db;
}
afterEach(() => {
  binding.db = null;
  for (const db of databases.splice(0)) db.close();
});
// @lat: [[cloud-workspace-tests#Atomic original session deletion intent]]
it("records deletion with the real original single/batch transaction while preserving unselected children", () => {
  const db = fixture();
  expect(() => recordNativeHistoryDeletion(db, "one")).toThrow("transaction");
  deleteSession("one", "default");
  const intents = nativeHistoryDeletions(db, "alice", "default");
  expect(intents).toHaveLength(1);
  expect(intents[0]).toMatchObject({
    sourceId: "one",
    sessionId: nativeCloudSessionId("default", "one"),
    baseRevision: null,
  });
  expect(db.prepare("SELECT * FROM sessions WHERE id='child'").get()).toEqual({
    id: "child",
    parent_session_id: null,
    title: "Retained",
  });
  expect(
    db.prepare("SELECT content FROM messages WHERE session_id='child'").get(),
  ).toEqual({ content: "Child text" });
  expect(nativeHistoryDeletions(db, "bob", "default")).toEqual([]);
  expect(nativeHistoryDeletions(db, "alice", "other-profile")).toEqual([]);
  deleteSession("one", "default");
  expect(nativeHistoryDeletions(db, "alice", "default")[0].operationId).toBe(
    intents[0].operationId,
  );
  expect(deleteSessions(["child", "other"], "default")).toEqual({
    requested: 2,
    deleted: 2,
  });
  expect(nativeHistoryDeletions(db, "alice", "default")).toHaveLength(2); // Unmapped native-only data remains native-only.
});
// @lat: [[cloud-workspace-tests#Deletion rollback preserves original source]]
it("rolls back deletion intent with failed original deletes and refuses owner rebinding", () => {
  const db = fixture();
  db.exec(
    "CREATE TRIGGER refuse_delete BEFORE DELETE ON sessions WHEN OLD.id='one' BEGIN SELECT RAISE(ABORT,'retained');END;",
  );
  expect(() => deleteSession("one", "default")).toThrow("retained");
  expect(nativeHistoryDeletions(db, "alice", "default")).toEqual([]);
  expect(
    db.prepare("SELECT content FROM messages WHERE session_id='one'").get(),
  ).toEqual({ content: "Original text" });
  expect(
    db.prepare("SELECT parent_session_id FROM sessions WHERE id='child'").get(),
  ).toEqual({ parent_session_id: "one" });
  expect(() =>
    bindNativeHistorySources(db, "bob", "default", [
      { sourceId: "one", sessionId: nativeCloudSessionId("default", "one") },
    ]),
  ).toThrow("another owner");
});
// @lat: [[cloud-workspace-tests#Durable original deletion acknowledgement]]
it("retains the first operation/revision and acknowledges only exact owner-scoped deletion receipts", () => {
  const db = fixture();
  deleteSession("one", "default");
  const intent = nativeHistoryDeletions(db, "alice", "default")[0];
  const operation = prepareNativeHistoryDeletion(
    db,
    "alice",
    "default",
    intent,
    4,
  );
  expect(
    prepareNativeHistoryDeletion(db, "alice", "default", intent, 9),
  ).toEqual(operation);
  const receipt: ChatOperationResponse = {
    schemaVersion: 1,
    userId: "alice",
    operationId: intent.operationId,
    status: "accepted",
    session: {
      id: intent.sessionId,
      title: "Original",
      model: "mock",
      revision: 5,
      eventSeq: 1,
      deleted: true,
      activeTurn: null,
    },
  };
  expect(() =>
    acknowledgeNativeHistoryDeletion(db, "bob", "default", intent, receipt),
  ).toThrow("receipt");
  expect(() =>
    acknowledgeNativeHistoryDeletion(db, "alice", "default", intent, {
      ...receipt,
      session: { ...receipt.session!, revision: 6 },
    }),
  ).toThrow("changed");
  expect(nativeHistoryDeletions(db, "alice", "default")).toHaveLength(1);
  acknowledgeNativeHistoryDeletion(db, "alice", "default", intent, receipt);
  expect(nativeHistoryDeletions(db, "alice", "default")).toEqual([]);
  expect(
    db
      .prepare("SELECT receipt_json FROM mithril_history_source_deletions")
      .get(),
  ).toEqual({ receipt_json: JSON.stringify(receipt) });
});
