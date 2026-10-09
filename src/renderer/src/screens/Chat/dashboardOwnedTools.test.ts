import { expect, it, vi } from "vitest";
import type { OwnedToolClient } from "@mithril/workspace/owned-gateway-tools";
import { callDashboardOwnedTool } from "./dashboardOwnedTools";

// @lat: [[owned-tool-calls#Test specifications#Memory store and mirror admission]]
it.each([
  "same",
  "same-user",
  "owner",
  "session",
  "store",
  "store-path",
  "mirror-name",
  "mirror-identity",
  "mirror-missing",
  "extra",
])(
  "admits only the reviewed memory store and mirror identity: %s",
  async (change) => {
    const expected = {
      coverage: "partial" as const,
      digest: "c".repeat(64),
      target: {
        namespace: "selected-session-memory" as const,
        sessionId: "same-durable-owner",
        store: (change === "same-user" ? "user" : "memory") as
          | "memory"
          | "user",
        storeDigest: "f".repeat(64),
        mirrors: [{ name: "local mirror", identityDigest: "a".repeat(64) }],
        ownerDigest: "d".repeat(64),
      },
    };
    const target = structuredClone(expected);
    if (change === "owner") target.target.ownerDigest = "e".repeat(64);
    if (change === "session") target.target.sessionId = "foreign-session";
    if (change === "store") target.target.store = "user";
    if (change === "store-path") target.target.storeDigest = "e".repeat(64);
    if (change === "mirror-name") target.target.mirrors[0]!.name = "foreign";
    if (change === "mirror-identity")
      target.target.mirrors[0]!.identityDigest = "e".repeat(64);
    if (change === "mirror-missing") target.target.mirrors = [];
    if (change === "extra")
      Object.assign(target.target, { path: "/ambiguous" });
    const request = vi.fn(
      async (method: string, _params?: Record<string, unknown>) => {
        if (method === "tools.show")
          return {
            runtime_snapshot: {
              protocol: "hermes-session-tool-snapshot-v1",
              status: "built",
              coverage: "model-visible-only",
              context_id: "a".repeat(32),
              revision: "b".repeat(64),
              definitions: [{ function: { name: "memory", parameters: {} } }],
            },
          };
        if (method === "tools.target_preview")
          return {
            protocol: "hermes-owned-target-preview-v1",
            target_binding: target,
          };
        return {
          protocol: "hermes-owned-tool-call-v1",
          attempt_id: "rpc:once",
          state: "returned",
          terminal: true,
          duplicate: false,
          observation: "handler-return",
          output: true,
        };
      },
    );
    const run = callDashboardOwnedTool(
      {
        connected: true,
        connectionEpoch: 1,
        request,
      } as unknown as OwnedToolClient,
      {
        sessionId: "runtime",
        requestId: "once",
        name: "memory",
        arguments: {
          target: expected.target.store,
          action: "add",
          content: "reviewed",
        },
        timeoutMs: 1000,
        targetBinding: expected,
        current: () => true,
      },
    );
    if (change === "same" || change === "same-user") {
      await expect(run).resolves.toMatchObject({ output: true });
      expect(
        request.mock.calls.filter(([method]) => method === "tools.call"),
      ).toHaveLength(1);
      expect(request.mock.calls.at(-1)?.[1]).toMatchObject({
        target_digest: expected.digest,
      });
    } else {
      await expect(run).rejects.toMatchObject({ outcome: "not-dispatched" });
      expect(
        request.mock.calls.some(([method]) => method === "tools.call"),
      ).toBe(false);
    }
  },
);

// @lat: [[owned-tool-calls#Test specifications#Session store target admission]]
it.each(["same", "owner", "session", "extra"])(
  "admits only the reviewed session store identity: %s",
  async (change) => {
    const expected = {
      coverage: "partial" as const,
      digest: "c".repeat(64),
      target: {
        namespace: "selected-session-store" as const,
        sessionId: "same-durable-owner",
        store: "todo-list" as const,
        ownerDigest: "d".repeat(64),
      },
    };
    const target = structuredClone(expected);
    if (change === "owner") target.target.ownerDigest = "e".repeat(64);
    if (change === "session") target.target.sessionId = "foreign-session";
    if (change === "extra")
      Object.assign(target.target, { path: "/ambiguous" });
    const request = vi.fn(
      async (method: string, _params?: Record<string, unknown>) => {
        if (method === "tools.show")
          return {
            runtime_snapshot: {
              protocol: "hermes-session-tool-snapshot-v1",
              status: "built",
              coverage: "model-visible-only",
              context_id: "a".repeat(32),
              revision: "b".repeat(64),
              definitions: [
                { function: { name: "todo_list", parameters: {} } },
              ],
            },
          };
        if (method === "tools.target_preview")
          return {
            protocol: "hermes-owned-target-preview-v1",
            target_binding: target,
          };
        return {
          protocol: "hermes-owned-tool-call-v1",
          attempt_id: "rpc:once",
          state: "returned",
          terminal: true,
          duplicate: false,
          observation: "handler-return",
          output: true,
        };
      },
    );
    const run = callDashboardOwnedTool(
      {
        connected: true,
        connectionEpoch: 1,
        request,
      } as unknown as OwnedToolClient,
      {
        sessionId: "runtime",
        requestId: "once",
        name: "todo_list",
        arguments: { todos: [] },
        timeoutMs: 1000,
        targetBinding: expected,
        current: () => true,
      },
    );
    if (change === "same") {
      await expect(run).resolves.toMatchObject({ output: true });
      expect(
        request.mock.calls.filter(([method]) => method === "tools.call"),
      ).toHaveLength(1);
      expect(request.mock.calls.at(-1)?.[1]).toMatchObject({
        target_digest: expected.digest,
      });
    } else {
      await expect(run).rejects.toMatchObject({ outcome: "not-dispatched" });
      expect(
        request.mock.calls.some(([method]) => method === "tools.call"),
      ).toBe(false);
    }
  },
);

// @lat: [[owned-tool-calls#Test specifications#Multi-file target admission]]
it.each(["same", "later-path", "resolution", "missing"])(
  "admits only the entire reviewed multi-file target identity: %s",
  async (change) => {
    const expected = {
      coverage: "partial" as const,
      digest: "c".repeat(64),
      target: {
        namespace: "selected-local-terminal" as const,
        paths: [
          { path: "/owned/update.txt", resolution: "content" as const },
          { path: "/owned/move-to.txt", resolution: "entry" as const },
        ],
      },
    };
    const target = structuredClone(expected);
    if (change === "later-path")
      target.target.paths[1]!.path = "/foreign/changed";
    if (change === "resolution")
      target.target.paths[1] = {
        path: "/owned/move-to.txt",
        resolution: "content",
      };
    if (change === "missing") target.target.paths.pop();
    const request = vi.fn(
      async (method: string, _params?: Record<string, unknown>) => {
        if (method === "tools.show")
          return {
            runtime_snapshot: {
              protocol: "hermes-session-tool-snapshot-v1",
              status: "built",
              coverage: "model-visible-only",
              context_id: "a".repeat(32),
              revision: "b".repeat(64),
              definitions: [{ function: { name: "patch", parameters: {} } }],
            },
          };
        if (method === "tools.target_preview")
          return {
            protocol: "hermes-owned-target-preview-v1",
            target_binding: target,
          };
        return {
          protocol: "hermes-owned-tool-call-v1",
          attempt_id: "rpc:once",
          state: "returned",
          terminal: true,
          duplicate: false,
          observation: "handler-return",
          output: true,
        };
      },
    );
    const run = callDashboardOwnedTool(
      {
        connected: true,
        connectionEpoch: 1,
        request,
      } as unknown as OwnedToolClient,
      {
        sessionId: "runtime",
        requestId: "once",
        name: "patch",
        arguments: { mode: "patch", patch: "fixture" },
        timeoutMs: 1000,
        targetBinding: expected,
        current: () => true,
      },
    );
    if (change === "same") {
      await expect(run).resolves.toMatchObject({ output: true });
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        "tools.show",
        "tools.target_preview",
        "tools.show",
        "tools.call",
      ]);
      expect(request.mock.calls.at(-1)?.[1]).toMatchObject({
        target_digest: expected.digest,
      });
    } else {
      await expect(run).rejects.toMatchObject({ outcome: "not-dispatched" });
      expect(request.mock.calls.map(([method]) => method)).toEqual([
        "tools.show",
        "tools.target_preview",
      ]);
    }
  },
);
