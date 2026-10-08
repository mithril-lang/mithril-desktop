import { expect, it, vi } from "vitest";
import {
  SessionSyncClient,
  type SessionTransport,
} from "@mithril/workspace/session-sync";
import type {
  ChatSession,
  ChatEvent,
  ChatSessionSnapshot,
} from "@mithril/workspace/sessions";
const session = (id: string, revision = 1, eventSeq = 0): ChatSession => ({
  id,
  revision,
  eventSeq,
  title: id,
  model: "model",
  deleted: false,
  activeTurn: null,
});
const event = (seq: number): ChatEvent => ({
  seq,
  type: "assistant",
  turnId: "turn",
  data: { content: `Original ${seq}` },
  createdAt: seq,
});
// @lat: [[cloud-workspace-tests#Packaged session inventory replacement]]
it("replaces the complete shared session cache and preserves original queued edits", async () => {
  let sessions = Array.from({ length: 1205 }, (_, i) => session(`s${i}`, 9, 3));
  const transport: SessionTransport = {
    list: async () => ({
      schemaVersion: 1,
      userId: "alice",
      sessions: structuredClone(sessions),
    }),
    events: async () => {
      throw Error("No checkpoint requested");
    },
    receipt: async () => {
      throw Error("Read must not check write receipts");
    },
    apply: async () => {
      throw Error("Read must not write");
    },
  };
  const client = new SessionSyncClient(transport);
  await client.connect("alice");
  const pending = client.queue("s1", {
    type: "rename",
    data: { title: "Unsent" },
  });
  client.events.set("s1", [event(1), event(2), event(3)]);
  sessions = [session("s1", 1, 1)];
  await client.refresh();
  expect(client.sessions).toEqual(sessions);
  expect(client.events.size).toBe(0);
  expect(client.outbox).toEqual([pending]);
  expect(pending.operation.baseRevision).toBe(9);
  sessions = [];
  await client.refresh();
  expect(client.sessions).toEqual([]);
  expect(client.outbox).toEqual([pending]);
});
// @lat: [[cloud-workspace-tests#Packaged atomic long checkpoint]]
it("preserves the complete cache after a late checkpoint failure then reads over a thousand pages without truncation", async () => {
  const total = 20006;
  let fail = true;
  const transport: SessionTransport = {
    list: async () => ({
      schemaVersion: 1,
      userId: "alice",
      sessions: [session("s1")],
    }),
    events: vi.fn(
      async (_id: string, after = 0): Promise<ChatSessionSnapshot> => {
        if (fail && after >= 17000) throw Error("Late network failure");
        const end = Math.min(total, after + 17);
        return {
          schemaVersion: 1,
          userId: "alice",
          session: session("s1", 2, total),
          events: Array.from({ length: end - after }, (_, i) =>
            event(after + i + 1),
          ),
          hasMore: end < total,
          nextAfter: end < total ? end : null,
        };
      },
    ),
    receipt: async () => {
      throw Error("Read must not check write receipts");
    },
    apply: async () => {
      throw Error("Read must not execute");
    },
  };
  const client = new SessionSyncClient(transport);
  await client.connect("alice");
  await expect(client.checkpoint("s1")).rejects.toThrow("Late network failure");
  expect(client.events.size).toBe(0);
  expect(client.sessions).toEqual([session("s1")]);
  fail = false;
  await client.checkpoint("s1");
  expect(client.events.get("s1")).toHaveLength(total);
  expect(client.events.get("s1")?.at(-1)).toEqual(event(total));
});
// @lat: [[cloud-workspace-tests#Packaged checkpoint boundary fencing]]
it("keeps the previous complete history when session boundaries change between pages", async () => {
  const transport: SessionTransport = {
    list: async () => ({
      schemaVersion: 1,
      userId: "alice",
      sessions: [session("s1", 1, 1)],
    }),
    events: vi.fn(async (): Promise<ChatSessionSnapshot> => {
      throw Error("Unexpected read");
    }),
    receipt: async () => {
      throw Error("Read must not acknowledge writes");
    },
    apply: async () => {
      throw Error("Read must not execute");
    },
  };
  const client = new SessionSyncClient(transport);
  await client.connect("alice");
  client.events.set("s1", [event(1)]);
  const page = (
    revision: number,
    seq: number,
    hasMore: boolean,
  ): ChatSessionSnapshot => ({
    schemaVersion: 1,
    userId: "alice",
    session: session("s1", revision, 3),
    events: [event(seq)],
    hasMore,
    nextAfter: hasMore ? seq : null,
  });
  vi.mocked(transport.events)
    .mockResolvedValueOnce(page(2, 2, true))
    .mockResolvedValueOnce(page(3, 3, false));
  await expect(client.checkpoint("s1")).rejects.toThrow("boundary changed");
  expect(client.events.get("s1")).toEqual([event(1)]);
  vi.mocked(transport.events)
    .mockResolvedValueOnce(page(3, 2, true))
    .mockResolvedValueOnce(page(3, 3, false));
  await client.checkpoint("s1");
  expect(client.events.get("s1")).toEqual([event(1), event(2), event(3)]);
});
// @lat: [[cloud-workspace-tests#Packaged chat restore epoch]]
it("retires equal-identity histories and saved writes after a restore epoch change", async () => {
  let datasetGeneration = 0;
  const transport: SessionTransport = {
    list: async () => ({
      schemaVersion: 1,
      userId: "alice",
      datasetGeneration,
      sessions: [session("s1", 3, 1)],
    }),
    events: async () => {
      throw Error("No checkpoint requested");
    },
    receipt: vi.fn(async () => {
      throw Error("Must not acknowledge across epochs");
    }),
    apply: vi.fn(async () => {
      throw Error("Must not execute across epochs");
    }),
  };
  const client = new SessionSyncClient(transport);
  await client.connect("alice");
  client.events.set("s1", [event(1)]);
  const pending = client.queue("s1", {
    type: "rename",
    data: { title: "Saved edit" },
  });
  datasetGeneration = 1;
  await client.refresh();
  expect(client.events.size).toBe(0);
  expect(client.outbox).toEqual([pending]);
  await expect(client.flush()).rejects.toThrow("review saved operation");
  expect(transport.receipt).not.toHaveBeenCalled();
  expect(transport.apply).not.toHaveBeenCalled();
});
