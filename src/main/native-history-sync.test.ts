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
