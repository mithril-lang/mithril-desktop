import { expect, it, vi } from "vitest";
import type { OwnedToolClient } from "@mithril/workspace/owned-gateway-tools";
import { callDashboardOwnedTool } from "./dashboardOwnedTools";

// @lat: [[provider-memory-target#Provider memory targets#Provider database admission]]
it.each([
  "same",
  "database",
  "provider",
  "action",
  "fact",
  "external",
  "local",
  "schema",
  "malformed",
])(
  "binds the compiled SDK consumer to the reviewed provider target: %s",
  async (change) => {
    const expected = {
      coverage: "partial" as const,
      digest: "c".repeat(64),
      target: {
        namespace: "selected-provider-memory" as const,
        provider: "holographic",
        database: "/owned/facts.db",
        action: "update",
        fact_id: 7,
        revision: { external: 2, local: 3, schema: 8 },
      },
    };
    const target = structuredClone(expected);
    const changes: Record<string, () => void> = {
      database: () => {
        target.target.database = "/foreign/facts.db";
      },
      provider: () => {
        target.target.provider = "other";
      },
      action: () => {
        target.target.action = "remove";
      },
      fact: () => {
        target.target.fact_id++;
      },
      external: () => {
        target.target.revision.external++;
      },
      local: () => {
        target.target.revision.local++;
      },
      schema: () => {
        target.target.revision.schema++;
      },
      malformed: () => {
        Object.assign(target.target.revision, { extra: true });
      },
    };
    changes[change]?.();
    const request = vi.fn(
      async (method: string, params?: Record<string, unknown>) => {
        if (method === "tools.show")
          return {
            runtime_snapshot: {
              protocol: "hermes-session-tool-snapshot-v1",
              status: "built",
              coverage: "model-visible-only",
              context_id: "a".repeat(32),
              revision: "b".repeat(64),
              definitions: [
                { function: { name: "fact_store", parameters: {} } },
              ],
            },
          };
        if (method === "tools.target_preview")
          return {
            protocol: "hermes-owned-target-preview-v1",
            target_binding: target,
          };
        expect(params?.target_digest).toBe(expected.digest);
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
        name: "fact_store",
        arguments: { action: "update", fact_id: 7, content: "reviewed" },
        timeoutMs: 1000,
        targetBinding: expected,
        current: () => true,
      },
    );
    if (change === "same")
      await expect(run).resolves.toMatchObject({ output: true });
    else await expect(run).rejects.toMatchObject({ outcome: "not-dispatched" });
    expect(
      request.mock.calls.filter(([method]) => method === "tools.call"),
    ).toHaveLength(change === "same" ? 1 : 0);
  },
);
