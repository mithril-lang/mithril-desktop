import Database from "better-sqlite3";
import {
  bindNativeHistorySources,
  recordNativeHistoryDeletion,
  nativeHistoryDeletions,
  prepareNativeHistoryDeletion,
  acknowledgeNativeHistoryDeletion,
} from "./native-history-deletions";
import { describe, expect, it } from "vitest";
import {
  NativeHistorySync,
  nativeCloudSessionId,
  type NativeHistoryJournal,
  type NativeHistoryPorts,
} from "./native-history-sync";
import type { ArchivedHistoryItem } from "@mithril/workspace/history";
import type {
  ChatSession,
  ChatEvent,
  ChatOperationResponse,
} from "@mithril/workspace/sessions";
import { vi } from "vitest";
function fixture(): {
  ports: NativeHistoryPorts;
  sessions: Map<string, ChatSession>;
  events: Map<string, ChatEvent[]>;
  state: () => NativeHistoryJournal;
  items: ArchivedHistoryItem[];
  lose: () => void;
  owner: (value: string) => void;
  executions: () => number;
  title: (value: string) => void;
  currentTitle: () => string;
  model: (value: string) => void;
  currentModel: () => string;
  archive: (value: boolean) => void;
  currentArchive: () => boolean | undefined;
} {
  const sessions = new Map<string, ChatSession>(),
    events = new Map<string, ChatEvent[]>(),
    receipts = new Map<string, ChatOperationResponse>();
  let state: NativeHistoryJournal = { entries: {} },
    userId = "alice",
    lost = false,
    executions = 0,
    nativeTitle = "Original chat",
    nativeModel = "mock",
    archived: boolean | undefined;
  const items: ArchivedHistoryItem[] = [
    { id: "user_1", kind: "user", content: "Investigate", timestamp: 1 },
    {
      id: "reasoning_2",
      kind: "reasoning",
      assistantId: "assistant_2",
      text: "Evidence",
      timestamp: 2,
    },
    {
      id: "tool_call_2",
      kind: "tool_call",
      assistantId: "assistant_2",
      callId: "call-one",
      name: "python",
      args: "17*23",
      timestamp: 2,
    },
    {
      id: "tool_result_3",
      kind: "tool_result",
      callId: "call-one",
      name: "python",
      content: "391",
      timestamp: 3,
    },
  ];
  const ports: NativeHistoryPorts = {
    context: async () => ({
      userId,
      profile: "default",
      epoch: 0,
      actor: "actor",
    }),
    source: async () => [
      {
        id: "original",
        title: nativeTitle,
        cacheTitle: async (title) => {
          nativeTitle = title || "Chat";
          return nativeTitle;
        },
        model: nativeModel,
        archived,
        cacheArchived: async (value) => {
          archived = value;
          return value;
        },
        cacheModel: async (model) => {
          nativeModel = model;
          return model;
        },
        items: async () => structuredClone(items),
      },
    ],
    read: () => structuredClone(state),
    write: (_owner, _profile, value) => {
      state = structuredClone(value);
    },
    transport: {
      list: async () => ({
        schemaVersion: 1,
        userId,
        sessions: [...sessions.values()],
      }),
      events: async (id) => ({
        schemaVersion: 1,
        userId,
        session: sessions.get(id)!,
        events: events.get(id) ?? [],
        hasMore: false,
        nextAfter: null,
      }),
      receipt: async (id, operationId) =>
        receipts.get(operationId) ?? {
          schemaVersion: 1,
          userId,
          operationId,
          status: "unknown",
          session: sessions.get(id) ?? null,
        },
      apply: async (id, operation) => {
        if (
          !["create", "history", "rename", "delete", "restore"].includes(
            operation.type,
          )
        ) {
          executions++;
          throw Error("Unexpected execution");
        }
        if (receipts.has(operation.operationId))
          return receipts.get(operation.operationId)!;
        const old = sessions.get(id),
          accepted = (old?.revision ?? 0) === operation.baseRevision;
        const session: ChatSession = {
          id,
          title:
            operation.type === "rename" && accepted
              ? operation.data.title
              : (old?.title ??
                (operation.type === "create" ? operation.data.title : "")),
          model:
            operation.type === "history" || operation.type === "create"
              ? operation.data.model
              : (old?.model ?? "mock"),
          revision: accepted ? (old?.revision ?? 0) + 1 : old!.revision,
          eventSeq: old?.eventSeq ?? 0,
          deleted: accepted
            ? operation.type === "delete"
              ? true
              : operation.type === "restore"
                ? false
                : (old?.deleted ?? false)
            : old!.deleted,
          activeTurn: null,
        };
        if (accepted && operation.type === "history")
          for (const item of operation.data.items) {
            const rows = events.get(id) ?? [];
            rows.push({
              seq: ++session.eventSeq,
              type: "history_item",
              turnId: null,
              data: { sourceId: item.id, payload: JSON.stringify(item) },
              createdAt: 1,
            });
            events.set(id, rows);
          }
        if (
          accepted &&
          ["rename", "delete", "restore"].includes(operation.type)
        ) {
          const rows = events.get(id) ?? [];
          rows.push({
            seq: ++session.eventSeq,
            type: "metadata",
            turnId: null,
            data: {
              title: session.title,
              model: session.model,
              deleted: String(session.deleted),
            },
            createdAt: 1,
          });
          events.set(id, rows);
        }
        if (accepted) sessions.set(id, session);
        const receipt: ChatOperationResponse = {
          schemaVersion: 1,
          userId,
          operationId: operation.operationId,
          status: accepted ? "accepted" : "conflict",
          session,
        };
        receipts.set(operation.operationId, receipt);
        if (
          lost &&
          ["history", "rename", "delete", "restore"].includes(operation.type)
        ) {
          lost = false;
          throw Error("Lost acknowledgement");
        }
        return receipt;
      },
    },
  };
  return {
    ports,
    sessions,
    events,
    state: () => state,
    items,
    lose: () => {
      lost = true;
    },
    owner: (value) => {
      userId = value;
    },
    executions: () => executions,
    title: (value) => {
      nativeTitle = value;
    },
    currentTitle: () => nativeTitle,
    model: (value) => {
      nativeModel = value;
    },
    currentModel: () => nativeModel,
    archive: (value) => {
      archived = value;
    },
    currentArchive: () => archived,
  };
}
describe("automatic rich native history archival", () => {
  // @lat: [[cloud-workspace-tests#Continuous rich chat history]]
  it("syncs rich history once and appends native edits without executing tools", async () => {
    const f = fixture(),
      sync = new NativeHistorySync(f.ports),
      sid = nativeCloudSessionId("default", "original");
    expect((await sync.run()).synced).toBe(4);
    expect((await sync.run()).synced).toBe(0);
    f.items[0].content = "Updated question";
    expect((await sync.run()).synced).toBe(1);
    expect(f.events.get(sid)).toHaveLength(5);
    expect(JSON.parse(f.events.get(sid)![4].data.payload).content).toBe(
      "Updated question",
    );
    expect(f.executions()).toBe(0);
  });
  // @lat: [[cloud-workspace-tests#Continuous rich chat history]]
  it("recovers lost acknowledgements after restart using the same operation receipt", async () => {
    const f = fixture();
    f.lose();
    const first = await new NativeHistorySync(f.ports).run();
    expect(first.deferred).toHaveLength(1);
    const sid = nativeCloudSessionId("default", "original"),
      pending = f.state().entries[sid].pending;
    expect(pending?.operation.type).toBe("history");
    await new NativeHistorySync(f.ports).run();
    expect(f.events.get(sid)).toHaveLength(4);
    expect(f.state().entries[sid].pending).toBeNull();
    expect(f.executions()).toBe(0);
  });
  // @lat: [[cloud-workspace-tests#Continuous rich chat history]]
  it("retains conflicting cloud edits rather than overwriting them with the native copy", async () => {
    const f = fixture(),
      sync = new NativeHistorySync(f.ports),
      sid = nativeCloudSessionId("default", "original");
    await sync.run();
    const session = f.sessions.get(sid)!;
    f.events.get(sid)!.push({
      seq: ++session.eventSeq,
      type: "history_item",
      turnId: null,
      createdAt: 1,
      data: {
        sourceId: "user_1",
        payload: JSON.stringify({ ...f.items[0], content: "Cloud edit" }),
      },
    });
    session.revision++;
    const result = await sync.run();
    expect(result.conflicts).toEqual([sid]);
    expect(f.items[0].content).toBe("Investigate");
    expect(f.events.get(sid)).toHaveLength(5);
  });
  // @lat: [[cloud-workspace-tests#Continuous rich chat history]]
  it("refuses executable pending operations in a corrupted journal", async () => {
    const f = fixture(),
      sid = nativeCloudSessionId("default", "original");
    f.ports.read = () => ({
      entries: {
        [sid]: {
          hashes: {},
          pending: {
            sessionId: sid,
            operation: {
              type: "turn",
              operationId: "evil",
              baseRevision: 0,
              data: { content: "Execute", model: "mock" },
            },
            conflicted: false,
          },
        },
      },
    });
    await expect(new NativeHistorySync(f.ports).run()).rejects.toThrow(
      "Unsafe pending history operation",
    );
    expect(f.executions()).toBe(0);
  });
  // @lat: [[cloud-workspace-tests#Continuous rich chat history]]
  it("defers a busy chat and continues other independent chats", async () => {
    const f = fixture(),
      sync = new NativeHistorySync(f.ports);
    await sync.run();
    f.sessions.get(nativeCloudSessionId("default", "original"))!.activeTurn = {
      id: "busy",
      status: "running",
      leaseExpiresAt: Date.now() + 1000,
    };
    const source = f.ports.source;
    f.ports.source = async () => [
      ...(await source()),
      {
        id: "second",
        title: "Second",
        model: "mock",
        items: async () => f.items,
      },
    ];
    const result = await sync.run();
    expect(result.deferred).toHaveLength(1);
    expect(result.synced).toBe(4);
  });
  // @lat: [[cloud-workspace-tests#Continuous rich chat history]]
  it("rejects incomplete checkpoints before writing native updates", async () => {
    const f = fixture();
    await new NativeHistorySync(f.ports).run();
    f.items[0].content = "Native edit";
    const events = f.ports.transport.events;
    f.ports.transport.events = async (...args) => {
      const result = await events(...args);
      return { ...result, events: result.events.slice(1) };
    };
    const result = await new NativeHistorySync(f.ports).run();
    expect(result.deferred[0]).toContain("Invalid history checkpoint order");
    expect(result.synced).toBe(0);
  });
  // @lat: [[cloud-workspace-tests#Continuous rich chat history]]
  it("stops after an account change before transmitting history", async () => {
    const f = fixture();
    const source = f.ports.source;
    f.ports.source = async () => {
      const value = await source();
      f.owner("bob");
      return value;
    };
    await expect(new NativeHistorySync(f.ports).run()).rejects.toThrow(
      "History account changed",
    );
    expect(f.sessions.size).toBe(0);
  });
  // @lat: [[cloud-workspace-tests#Continuous rich chat history]]
  it("requires a durable journal before submitting any operation", async () => {
    const f = fixture();
    f.ports.write = () => {
      throw Error("Disk unavailable");
    };
    const result = await new NativeHistorySync(f.ports).run();
    expect(result.deferred[0]).toContain("Disk unavailable");
    expect(f.sessions.size).toBe(0);
  });
  // @lat: [[cloud-workspace-tests#Cloud history working cache]]
  it("pulls cloud-only edits to the working cache without echoing stale native data", async () => {
    const f = fixture(),
      sid = nativeCloudSessionId("default", "original");
    let cache: ArchivedHistoryItem[] = [];
    const source = f.ports.source;
    f.ports.source = async () =>
      (await source()).map((value) => ({
        ...value,
        cache: async (_sid, items) => {
          cache = structuredClone(items);
        },
      }));
    const sync = new NativeHistorySync(f.ports);
    await sync.run();
    const session = f.sessions.get(sid)!;
    f.events.get(sid)!.push({
      seq: ++session.eventSeq,
      type: "history_item",
      turnId: null,
      createdAt: 1,
      data: {
        sourceId: "user_1",
        payload: JSON.stringify({ ...f.items[0], content: "Cloud update" }),
      },
    });
    session.revision++;
    expect((await sync.run()).conflicts).toEqual([]);
    expect(cache.find((item) => item.id === "user_1")?.content).toBe(
      "Cloud update",
    );
    const count = f.events.get(sid)!.length;
    expect((await sync.run()).synced).toBe(0);
    expect(f.events.get(sid)).toHaveLength(count);
    f.items[0].content = "New native edit";
    expect((await sync.run()).synced).toBe(1);
    expect(f.executions()).toBe(0);
  });
  // @lat: [[cloud-workspace-tests#Cloud history working cache]]
  it("propagates removed native items as tombstones and never re-adds them on restart", async () => {
    const f = fixture(),
      sid = nativeCloudSessionId("default", "original");
    await new NativeHistorySync(f.ports).run();
    f.items.splice(0, 1);
    expect((await new NativeHistorySync(f.ports).run()).synced).toBe(1);
    expect(JSON.parse(f.events.get(sid)!.at(-1)!.data.payload).deleted).toBe(
      true,
    );
    expect((await new NativeHistorySync(f.ports).run()).synced).toBe(0);
    expect(f.executions()).toBe(0);
  });
});

// @lat: [[cloud-workspace-tests#Remote-only chat reconstruction]]
it("reconstructs only unmapped cloud sessions with exact owner checkpoints and never applies an execution", async () => {
  const f = fixture();
  await new NativeHistorySync(f.ports).run();
  const remote: ChatSession = {
    id: "browser-chat",
    title: "Browser work",
    model: "mock",
    revision: 3,
    eventSeq: 2,
    deleted: false,
    activeTurn: null,
  };
  const events: ChatEvent[] = [
    {
      seq: 1,
      type: "user",
      turnId: "turn",
      data: { content: "Original question" },
      createdAt: 1,
    },
    {
      seq: 2,
      type: "assistant",
      turnId: "turn",
      data: { content: "Original answer" },
      createdAt: 2,
    },
  ];
  f.sessions.set(remote.id, remote);
  f.events.set(remote.id, events);
  const cache = vi.fn();
  f.ports.cacheRemote = cache;
  expect((await new NativeHistorySync(f.ports).run()).reconstructed).toBe(1);
  expect(cache).toHaveBeenCalledExactlyOnceWith(
    remote,
    events,
    expect.objectContaining({ userId: "alice", profile: "default" }),
  );
  expect(f.executions()).toBe(0);
  f.sessions.set(remote.id, { ...remote, deleted: true, revision: 4 });
  await new NativeHistorySync(f.ports).run();
  expect(cache).toHaveBeenLastCalledWith(
    { ...remote, deleted: true, revision: 4 },
    [],
    expect.objectContaining({ userId: "alice" }),
  );
});

// @lat: [[cloud-workspace-tests#Remote-only chat reconstruction]]
it("retains existing caches when a remote log is incomplete, changes revision or switches account", async () => {
  const f = fixture();
  f.ports.source = async () => [];
  const remote: ChatSession = {
    id: "browser-chat",
    title: "Browser work",
    model: "mock",
    revision: 3,
    eventSeq: 2,
    deleted: false,
    activeTurn: null,
  };
  f.sessions.set(remote.id, remote);
  f.events.set(remote.id, []);
  const cache = vi.fn();
  f.ports.cacheRemote = cache;
  expect((await new NativeHistorySync(f.ports).run()).deferred[0]).toContain(
    "Incomplete",
  );
  expect(cache).not.toHaveBeenCalled();
  const original = f.ports.transport.events;
  f.ports.transport.events = async (id, after) => ({
    ...(await original(id, after)),
    session: { ...remote, revision: 4 },
  });
  expect((await new NativeHistorySync(f.ports).run()).deferred[0]).toContain(
    "changed",
  );
  expect(cache).not.toHaveBeenCalled();
  f.ports.transport.events = async (id, after) => {
    const reply = await original(id, after);
    f.owner("bob");
    return reply;
  };
  await expect(new NativeHistorySync(f.ports).run()).rejects.toThrow(
    "account changed",
  );
  expect(cache).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#Remote-only chat reconstruction]]
it("keeps cloud reconstruction available when original device storage is unavailable without adopting or deleting it", async () => {
  const f = fixture();
  f.ports.source = async () => {
    throw Error("Native source belongs to another account; retained");
  };
  const remote: ChatSession = {
    id: "browser",
    title: "Cloud chat",
    model: "mock",
    revision: 1,
    eventSeq: 0,
    deleted: false,
    activeTurn: null,
  };
  f.sessions.set(remote.id, remote);
  const cache = vi.fn();
  f.ports.cacheRemote = cache;
  const result = await new NativeHistorySync(f.ports).run();
  expect(result.deferred).toContain(
    "Native source belongs to another account; retained",
  );
  expect(cache).toHaveBeenCalledExactlyOnceWith(
    remote,
    [],
    expect.objectContaining({ userId: "alice" }),
  );
  expect(f.state().entries).toEqual({});
  expect(f.executions()).toBe(0);
});

// @lat: [[cloud-workspace-tests#Remote-only chat reconstruction]]
it("reads bounded remote pages and refuses oversized histories before changing the retained cache", async () => {
  const f = fixture();
  f.ports.source = async () => [];
  const session: ChatSession = {
    id: "browser",
    title: "Paged history",
    model: "mock",
    revision: 1,
    eventSeq: 2,
    deleted: false,
    activeTurn: null,
  };
  f.sessions.set(session.id, session);
  const events: ChatEvent[] = [1, 2].map((seq) => ({
    seq,
    type: "user",
    turnId: "turn",
    data: { content: "Original" },
    createdAt: seq,
  }));
  f.ports.transport.events = async (_id, after = 0) => ({
    schemaVersion: 1,
    userId: "alice",
    session,
    events: events.slice(after, after + 1),
    hasMore: after === 0,
    nextAfter: after === 0 ? 1 : null,
  });
  const cache = vi.fn();
  f.ports.cacheRemote = cache;
  expect((await new NativeHistorySync(f.ports).run()).reconstructed).toBe(1);
  expect(cache).toHaveBeenCalledExactlyOnceWith(
    session,
    events,
    expect.objectContaining({ userId: "alice" }),
  );
  cache.mockClear();
  const large = { ...session, revision: 2, eventSeq: 3500 };
  f.sessions.set(large.id, large);
  const content = "x".repeat(16000);
  f.ports.transport.events = async (_id, after = 0) => {
    const next = Math.min(after + 100, large.eventSeq);
    return {
      schemaVersion: 1,
      userId: "alice",
      session: large,
      events: Array.from({ length: next - after }, (_, index) => ({
        seq: after + index + 1,
        type: "user" as const,
        turnId: "turn",
        data: { content },
        createdAt: 1,
      })),
      hasMore: next < large.eventSeq,
      nextAfter: next < large.eventSeq ? next : null,
    };
  };
  expect((await new NativeHistorySync(f.ports).run()).deferred[0]).toContain(
    "byte bound",
  );
  expect(cache).not.toHaveBeenCalled();
  expect(f.executions()).toBe(0);
});

// @lat: [[cloud-workspace-tests#Remote-only chat reconstruction]]
it("avoids re-downloading unchanged acknowledged remote revisions while keeping write counts separate", async () => {
  const f = fixture();
  f.ports.source = async () => [];
  const session: ChatSession = {
    id: "browser",
    title: "Cached chat",
    model: "mock",
    revision: 1,
    eventSeq: 0,
    deleted: false,
    activeTurn: null,
  };
  f.sessions.set(session.id, session);
  const versions = new Map<string, number>();
  const cache = vi.fn(async (value: ChatSession) => {
    versions.set(value.id, value.revision);
  });
  f.ports.cacheRemote = cache;
  f.ports.hasRemote = async (value) =>
    versions.get(value.id) === value.revision;
  const first = await new NativeHistorySync(f.ports).run();
  expect(first).toMatchObject({ synced: 0, reconstructed: 1 });
  f.ports.transport.events = async () => {
    throw Error("Unexpected download");
  };
  expect(await new NativeHistorySync(f.ports).run()).toMatchObject({
    synced: 0,
    reconstructed: 0,
    deferred: [],
  });
  expect(cache).toHaveBeenCalledOnce();
});

// @lat: [[cloud-workspace-tests#Bidirectional original chat titles]]
it("reconciles native and cloud title edits without echo writes or execution", async () => {
  const f = fixture(),
    sid = nativeCloudSessionId("default", "original"),
    sync = new NativeHistorySync(f.ports);
  await sync.run();
  const apply = vi.spyOn(f.ports.transport, "apply");
  f.title("Native renamed");
  expect((await sync.run()).conflicts).toEqual([]);
  expect(f.sessions.get(sid)!.title).toBe("Native renamed");
  expect(
    apply.mock.calls.filter(([, op]) => op.type === "rename"),
  ).toHaveLength(1);
  await f.ports.transport.apply(sid, {
    type: "rename",
    operationId: crypto.randomUUID(),
    baseRevision: f.sessions.get(sid)!.revision,
    data: { title: "Cloud renamed" },
  });
  apply.mockClear();
  expect((await sync.run()).conflicts).toEqual([]);
  expect(f.currentTitle()).toBe("Cloud renamed");
  await sync.run();
  expect(apply).not.toHaveBeenCalled();
  expect(f.executions()).toBe(0);
});
it("retains both concurrent title edits instead of overwriting either side", async () => {
  const f = fixture(),
    sid = nativeCloudSessionId("default", "original"),
    sync = new NativeHistorySync(f.ports);
  await sync.run();
  f.title("Native draft");
  await f.ports.transport.apply(sid, {
    type: "rename",
    operationId: crypto.randomUUID(),
    baseRevision: f.sessions.get(sid)!.revision,
    data: { title: "Cloud draft" },
  });
  const apply = vi.spyOn(f.ports.transport, "apply");
  expect((await sync.run()).conflicts).toContain(sid);
  expect(f.state().entries[sid].titleConflict).toEqual({
    native: "Native draft",
    cloud: "Cloud draft",
  });
  expect(f.currentTitle()).toBe("Native draft");
  expect(f.sessions.get(sid)!.title).toBe("Cloud draft");
  expect(apply).not.toHaveBeenCalled();
  expect(f.executions()).toBe(0);
});
it("recovers a lost title acknowledgement after restart using the original operation ID", async () => {
  const f = fixture(),
    sid = nativeCloudSessionId("default", "original");
  await new NativeHistorySync(f.ports).run();
  f.title("Offline rename");
  f.lose();
  const apply = vi.spyOn(f.ports.transport, "apply");
  expect((await new NativeHistorySync(f.ports).run()).deferred.length).toBe(1);
  const pending = f.state().entries[sid].pending!;
  expect(pending.operation.type).toBe("rename");
  expect(f.sessions.get(sid)!.title).toBe("Offline rename");
  await new NativeHistorySync(f.ports).run();
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][1].operationId).toBe(
    pending.operation.operationId,
  );
  expect(f.state().entries[sid].pending).toBeNull();
  expect(f.executions()).toBe(0);
});
it("does not acknowledge a newer source title using an older lost receipt", async () => {
  const f = fixture(),
    sid = nativeCloudSessionId("default", "original");
  await new NativeHistorySync(f.ports).run();
  f.title("First rename");
  f.lose();
  await new NativeHistorySync(f.ports).run();
  f.title("Newer rename");
  await new NativeHistorySync(f.ports).run();
  expect(f.sessions.get(sid)!.title).toBe("Newer rename");
  expect(f.state().entries[sid].title).toEqual({
    native: "Newer rename",
    cloud: "Newer rename",
  });
  expect(f.executions()).toBe(0);
});

it("retains an unknown upgrade baseline until both independently preserved titles converge", async () => {
  const f = fixture(),
    sid = nativeCloudSessionId("default", "original"),
    sync = new NativeHistorySync(f.ports);
  await sync.run();
  const journal = f.state();
  delete journal.entries[sid].title;
  f.ports.write("alice", "default", journal);
  await f.ports.transport.apply(sid, {
    type: "rename",
    operationId: crypto.randomUUID(),
    baseRevision: f.sessions.get(sid)!.revision,
    data: { title: "Cloud edited before upgrade" },
  });
  expect((await sync.run()).conflicts).toContain(sid);
  expect(f.currentTitle()).toBe("Original chat");
  f.title("Cloud edited before upgrade");
  expect((await sync.run()).conflicts).toEqual([]);
  expect(f.state().entries[sid].titleConflict).toBeUndefined();
});
it("refuses a changing paginated checkpoint before any native title writeback", async () => {
  const f = fixture(),
    sid = nativeCloudSessionId("default", "original"),
    sync = new NativeHistorySync(f.ports);
  await sync.run();
  const rows = f.events.get(sid)!,
    session = f.sessions.get(sid)!;
  f.ports.transport.events = async (_id, after = 0) => ({
    schemaVersion: 1,
    userId: "alice",
    session: {
      ...session,
      title: after ? "Concurrent title" : "Original chat",
      revision: session.revision + (after ? 1 : 0),
    },
    events: after ? rows.slice(1) : rows.slice(0, 1),
    hasMore: !after,
    nextAfter: after ? null : 1,
  });
  expect(
    (await sync.run()).deferred.some((value) =>
      value.includes("changed during pagination"),
    ),
  ).toBe(true);
  expect(f.currentTitle()).toBe("Original chat");
  expect(f.executions()).toBe(0);
});

it("retains an unsupported source title without storing an invalid pending operation", async () => {
  const f = fixture(),
    sid = nativeCloudSessionId("default", "original"),
    sync = new NativeHistorySync(f.ports);
  await sync.run();
  f.title("x".repeat(513));
  const apply = vi.spyOn(f.ports.transport, "apply");
  expect((await sync.run()).deferred.length).toBe(1);
  expect(f.state().entries[sid].pending).toBeNull();
  expect(apply).not.toHaveBeenCalled();
  expect(f.currentTitle()).toHaveLength(513);
  expect(f.sessions.get(sid)!.title).toBe("Original chat");
});

// @lat: [[cloud-workspace-tests#Reviewed title conflict resolution]]
it("resolves only the reviewed title pair and preserves newer edits", async () => {
  for (const choice of ["native", "cloud"] as const) {
    const f = fixture(),
      sync = new NativeHistorySync(f.ports);
    await sync.run();
    const sid = nativeCloudSessionId("default", "original");
    f.title("Native edit");
    const remote = f.sessions.get(sid)!;
    f.sessions.set(sid, {
      ...remote,
      title: "Cloud edit",
      revision: remote.revision + 1,
    });
    const review = (await sync.run()).titleConflicts[0];
    expect(review).toMatchObject({
      native: "Native edit",
      cloud: "Cloud edit",
    });
    await sync.resolveTitle({
      ...review,
      userId: "alice",
      profile: "default",
      choice,
    });
    expect(f.currentTitle()).toBe(
      choice === "native" ? "Native edit" : "Cloud edit",
    );
    expect(f.sessions.get(sid)!.title).toBe(f.currentTitle());
    expect((await sync.run()).titleConflicts).toEqual([]);
    expect(f.executions()).toBe(0);
  }
  const f = fixture(),
    sync = new NativeHistorySync(f.ports);
  await sync.run();
  const sid = nativeCloudSessionId("default", "original"),
    remote = f.sessions.get(sid)!;
  f.title("Native edit");
  f.sessions.set(sid, {
    ...remote,
    title: "Cloud edit",
    revision: remote.revision + 1,
  });
  const review = (await sync.run()).titleConflicts[0];
  f.title("Newer native edit");
  await expect(
    sync.resolveTitle({
      ...review,
      userId: "alice",
      profile: "default",
      choice: "cloud",
    }),
  ).rejects.toThrow("changed");
  expect(f.currentTitle()).toBe("Newer native edit");
  expect(f.sessions.get(sid)!.title).toBe("Cloud edit");
  f.owner("bob");
  await expect(
    sync.resolveTitle({
      ...review,
      userId: "alice",
      profile: "default",
      choice: "native",
    }),
  ).rejects.toThrow("account changed");
  expect(f.executions()).toBe(0);
});
it("recovers a reviewed native title choice after a lost acknowledgement", async () => {
  const f = fixture(),
    sync = new NativeHistorySync(f.ports);
  await sync.run();
  const sid = nativeCloudSessionId("default", "original"),
    remote = f.sessions.get(sid)!;
  f.title("Native edit");
  f.sessions.set(sid, {
    ...remote,
    title: "Cloud edit",
    revision: remote.revision + 1,
  });
  const review = (await sync.run()).titleConflicts[0];
  f.lose();
  await sync.resolveTitle({
    ...review,
    userId: "alice",
    profile: "default",
    choice: "native",
  });
  const operationId = f.state().entries[sid].pending!.operation.operationId;
  const receipt = vi.spyOn(f.ports.transport, "receipt");
  await new NativeHistorySync(f.ports).run();
  expect(receipt).toHaveBeenCalledWith(sid, operationId);
  expect(f.state().entries[sid].pending).toBeNull();
  expect(f.sessions.get(sid)!.title).toBe("Native edit");
  expect(f.executions()).toBe(0);
});

it("rejects a title choice after the cloud revision changes even if its title is unchanged", async () => {
  const f = fixture(),
    sync = new NativeHistorySync(f.ports);
  await sync.run();
  const sid = nativeCloudSessionId("default", "original"),
    remote = f.sessions.get(sid)!;
  f.title("Native edit");
  f.sessions.set(sid, {
    ...remote,
    title: "Cloud edit",
    revision: remote.revision + 1,
  });
  const review = (await sync.run()).titleConflicts[0];
  f.sessions.set(sid, {
    ...f.sessions.get(sid)!,
    revision: review.cloudRevision + 1,
  });
  const apply = vi.spyOn(f.ports.transport, "apply");
  await expect(
    sync.resolveTitle({
      ...review,
      userId: "alice",
      profile: "default",
      choice: "native",
    }),
  ).rejects.toThrow("changed");
  expect(apply).not.toHaveBeenCalled();
  expect(f.currentTitle()).toBe("Native edit");
  expect(f.sessions.get(sid)!.title).toBe("Cloud edit");
});

// @lat: [[cloud-workspace-tests#Native history model reconciliation]]
it("synchronizes archived models in both directions with exact replay, concurrent conflicts and no execution", async () => {
  const f = fixture(),
    sync = new NativeHistorySync(f.ports),
    sid = nativeCloudSessionId("default", "original");
  expect((await sync.run()).deferred).toEqual([]);
  const count = f.events.get(sid)!.length,
    items = structuredClone(f.items);
  f.model("native-two");
  f.lose();
  expect((await sync.run()).deferred).not.toEqual([]);
  const pending = f.state().entries[sid].pending!;
  expect(pending.operation).toMatchObject({
    type: "history",
    data: { model: "native-two", items: [] },
  });
  expect((await sync.run()).deferred).toEqual([]);
  expect(f.sessions.get(sid)!.model).toBe("native-two");
  expect(f.events.get(sid)).toHaveLength(count);
  expect(f.state().entries[sid].pending).toBeNull();
  const remote = f.sessions.get(sid)!;
  f.sessions.set(sid, {
    ...remote,
    model: "cloud-three",
    revision: remote.revision + 1,
  });
  expect((await sync.run()).deferred).toEqual([]);
  expect(f.currentModel()).toBe("cloud-three");
  f.model("native-four");
  f.sessions.set(sid, {
    ...f.sessions.get(sid)!,
    model: "cloud-four",
    revision: f.sessions.get(sid)!.revision + 1,
  });
  expect((await sync.run()).conflicts).toContain(sid);
  expect(f.currentModel()).toBe("native-four");
  expect(f.sessions.get(sid)!.model).toBe("cloud-four");
  f.items[0] = {
    ...f.items[0],
    content: "Later native content",
  } as ArchivedHistoryItem;
  await sync.run();
  expect((await sync.run()).conflicts).toContain(sid);
  expect(f.sessions.get(sid)!.model).toBe("cloud-four");
  expect(f.executions()).toBe(0);
  expect(f.items.slice(1)).toEqual(items.slice(1));
});

// @lat: [[cloud-workspace-tests#Reviewed model conflict resolution]]
it("resolves reviewed models with exact retry and refuses stale or wrong-owner choices", async () => {
  for (const choice of ["native", "cloud"] as const) {
    const f = fixture(),
      sync = new NativeHistorySync(f.ports),
      sid = nativeCloudSessionId("default", "original");
    await sync.run();
    const count = f.events.get(sid)!.length;
    f.model("native-edit");
    f.sessions.set(sid, {
      ...f.sessions.get(sid)!,
      model: "cloud-edit",
      revision: f.sessions.get(sid)!.revision + 1,
    });
    const review = (await sync.run()).modelConflicts[0];
    expect(review).toMatchObject({
      native: "native-edit",
      cloud: "cloud-edit",
    });
    if (choice === "native") f.lose();
    await sync.resolveModel({
      ...review,
      userId: "alice",
      profile: "default",
      choice,
    });
    const pending = f.state().entries[sid].pending;
    if (choice === "native") {
      expect(pending?.operation.data).toMatchObject({
        model: "native-edit",
        items: [],
      });
      const receipt = vi.spyOn(f.ports.transport, "receipt");
      await new NativeHistorySync(f.ports).run();
      expect(receipt).toHaveBeenCalledWith(sid, pending!.operation.operationId);
    }
    expect(f.currentModel()).toBe(
      choice === "native" ? "native-edit" : "cloud-edit",
    );
    expect(f.sessions.get(sid)!.model).toBe(f.currentModel());
    expect((await sync.run()).modelConflicts).toEqual([]);
    expect(f.events.get(sid)).toHaveLength(count);
    expect(f.executions()).toBe(0);
  }
  for (const change of ["native", "revision", "owner"] as const) {
    const f = fixture(),
      sync = new NativeHistorySync(f.ports),
      sid = nativeCloudSessionId("default", "original");
    await sync.run();
    f.model("native-edit");
    f.sessions.set(sid, {
      ...f.sessions.get(sid)!,
      model: "cloud-edit",
      revision: f.sessions.get(sid)!.revision + 1,
    });
    const review = (await sync.run()).modelConflicts[0];
    if (change === "native") f.model("newer-native");
    if (change === "revision")
      f.sessions.set(sid, {
        ...f.sessions.get(sid)!,
        revision: review.cloudRevision + 1,
      });
    if (change === "owner") f.owner("bob");
    const apply = vi.spyOn(f.ports.transport, "apply");
    await expect(
      sync.resolveModel({
        ...review,
        userId: "alice",
        profile: "default",
        choice: "cloud",
      }),
    ).rejects.toThrow(change === "owner" ? "account changed" : "changed");
    expect(f.currentModel()).toBe(
      change === "native" ? "newer-native" : "native-edit",
    );
    expect(f.sessions.get(sid)!.model).toBe("cloud-edit");
    expect(apply).not.toHaveBeenCalled();
    expect(f.executions()).toBe(0);
  }
});

// @lat: [[cloud-workspace-tests#Original chat archive synchronization]]
it("syncs archives and restoration both ways with retained history and exact lost receipts", async () => {
  const f = fixture(),
    sid = nativeCloudSessionId("default", "original"),
    sync = new NativeHistorySync(f.ports);
  f.archive(true);
  expect((await sync.run()).deferred).toEqual([]);
  expect(f.sessions.get(sid)!.deleted).toBe(true);
  expect(
    f.events.get(sid)!.filter((event) => event.type === "history_item"),
  ).toHaveLength(f.items.length);
  const original = structuredClone(f.items);
  f.archive(false);
  f.lose();
  await sync.run();
  const pending = f.state().entries[sid].pending!;
  expect(pending.operation.type).toBe("restore");
  const receipt = vi.spyOn(f.ports.transport, "receipt");
  expect((await new NativeHistorySync(f.ports).run()).deferred).toEqual([]);
  expect(receipt).toHaveBeenCalledWith(sid, pending.operation.operationId);
  expect(f.sessions.get(sid)!.deleted).toBe(false);
  for (const deleted of [true, false]) {
    f.sessions.set(sid, {
      ...f.sessions.get(sid)!,
      deleted,
      revision: f.sessions.get(sid)!.revision + 1,
    });
    expect((await sync.run()).deferred).toEqual([]);
    expect(f.currentArchive()).toBe(deleted);
    expect(f.items).toEqual(original);
  }
  f.archive(true);
  f.lose();
  await sync.run();
  expect(f.state().entries[sid].pending!.operation.type).toBe("delete");
  await sync.run();
  expect(f.state().entries[sid].pending).toBeNull();
  expect(f.sessions.get(sid)!.deleted).toBe(true);
  expect(f.items).toEqual(original);
  expect(f.executions()).toBe(0);
});
// @lat: [[cloud-workspace-tests#Reviewed chat visibility choices]]
it("requires review for older unequal visibility and refuses stale or wrong-owner choices", async () => {
  for (const choice of ["native", "cloud"] as const) {
    const f = fixture(),
      sid = nativeCloudSessionId("default", "original"),
      sync = new NativeHistorySync(f.ports);
    await sync.run(); // Older journal has no visibility origin.
    f.archive(true);
    const review = (await sync.run()).visibilityConflicts[0];
    expect(review).toMatchObject({ native: "archived", cloud: "visible" });
    await sync.resolveVisibility({
      ...review,
      userId: "alice",
      profile: "default",
      choice,
    });
    expect(f.currentArchive()).toBe(choice === "native");
    expect(f.sessions.get(sid)!.deleted).toBe(choice === "native");
    expect((await sync.run()).visibilityConflicts).toEqual([]);
    expect(f.executions()).toBe(0);
  }
  const f = fixture(),
    sid = nativeCloudSessionId("default", "original"),
    sync = new NativeHistorySync(f.ports);
  await sync.run();
  f.archive(true);
  const review = (await sync.run()).visibilityConflicts[0];
  f.sessions.set(sid, {
    ...f.sessions.get(sid)!,
    revision: review.cloudRevision + 1,
  });
  await expect(
    sync.resolveVisibility({
      ...review,
      userId: "alice",
      profile: "default",
      choice: "cloud",
    }),
  ).rejects.toThrow("changed");
  expect(f.currentArchive()).toBe(true);
  f.owner("bob");
  await expect(
    sync.resolveVisibility({
      ...review,
      userId: "alice",
      profile: "default",
      choice: "native",
    }),
  ).rejects.toThrow("account changed");
});

// @lat: [[cloud-workspace-tests#Archive synchronization guards]]
it("defers busy visibility, rejects changed checkpoints and retains legacy source without archive support", async () => {
  const f = fixture(),
    sid = nativeCloudSessionId("default", "original"),
    sync = new NativeHistorySync(f.ports);
  f.archive(false);
  await sync.run();
  f.archive(true);
  f.sessions.get(sid)!.activeTurn = {
    id: "busy",
    status: "running",
    leaseExpiresAt: Date.now() + 1000,
  };
  const apply = vi.spyOn(f.ports.transport, "apply");
  expect((await sync.run()).deferred).toContain(sid);
  expect(apply).not.toHaveBeenCalled();
  expect(f.sessions.get(sid)!.deleted).toBe(false);
  f.archive(false);
  f.sessions.set(sid, {
    ...f.sessions.get(sid)!,
    activeTurn: null,
    deleted: true,
    revision: f.sessions.get(sid)!.revision + 1,
  });
  const events = f.ports.transport.events;
  f.ports.transport.events = async (...args) => {
    const result = await events(...args);
    return {
      ...result,
      session: { ...result.session, revision: result.session.revision + 1 },
    };
  };
  expect(
    (await sync.run()).deferred.some((value) =>
      value.includes("checkpoint changed"),
    ),
  ).toBe(true);
  expect(f.currentArchive()).toBe(false);
  const legacy = fixture(),
    legacySync = new NativeHistorySync(legacy.ports);
  await legacySync.run();
  legacy.sessions.set(sid, {
    ...legacy.sessions.get(sid)!,
    deleted: true,
    revision: legacy.sessions.get(sid)!.revision + 1,
  });
  expect((await legacySync.run()).deferred).toContain(sid);
  expect(legacy.currentArchive()).toBeUndefined();
  expect(legacy.executions()).toBe(0);
});

function deletedSourceFixture(): ReturnType<typeof fixture> & {
  db: Database.Database;
  remove(): void;
} {
  const f = fixture(),
    db = new Database(":memory:"),
    sid = nativeCloudSessionId("default", "original");
  db.exec(
    "CREATE TABLE sessions(id TEXT PRIMARY KEY);INSERT INTO sessions VALUES('original');",
  );
  bindNativeHistorySources(db, "alice", "default", [
    { sourceId: "original", sessionId: sid },
  ]);
  f.ports.deletions = {
    list: async (identity) =>
      nativeHistoryDeletions(db, identity.userId, identity.profile),
    prepare: async (identity, intent, revision) =>
      prepareNativeHistoryDeletion(
        db,
        identity.userId,
        identity.profile,
        intent,
        revision,
      ),
    acknowledge: async (identity, intent, receipt) =>
      acknowledgeNativeHistoryDeletion(
        db,
        identity.userId,
        identity.profile,
        intent,
        receipt,
      ),
  };
  return {
    ...f,
    db,
    remove: () => {
      db.transaction(() => {
        recordNativeHistoryDeletion(db, "original");
        db.prepare("DELETE FROM sessions WHERE id='original'").run();
      })();
      f.ports.source = async () => [];
    },
  };
}
// @lat: [[cloud-workspace-tests#Original deletion receipt synchronization]]
it("recovers a physical source deletion with the same receipt and prevents remote cache resurrection", async () => {
  const f = deletedSourceFixture(),
    sync = new NativeHistorySync(f.ports),
    sid = nativeCloudSessionId("default", "original");
  try {
    await sync.run();
    const history = structuredClone(f.events.get(sid));
    f.remove();
    f.lose();
    const cache = vi.fn();
    f.ports.cacheRemote = cache;
    expect(
      (await sync.run()).deferred.some((value) =>
        value.includes("Lost acknowledgement"),
      ),
    ).toBe(true);
    const intent = nativeHistoryDeletions(f.db, "alice", "default")[0];
    expect(intent.baseRevision).not.toBeNull();
    expect(cache).not.toHaveBeenCalled();
    const receipt = vi.spyOn(f.ports.transport, "receipt");
    expect((await new NativeHistorySync(f.ports).run()).deferred).toEqual([]);
    expect(receipt).toHaveBeenCalledWith(sid, intent.operationId);
    expect(nativeHistoryDeletions(f.db, "alice", "default")).toEqual([]);
    expect(cache).toHaveBeenCalledWith(
      expect.objectContaining({ id: sid, deleted: true }),
      [],
      expect.objectContaining({ userId: "alice" }),
    );
    expect(f.events.get(sid)!.slice(0, history!.length)).toEqual(history);
    expect(f.executions()).toBe(0);
  } finally {
    f.db.close();
  }
});
// @lat: [[cloud-workspace-tests#Original deletion conflict and account guards]]
it("retains exact pending deletion on busy work, CAS conflict and account changes", async () => {
  const f = deletedSourceFixture(),
    sync = new NativeHistorySync(f.ports),
    sid = nativeCloudSessionId("default", "original");
  try {
    await sync.run();
    f.remove();
    f.sessions.get(sid)!.activeTurn = {
      id: "busy",
      status: "running",
      leaseExpiresAt: Date.now() + 1000,
    };
    const apply = vi.spyOn(f.ports.transport, "apply"),
      cache = vi.fn();
    f.ports.cacheRemote = cache;
    expect((await sync.run()).deferred).toContain(sid);
    expect(apply).not.toHaveBeenCalled();
    expect(cache).not.toHaveBeenCalled();
    f.sessions.get(sid)!.activeTurn = null;
    const prepare = f.ports.deletions!.prepare;
    f.ports.deletions!.prepare = async (...args) => {
      const operation = await prepare(...args);
      f.sessions.get(sid)!.revision++;
      return operation;
    };
    expect((await sync.run()).conflicts).toContain(sid);
    const intent = nativeHistoryDeletions(f.db, "alice", "default")[0];
    expect(intent.baseRevision).not.toBeNull();
    expect(cache).not.toHaveBeenCalled();
    f.ports.deletions!.prepare = prepare;
    const receipt = f.ports.transport.receipt;
    f.ports.transport.receipt = async (...args) => {
      const response = await receipt(...args);
      f.owner("bob");
      return response;
    };
    await expect(sync.run()).rejects.toThrow("account changed");
    expect(nativeHistoryDeletions(f.db, "alice", "default")[0]).toEqual(intent);
    expect(nativeHistoryDeletions(f.db, "bob", "default")).toEqual([]);
    expect(f.executions()).toBe(0);
  } finally {
    f.db.close();
  }
});
// @lat: [[cloud-workspace-tests#Absent deletion targets stay durably suppressed]]
it("keeps absent targets suppressed until delayed cloud creation arrives", async () => {
  const f = deletedSourceFixture(),
    sync = new NativeHistorySync(f.ports),
    sid = nativeCloudSessionId("default", "original");
  try {
    f.remove();
    expect((await sync.run()).deferred).toEqual([]);
    const intent = nativeHistoryDeletions(f.db, "alice", "default")[0];
    expect(intent.baseRevision).toBeNull();
    f.sessions.set(sid, {
      id: sid,
      title: "Delayed",
      model: "mock",
      revision: 1,
      eventSeq: 0,
      deleted: false,
      activeTurn: null,
    });
    expect((await sync.run()).deferred).toEqual([]);
    expect(f.sessions.get(sid)!.deleted).toBe(true);
    expect(nativeHistoryDeletions(f.db, "alice", "default")).toEqual([]);
    expect(f.executions()).toBe(0);
  } finally {
    f.db.close();
  }
});

// @lat: [[cloud-workspace-tests#Original deletion response admission]]
it("refuses spoofed or malformed deletion acknowledgements before consuming native intent", async () => {
  for (const wrong of ["owner", "operation", "revision", "visible"] as const) {
    const f = deletedSourceFixture(),
      sync = new NativeHistorySync(f.ports),
      sid = nativeCloudSessionId("default", "original");
    try {
      await sync.run();
      f.remove();
      const apply = f.ports.transport.apply;
      f.ports.transport.apply = async (...args) => {
        const response = await apply(...args);
        return {
          ...response,
          userId: wrong === "owner" ? "bob" : response.userId,
          operationId:
            wrong === "operation" ? "other-op" : response.operationId,
          session: {
            ...response.session!,
            revision:
              response.session!.revision + (wrong === "revision" ? 1 : 0),
            deleted: wrong === "visible" ? false : response.session!.deleted,
          },
        };
      };
      const ack = vi.spyOn(f.ports.deletions!, "acknowledge"),
        cache = vi.fn();
      f.ports.cacheRemote = cache;
      expect((await sync.run()).deferred).not.toEqual([]);
      expect(ack).not.toHaveBeenCalled();
      expect(cache).not.toHaveBeenCalled();
      expect(nativeHistoryDeletions(f.db, "alice", "default")).toHaveLength(1);
      expect(f.sessions.get(sid)!.deleted).toBe(true);
      f.ports.transport.apply = apply;
      expect((await sync.run()).deferred).toEqual([]);
      expect(nativeHistoryDeletions(f.db, "alice", "default")).toEqual([]);
      expect(f.executions()).toBe(0);
    } finally {
      f.db.close();
    }
  }
});

// @lat: [[cloud-workspace-tests#Other-owner native deletion isolation]]
it("retains another owner's deletion intent while reconstructing only the current owner's cloud sessions", async () => {
  const f = deletedSourceFixture(),
    sync = new NativeHistorySync(f.ports);
  try {
    await sync.run();
    f.remove();
    const intent = nativeHistoryDeletions(f.db, "alice", "default")[0];
    f.owner("bob");
    f.ports.source = async () => {
      throw Error("Native source belongs to another owner");
    };
    const session: ChatSession = {
      id: "bob_session",
      title: "Bob chat",
      model: "mock",
      revision: 1,
      eventSeq: 0,
      deleted: false,
      activeTurn: null,
    };
    f.ports.transport.list = async () => ({
      schemaVersion: 1,
      userId: "bob",
      sessions: [session],
    });
    f.ports.transport.events = async () => ({
      schemaVersion: 1,
      userId: "bob",
      session,
      events: [],
      hasMore: false,
      nextAfter: null,
    });
    const apply = vi.spyOn(f.ports.transport, "apply"),
      cache = vi.fn();
    f.ports.cacheRemote = cache;
    const result = await sync.run();
    expect(result.reconstructed).toBe(1);
    expect(apply).not.toHaveBeenCalled();
    expect(cache).toHaveBeenCalledWith(
      session,
      [],
      expect.objectContaining({ userId: "bob" }),
    );
    expect(nativeHistoryDeletions(f.db, "alice", "default")[0]).toEqual(intent);
  } finally {
    f.db.close();
  }
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Large multi-profile cloud history inventory]]
it("archives the current native source when other cloud profiles exceed one thousand sessions", async () => {
  const f = fixture();
  for (let i = 0; i < 1205; i++)
    f.sessions.set(`other-${i}`, {
      id: `other-${i}`,
      title: "Other retained chat",
      model: "mock",
      revision: 1,
      eventSeq: 0,
      deleted: false,
      activeTurn: null,
    });
  const result = await new NativeHistorySync(f.ports).run();
  expect(result.synced).toBe(f.items.length);
  expect(f.sessions).toHaveProperty("size", 1206);
  expect(f.executions()).toBe(0);
});
