import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { browserPendingStore } from "../node_modules/@mithril/workspace/dist/outbox.js";
import type { WorkspaceOperation } from "@mithril/workspace";

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("mithril-workspace-pending");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
);

// @lat: [[cloud-workspace-tests#Packaged acknowledged journal cleanup]]
it("drains the packaged complete journal without deleting unacknowledged or other-owner edits", async () => {
  const operations: WorkspaceOperation[] = Array.from(
    { length: 1205 },
    (_, i) => ({
      operationId: `saved-${String(i).padStart(4, "0")}`,
      id: `project-${i}`,
      kind: "project",
      baseRevision: 0,
      data: { title: `Original ${i}` },
      deleted: false,
    }),
  );
  const store = browserPendingStore()!;
  await store.put("alice", operations);
  await store.put("bob", [operations[0]]);
  expect(await browserPendingStore()!.load("alice")).toEqual(operations);
  const retained = operations[100];
  await store.remove(
    "alice",
    operations.filter((op) => op !== retained).map((op) => op.operationId),
  );
  expect(await store.load("alice")).toEqual([retained]);
  expect(await store.load("bob")).toEqual([operations[0]]);
  await store.remove("alice", [retained.operationId]);
  expect(await store.load("alice")).toEqual([]);
});
