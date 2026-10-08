import { expect, it } from "vitest";
import { SyncClient } from "@mithril/workspace/sync";
import type {
  WorkspaceRecord,
  WorkspaceSnapshot,
  WorkspaceHistory,
} from "@mithril/workspace/protocol";
import {
  RepositorySync,
  emptyRepository,
} from "@mithril/workspace/repository-sync";
import type {
  RepositoryDocument,
  RepositoryTransport,
} from "@mithril/workspace/repository";
import {
  ReplicaSync,
  emptyReplica,
  type ReplicaRecord,
} from "@mithril/workspace/replica-sync";

// @lat: [[cloud-workspace-tests#Packaged canonical snapshot replacement]]
it("uses the vendored complete snapshot cache without retaining absent or restored newer revisions", async () => {
  const record = (id: string, revision: number): WorkspaceRecord => ({
    id,
    kind: "project",
    revision,
    data: { title: id },
    deleted: false,
    updatedAt: revision,
  });
  let snapshot: WorkspaceSnapshot = {
    schemaVersion: 1,
    userId: "alice",
    cursor: 10,
    records: Array.from({ length: 1205 }, (_, i) => record(`project-${i}`, 9)),
  };
  const client = new SyncClient({
    getSnapshot: async () => structuredClone(snapshot),
    applyOperations: async () => {
      throw Error("Read must not write");
    },
    history: async () => {
      throw Error("Unexpected history read");
    },
  });
  await client.connect("alice");
  expect(client.records).toHaveLength(1205);
  const pending = client.queue("project", "project-0", {
    title: "Unsent edit",
  });
  snapshot = {
    schemaVersion: 1,
    userId: "alice",
    cursor: 1,
    records: [record("project-0", 1)],
  };
  await client.refresh();
  expect(client.records).toEqual([record("project-0", 1)]);
  expect(client.outbox).toEqual([pending]);
});

// @lat: [[cloud-workspace-tests#Packaged all-page Repository publication]]
it("keeps the actual vendored repository cache unchanged after a later collection read fails", async () => {
  const original: RepositoryDocument = {
    collection: "memory",
    id: "original",
    revision: 1,
    body: { text: "Original" },
    deleted: false,
    updatedAt: 1,
  };
  let state = { ...emptyRepository(), documents: [original] };
  const transport: RepositoryTransport = {
    page: async (collection) => {
      if (collection === "preferences") throw Error("Later read failed");
      return {
        schemaVersion: 1,
        userId: "alice",
        documents: [{ ...original, id: "new", revision: 2 }],
        nextAfter: null,
      };
    },
    apply: async () => {
      throw Error("Incomplete read must not write");
    },
  };
  const sync = new RepositorySync(
    "alice",
    transport,
    {
      read: async () => structuredClone(state),
      update: async (_owner, change) => {
        state = change(structuredClone(state));
        return structuredClone(state);
      },
    },
    () => {},
    ["memory", "preferences"],
  );
  await expect(sync.sync()).rejects.toThrow("Later read failed");
  expect(state.documents).toEqual([original]);
  expect(sync.state.documents).toEqual([original]);
});

// @lat: [[cloud-workspace-tests#Packaged counted Repository replacement]]
it("replaces complete counted collections and rejects a changed later page without publishing mixed data", async () => {
  const record = (id: string, revision: number): RepositoryDocument => ({
    collection: "memory",
    id,
    revision,
    body: { text: id },
    deleted: false,
    updatedAt: revision,
  });
  let state = {
    ...emptyRepository(),
    documents: [record("original", 9), record("removed", 9)],
  };
  let changed = true;
  const transport: RepositoryTransport = {
    page: async (_collection, after) => ({
      schemaVersion: 1,
      userId: "alice",
      inventory: { cursor: after && changed ? 2 : 1, anchor: 2, total: 2 },
      documents: [after ? record("second", 1) : record("original", 1)],
      nextAfter: after ? null : "original",
    }),
    apply: async () => {
      throw Error("Read must not write");
    },
  };
  const sync = new RepositorySync(
    "alice",
    transport,
    {
      read: async () => structuredClone(state),
      update: async (_owner, change) => {
        state = change(structuredClone(state));
        return structuredClone(state);
      },
    },
    () => {},
    ["memory"],
  );
  await expect(sync.sync()).rejects.toThrow("Repository inventory changed");
  expect(state.documents).toEqual([
    record("original", 9),
    record("removed", 9),
  ]);
  changed = false;
  await sync.sync();
  expect(state.documents).toEqual([record("original", 1), record("second", 1)]);
});

// @lat: [[cloud-workspace-tests#Packaged Repository restore generation]]
it("retains saved Repository and Workspace writes without dispatch across a restoration", async () => {
  const original: RepositoryDocument = {
    collection: "memory",
    id: "note",
    revision: 1,
    deleted: false,
    updatedAt: 1,
    body: { text: "Original" },
  };
  let datasetGeneration = 0,
    document = original,
    state = emptyRepository(),
    writes = 0;
  const repository = new RepositorySync(
    "alice",
    {
      page: async () => ({
        schemaVersion: 1,
        userId: "alice",
        datasetGeneration,
        documents: [document],
        nextAfter: null,
        inventory: { cursor: 1, anchor: 1, total: 1 },
      }),
      apply: async () => {
        writes++;
        throw Error("Must not send across restoration");
      },
    },
    {
      read: async () => structuredClone(state),
      update: async (_owner, change) => {
        state = change(structuredClone(state));
        return structuredClone(state);
      },
    },
    () => {},
    ["memory"],
  );
  await repository.sync();
  await repository.edit("memory", "note", { text: "Saved" });
  const pending = structuredClone(repository.state.pending[0]);
  expect(pending.datasetGeneration).toBe(0);
  datasetGeneration = 1;
  document = { ...original, body: { text: "Restored at the same revision" } };
  await repository.sync();
  expect(state.datasetGeneration).toBe(1);
  expect(state.documents).toEqual([document]);
  expect(state.pending).toEqual([pending]);
  expect(state.conflicts).toEqual([
    { operationId: pending.operationId, remote: document },
  ]);
  expect(writes).toBe(0);

  const record: WorkspaceRecord = {
    id: "project",
    kind: "project",
    revision: 1,
    deleted: false,
    updatedAt: 1,
    data: { title: "Original" },
  };
  let snapshot: WorkspaceSnapshot = {
    schemaVersion: 1,
    userId: "alice",
    datasetGeneration: 0,
    cursor: 1,
    records: [record],
  };
  const workspace = new SyncClient({
    getSnapshot: async () => structuredClone(snapshot),
    applyOperations: async () => {
      writes++;
      throw Error("Must not send across restoration");
    },
    history: async () => {
      throw Error("Unexpected history read");
    },
  });
  await workspace.connect("alice");
  const edit = workspace.queue("project", "project", {
    title: "Saved project",
  });
  snapshot = {
    ...snapshot,
    datasetGeneration: 1,
    records: [{ ...record, data: { title: "Restored project" } }],
  };
  await expect(workspace.flush()).rejects.toThrow("review saved operation");
  expect(workspace.records).toEqual(snapshot.records);
  expect(workspace.outbox).toEqual([edit]);
  expect(writes).toBe(0);
});

// @lat: [[cloud-workspace-tests#Packaged Sidebar restore generation]]
it("uses the compiled Sidebar dataset protocol without admitting malformed or unscoped edits", async () => {
  const { validSidebarOperation, validSidebarSnapshot } =
    await import("@mithril/workspace/sidebar");
  const operation = {
    operationId: "retained",
    chatId: "conversation",
    baseRevision: 0,
    pinned: true,
    projectId: null,
    datasetGeneration: 1,
  };
  expect(validSidebarOperation(operation)).toBe(true);
  expect(validSidebarOperation({ ...operation, datasetGeneration: -1 })).toBe(
    false,
  );
  expect(validSidebarOperation({ ...operation, userId: "other" })).toBe(false);
  expect(
    validSidebarSnapshot(
      {
        schemaVersion: 1,
        userId: "alice",
        datasetGeneration: 1,
        placements: [],
      },
      "alice",
    ),
  ).toBe(true);
  expect(
    validSidebarSnapshot(
      {
        schemaVersion: 1,
        userId: "alice",
        datasetGeneration: 1,
        placements: [],
      },
      "bob",
    ),
  ).toBe(false);
});

// @lat: [[cloud-workspace-tests#Packaged Workspace history generation]]
it("rejects a restored retained-history page in the compiled shared client", async () => {
  let epoch = 0;
  const row: WorkspaceRecord = {
    id: "project",
    kind: "project",
    revision: 1,
    data: { title: "Restored" },
    deleted: false,
    updatedAt: 1,
  };
  const history = (): WorkspaceHistory => ({
    schemaVersion: 1 as const,
    userId: "alice",
    datasetGeneration: epoch,
    boundaryRevision: 1,
    total: 1,
    records: [row],
    hasMore: false,
    nextOffset: null,
  });
  const client = new SyncClient({
    getSnapshot: async () => ({
      schemaVersion: 1,
      userId: "alice",
      datasetGeneration: epoch,
      cursor: 0,
      records: [row],
    }),
    history: async () => history(),
    applyOperations: async () => {
      throw Error("No history writes");
    },
  });
  await client.connect("alice");
  const previous = await client.history("project");
  epoch = 1;
  await expect(client.history("project", 0, previous)).rejects.toThrow(
    "dataset changed",
  );
  await client.refresh();
  await expect(client.history("project", 0, previous)).rejects.toThrow(
    "changed workspace history",
  );
  expect((await client.history("project")).datasetGeneration).toBe(1);
});

// @lat: [[cloud-workspace-tests#Packaged device replica restoration generation]]
it("keeps unsynchronized native data from overwriting a restored cloud dataset across reopen", async () => {
  let generation = 0,
    writes = 0;
  let document: RepositoryDocument = {
    collection: "memory",
    id: "note",
    body: { text: "Original" },
    deleted: false,
    revision: 1,
    updatedAt: 1,
  };
  let local: ReplicaRecord = {
    collection: "memory",
    id: "note",
    body: document.body,
    deleted: false,
    version: "v1",
  };
  let repositoryState = emptyRepository(),
    replicaState = emptyReplica();
  const reopen = async (): Promise<ReplicaSync> => {
    const cloud = new RepositorySync(
      "alice",
      {
        page: async () => ({
          schemaVersion: 1,
          userId: "alice",
          datasetGeneration: generation,
          inventory: { cursor: 1, anchor: 1, total: 1 },
          documents: [document],
          nextAfter: null,
        }),
        apply: async () => {
          writes++;
          throw Error("Old native data must not upload");
        },
      },
      {
        read: async () => structuredClone(repositoryState),
        update: async (_owner, change) => {
          repositoryState = change(structuredClone(repositoryState));
          return structuredClone(repositoryState);
        },
      },
      () => {},
      ["memory"],
    );
    await cloud.load();
    return new ReplicaSync(
      "alice",
      cloud,
      {
        snapshot: async () => ({
          schemaVersion: 1,
          userId: "alice",
          replicaId: "device",
          complete: true,
          collections: ["memory"],
          documents: [local],
        }),
        apply: async () => {
          throw Error("Unacknowledged device edits must not be replaced");
        },
      },
      {
        read: async () => structuredClone(replicaState),
        write: async (_owner, _replica, next) => {
          replicaState = structuredClone(next);
        },
      },
    );
  };
  let replica = await reopen();
  await replica.run();
  local = { ...local, body: { text: "Saved device edit" }, version: "v2" };
  generation = 1;
  document = { ...document, body: { text: "Restored cloud bytes" } };
  await replica.run();
  expect(replicaState.datasetGeneration).toBe(1);
  expect(replicaState.conflicts).toHaveLength(1);
  replica = await reopen();
  await replica.run();
  expect(replica.state.conflicts[0].local?.body).toEqual(local.body);
  expect(replica.state.conflicts[0].cloud?.body).toEqual(document.body);
  expect(writes).toBe(0);
});
