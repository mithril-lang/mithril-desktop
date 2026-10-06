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
} {
  const sessions = new Map<string, ChatSession>(),
    events = new Map<string, ChatEvent[]>(),
    receipts = new Map<string, ChatOperationResponse>();
  let state: NativeHistoryJournal = { entries: {} },
    userId = "alice",
    lost = false,
    executions = 0;
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
        title: "Original chat",
        model: "mock",
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
        if (!["create", "history"].includes(operation.type)) {
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
            old?.title ??
            (operation.type === "create" ? operation.data.title : ""),
          model: "mock",
          revision: accepted ? (old?.revision ?? 0) + 1 : old!.revision,
          eventSeq: old?.eventSeq ?? 0,
          deleted: false,
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
        if (accepted) sessions.set(id, session);
        const receipt: ChatOperationResponse = {
          schemaVersion: 1,
          userId,
          operationId: operation.operationId,
          status: accepted ? "accepted" : "conflict",
          session,
        };
        receipts.set(operation.operationId, receipt);
        if (lost && operation.type === "history") {
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
