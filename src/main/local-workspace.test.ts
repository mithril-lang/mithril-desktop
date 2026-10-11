// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalWorkspace, type LocalWorkspaceRemote } from "./local-workspace";
import type {
  WorkspaceOperation,
  WorkspaceRecord,
} from "@mithril/workspace/protocol";
import type {
  RepositoryEdit,
  RepositoryDocument,
} from "@mithril/workspace/repository";
const roots: string[] = [],
  services: LocalWorkspace[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
interface CloudFixture {
  remote: LocalWorkspaceRemote;
  records: Map<string, WorkspaceRecord>;
  documents: Map<string, RepositoryDocument>;
  receipts: Map<string, unknown>;
  sent: string[];
  offline(): void;
  online(): void;
  refuse(): void;
  restore(): void;
  loseReply(): void;
}
function cloud(): CloudFixture {
  let online = true,
    generation = 0,
    refused = false,
    lost = false;
  const records = new Map<string, WorkspaceRecord>(),
    documents = new Map<string, RepositoryDocument>();
  const receipts = new Map<string, unknown>();
  const sent: string[] = [];
  const available = (): void => {
    if (refused) throw Error("Workspace sign-in expired or access refused");
    if (!online) throw Error("Workspace network unavailable");
  };
  const remote: LocalWorkspaceRemote = {
    enable: vi.fn(async () => {
      available();
      return { userId: "alice", enabled: true };
    }),
    getSnapshot: vi.fn(async () => {
      available();
      return {
        schemaVersion: 1 as const,
        userId: "alice",
        cursor: receipts.size,
        datasetGeneration: generation,
        records: [...records.values()],
      };
    }),
    applyOperations: vi.fn(async (ops) => {
      available();
      const results = ops.map((op) => {
        sent.push(op.operationId);
        if (receipts.has(op.operationId))
          return receipts.get(op.operationId) as never;
        const old = records.get(op.id);
        const accepted = (old?.revision ?? 0) === op.baseRevision;
        const record = accepted
          ? {
              id: op.id,
              kind: op.kind,
              data: op.data,
              deleted: op.deleted,
              revision: op.baseRevision + 1,
              updatedAt: 1,
            }
          : (old ?? null);
        if (accepted) records.set(op.id, record!);
        const receipt = {
          operationId: op.operationId,
          datasetGeneration: generation,
          status: accepted ? ("accepted" as const) : ("conflict" as const),
          record,
        };
        receipts.set(op.operationId, receipt);
        return receipt;
      });
      if (lost) {
        lost = false;
        throw Error("Workspace network unavailable");
      }
      return { schemaVersion: 1 as const, userId: "alice", results };
    }),
    repositoryPage: vi.fn(async (collection) => {
      available();
      const rows = [...documents.values()].filter(
        (d) => d.collection === collection,
      );
      return {
        schemaVersion: 1 as const,
        userId: "alice",
        datasetGeneration: generation,
        documents: rows,
        inventory: {
          cursor: receipts.size,
          anchor: receipts.size,
          total: rows.length,
        },
        nextAfter: null,
      };
    }),
    repositoryApply: vi.fn(async (edit) => {
      available();
      if (receipts.has(edit.operationId))
        return receipts.get(edit.operationId) as never;
      const key = edit.collection + ":" + edit.id,
        old = documents.get(key);
      const accepted = (old?.revision ?? 0) === edit.baseRevision;
      const document = accepted
        ? {
            collection: edit.collection,
            id: edit.id,
            body: edit.body,
            deleted: edit.deleted,
            revision: edit.baseRevision + 1,
            updatedAt: 1,
          }
        : (old ?? null);
      if (accepted) documents.set(key, document!);
      const receipt = {
        schemaVersion: 1 as const,
        userId: "alice",
        operationId: edit.operationId,
        datasetGeneration: generation,
        status: accepted ? ("accepted" as const) : ("conflict" as const),
        document,
      };
      receipts.set(edit.operationId, receipt);
      return receipt;
    }),
  };
  return {
    remote,
    records,
    documents,
    receipts,
    sent,
    offline: () => {
      online = false;
    },
    online: () => {
      online = true;
    },
    refuse: () => {
      refused = true;
    },
    restore: () => {
      generation++;
    },
    loseReply: () => {
      lost = true;
    },
  };
}
function device(
  remote: LocalWorkspaceRemote,
  changed = () => {},
  path?: string,
): {
  service: LocalWorkspace;
  file: string;
  account(value: string | null): void;
} {
  const root = mkdtempSync(join(tmpdir(), "mithril-local-sqlite-"));
  roots.push(root);
  let scope: string | null = "scope-alice";
  const file = path ?? join(root, "workspace.sqlite");
  const service = new LocalWorkspace(file, () => scope, remote, changed);
  services.push(service);
  return {
    service,
    file,
    account: (value: string | null) => {
      scope = value;
      service.reset();
    },
  };
}
const project = (
  changes: Partial<WorkspaceOperation> = {},
): WorkspaceOperation => ({
  operationId: "op1",
  id: "project1",
  kind: "project",
  baseRevision: 0,
  data: { title: "Local project" },
  deleted: false,
  ...changes,
});
async function warm(service: LocalWorkspace): Promise<void> {
  await service.enable();
  await service.sync();
  expect(service.syncStatus().ready).toBe(true);
}

// @lat: [[local-workspace#Local SQLite workspace#Durable offline editing]]
it("reads locally without network, shares edits across sessions, and retains the outbox across process restart", async () => {
  const c = cloud(),
    changed = vi.fn(),
    d = device(c.remote, changed);
  await warm(d.service);
  c.offline();
  await d.service.sync();
  const calls = vi.mocked(c.remote.getSnapshot).mock.calls.length;
  const committed = d.service.applyOperations([project()], "alice");
  expect(committed.results[0].status).toBe("accepted");
  const sessionA = d.service.getSnapshot(),
    sessionB = d.service.getSnapshot();
  expect(sessionA.records).toEqual(sessionB.records);
  expect(sessionB.records[0].data.title).toBe("Local project");
  expect(vi.mocked(c.remote.getSnapshot)).toHaveBeenCalledTimes(calls);
  await d.service.sync();
  expect(d.service.syncStatus()).toMatchObject({
    phase: "offline",
    pending: 1,
  });
  expect(changed).toHaveBeenCalled();
  d.service.close();
  services.splice(services.indexOf(d.service), 1);
  const restarted = device(c.remote, () => {}, d.file).service;
  await restarted.enable();
  await restarted.sync();
  expect(restarted.getSnapshot().records[0].data.title).toBe("Local project");
  expect(restarted.syncStatus().pending).toBe(1);
  expect(readFileSync(d.file).includes(Buffer.from("SQLite format 3"))).toBe(
    true,
  );
  c.online();
  await restarted.sync();
  expect(restarted.syncStatus().pending).toBe(0);
  expect(c.records.size).toBe(1);
});
// @lat: [[local-workspace#Local SQLite workspace#Two device synchronization]]
it("synchronizes two independent SQLite databases through the cloud, including deletion tombstones", async () => {
  const c = cloud(),
    a = device(c.remote).service,
    b = device(c.remote).service;
  await warm(a);
  await warm(b);
  a.applyOperations([project()]);
  await a.sync();
  await b.sync();
  expect(b.getSnapshot().records[0].data.title).toBe("Local project");
  b.applyOperations([
    project({ operationId: "op2", baseRevision: 1, deleted: true }),
  ]);
  await b.sync();
  await a.sync();
  expect(a.getSnapshot().records[0]).toMatchObject({
    revision: 2,
    deleted: true,
  });
});
// @lat: [[local-workspace#Local SQLite workspace#Lost acknowledgement replay]]
it("replays a lost acknowledgement with the original operation ID and never increments twice", async () => {
  const c = cloud(),
    a = device(c.remote).service;
  await warm(a);
  c.loseReply();
  a.applyOperations([project()]);
  await a.sync();
  expect(a.syncStatus().pending).toBe(1);
  expect(c.records.get("project1")?.revision).toBe(1);
  await a.sync();
  expect(a.syncStatus().pending).toBe(0);
  expect(c.sent).toEqual(["op1", "op1"]);
  expect(c.records.get("project1")?.revision).toBe(1);
  expect(() =>
    a.applyOperations([project({ data: { title: "tampered ID" } })]),
  ).toThrow("ID reused");
});
// @lat: [[local-workspace#Local SQLite workspace#Conflict retention]]
it("retains both concurrent edits, blocks dependent replay, and explicitly resolves the latest local intent", async () => {
  const c = cloud(),
    a = device(c.remote).service,
    b = device(c.remote).service;
  await warm(a);
  await warm(b);
  c.offline();
  a.applyOperations([project()]);
  b.applyOperations([
    project({ operationId: "b1", data: { title: "Other device" } }),
  ]);
  b.applyOperations([
    project({
      operationId: "b2",
      baseRevision: 1,
      data: { title: "Latest offline intent" },
    }),
  ]);
  await a.sync();
  await b.sync();
  c.online();
  await a.sync();
  await b.sync();
  expect(b.syncStatus().conflicts).toHaveLength(1);
  expect(b.syncStatus().pending).toBe(2);
  expect(b.getSnapshot().records[0].data.title).toBe("Latest offline intent");
  expect(c.sent).not.toContain("b2");
  b.resolve("b1", "local");
  await b.sync();
  await a.sync();
  expect(a.getSnapshot().records[0]).toMatchObject({
    revision: 2,
    data: { title: "Latest offline intent" },
  });
  expect(b.syncStatus().pending).toBe(0);
});
// @lat: [[local-workspace#Local SQLite workspace#Repository metadata synchronization]]
it("durably edits rich Kanban metadata offline and shares it with another device", async () => {
  const c = cloud(),
    a = device(c.remote).service,
    b = device(c.remote).service;
  await warm(a);
  await warm(b);
  c.offline();
  const edit: RepositoryEdit = {
    operationId: "task1",
    collection: "task",
    id: "t1",
    baseRevision: 0,
    body: { title: "Offline task", status: "todo" },
    deleted: false,
  };
  expect(a.repositoryApply(edit).status).toBe("accepted");
  expect(a.repositoryPage("task").documents[0].body).toEqual(edit.body);
  await a.sync();
  c.online();
  await a.sync();
  await b.sync();
  expect(b.repositoryPage("task").documents[0].body).toEqual(edit.body);
});
// @lat: [[local-workspace#Local SQLite workspace#Account and generation fencing]]
it("never exposes another account cache and stops replay after destructive cloud restore", async () => {
  const c = cloud(),
    d = device(c.remote);
  await warm(d.service);
  c.offline();
  d.service.applyOperations([project()]);
  await d.service.sync();
  d.account("scope-bob");
  expect(() => d.service.getSnapshot()).toThrow("Sign in");
  d.account(null);
  expect(() => d.service.getSnapshot()).toThrow("Sign in");
  d.account("scope-alice");
  await d.service.enable();
  await d.service.sync();
  c.online();
  c.restore();
  await d.service.sync();
  expect(d.service.syncStatus()).toMatchObject({
    phase: "blocked",
    pending: 1,
  });
  expect(c.sent).toEqual([]);
});
// @lat: [[local-workspace#Local SQLite workspace#Revoked authorization]]
it("hides cached data after a remote authorization refusal rather than treating it as offline", async () => {
  const c = cloud(),
    a = device(c.remote).service;
  await warm(a);
  c.refuse();
  await a.sync();
  expect(a.status().userId).toBeNull();
  expect(() => a.getSnapshot()).toThrow("Sign in");
  expect(a.syncStatus().phase).toBe("blocked");
});
it("keeps newer cached data when a stale cloud generation is returned", async () => {
  const c = cloud(),
    a = device(c.remote).service;
  c.restore();
  await warm(a);
  vi.mocked(c.remote.getSnapshot).mockResolvedValueOnce({
    schemaVersion: 1 as const,
    userId: "alice",
    cursor: 0,
    datasetGeneration: 0,
    records: [],
  });
  await a.sync();
  expect(a.syncStatus().phase).toBe("blocked");
  expect(a.getSnapshot().datasetGeneration).toBe(1);
});
// @lat: [[local-workspace#Local SQLite workspace#Atomic local transaction]]
it("rolls back data and receipts together when one operation in a local batch is invalid", async () => {
  const c = cloud(),
    a = device(c.remote).service;
  await warm(a);
  c.offline();
  const original = project({ operationId: "existing" });
  a.applyOperations([original]);
  await a.sync();
  expect(() =>
    a.applyOperations([
      project({ operationId: "first-in-batch", id: "other" }),
      project({ operationId: "existing", data: { title: "ID reused" } }),
    ]),
  ).toThrow();
  expect(a.getSnapshot().records).toHaveLength(1);
  expect(a.syncStatus().pending).toBe(1);
  expect(
    a.applyOperations([project({ operationId: "first-in-batch", id: "other" })])
      .results[0].status,
  ).toBe("accepted");
});
// @lat: [[local-workspace#Local SQLite workspace#In-flight account change]]
it("fences late responses after sign-out without committing or replaying edits", async () => {
  const c = cloud(),
    d = device(c.remote);
  await warm(d.service);
  let release!: () => void;
  vi.mocked(c.remote.getSnapshot).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      schemaVersion: 1 as const,
      userId: "alice",
      cursor: 0,
      records: [],
    };
  });
  const pass = d.service.sync();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  d.account(null);
  release();
  await pass;
  expect(d.service.status().userId).toBeNull();
  expect(c.sent).toEqual([]);
});

// @lat: [[cloud-workspace-tests#Local shared schedule list]]
it("persists validated cloud schedule lists for offline restarts without network reads", async () => {
  const fixture = cloud();
  fixture.remote.getSchedules = vi.fn(async () => ({
    schemaVersion: 1 as const,
    userId: "alice",
    datasetGeneration: 0,
    schedules: [],
  }));
  const first = device(fixture.remote);
  await first.service.enable();
  await first.service.sync();
  expect(first.service.getSchedules().schedules).toEqual([]);
  first.service.close();
  fixture.offline();
  const restarted = device(fixture.remote, () => {}, first.file);
  await restarted.service.enable();
  fixture.remote.getSchedules = vi.fn(async () => {
    throw Error("Workspace network unavailable");
  });
  expect(restarted.service.getSchedules().userId).toBe("alice");
  expect(fixture.remote.getSchedules).not.toHaveBeenCalled();
  restarted.account("scope-bob");
  expect(() => restarted.service.getSchedules()).toThrow();
});
it("refuses foreign, stale-generation, and invalid cloud schedule inventories", async () => {
  for (const change of [
    { userId: "bob" },
    { datasetGeneration: 1 },
    { schedules: [{ id: "bad" }] },
  ]) {
    const fixture = cloud();
    fixture.remote.getSchedules = vi.fn(
      async () =>
        ({
          schemaVersion: 1,
          userId: "alice",
          datasetGeneration: 0,
          schedules: [],
          ...change,
        }) as never,
    );
    const d = device(fixture.remote);
    await d.service.enable();
    await d.service.sync();
    expect(d.service.syncStatus().phase).toBe("blocked");
    expect(() => d.service.getSchedules()).toThrow();
  }
});
