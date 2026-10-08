import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { toolSchemaHash } from "@mithril/workspace/tool-readiness";
import { GatewayToolSchemas } from "./gateway-tool-schemas";
import type { ChatToolEvent } from "../shared/chat-stream";

vi.stubGlobal("crypto", webcrypto);

const parameters = {
  type: "object",
  properties: { path: { type: "string" } },
  required: ["path"],
};
const definition = (
  schema = parameters,
): {
  type: string;
  function: { name: string; parameters: typeof parameters };
} => ({
  type: "function",
  function: { name: "mcp_example_read", parameters: schema },
});
const fixture = {
  discovery_definitions: [definition()],
  runtime_snapshot: {
    protocol: "hermes-session-tool-snapshot-v1",
    coverage: "model-visible-only",
    status: "built",
    context_id: "a".repeat(32),
    revision: "b".repeat(64),
    definitions: [definition()],
  },
};
const readback = (): typeof fixture => structuredClone(fixture);
const event = (
  callId: string,
  status: ChatToolEvent["status"] = "running",
): ChatToolEvent => ({
  callId,
  name: "mcp_example_read",
  status,
  hasStableCallId: true,
});

describe("attached turn tool schema observations", () => {
  // @lat: [[gateway-tool-schemas#Test specifications#Owned call correlation]]
  it("hashes actual schemas and correlates only starts from the same live observer", async () => {
    const a = new GatewayToolSchemas(() => 100),
      b = new GatewayToolSchemas(() => 100);
    await Promise.all([a.observe(readback()), b.observe(readback())]);
    const start = a.annotate(event("one")).schemaObservation!;
    expect(start.schemaHash).toBe(await toolSchemaHash(parameters));
    expect(start.source).toBe("model-visible");
    expect(start.verified).toBe(false);
    expect(
      b.annotate(event("one", "completed")).schemaObservation,
    ).toBeUndefined();
    expect(b.annotate(event("two")).schemaObservation?.contextId).not.toBe(
      start.contextId,
    );
    expect(a.annotate(event("one", "completed")).schemaObservation).toEqual(
      start,
    );
    expect(
      a.annotate(event("one", "completed")).schemaObservation,
    ).toBeUndefined();
    expect(
      a.annotate({ ...event("unstable"), hasStableCallId: false })
        .schemaObservation,
    ).toBeUndefined();
    a.annotate(event("duplicate"));
    expect(a.annotate(event("duplicate")).schemaObservation).toBeUndefined();
    expect(a.annotate(event("duplicate")).schemaObservation).toBeUndefined();
    expect(
      a.annotate(event("duplicate", "completed")).schemaObservation,
    ).toBeUndefined();
    a.annotate(event("mismatch"));
    expect(
      a.annotate({ ...event("mismatch", "completed"), name: "another_tool" })
        .schemaObservation,
    ).toBeUndefined();
    const changed = readback();
    changed.runtime_snapshot.definitions = [
      definition({ ...parameters, required: [] }),
    ];
    await a.observe(changed);
    expect(a.annotate(event("changed")).schemaObservation?.schemaHash).not.toBe(
      start.schemaHash,
    );
    a.invalidate();
    expect(
      a.annotate(event("changed", "completed")).schemaObservation,
    ).toBeUndefined();
  });

  // @lat: [[gateway-tool-schemas#Test specifications#Unknown and expired schemas]]
  it("keeps legacy, malformed, expired and retired observations unknown without granting tools", async () => {
    let now = 100;
    const a = new GatewayToolSchemas(() => now);
    const candidate = readback();
    await a.observe({
      ...candidate,
      runtime_snapshot: {
        ...candidate.runtime_snapshot,
        status: "not-built",
        context_id: null,
        revision: null,
        definitions: [],
      },
    });
    expect(a.annotate(event("candidate")).schemaObservation).toMatchObject({
      source: "profile-discovery",
      revision: null,
      verified: false,
    });
    await a.observe({ sections: [], total: 0 });
    expect(
      a.annotate(event("candidate", "completed")).schemaObservation,
    ).toBeUndefined();
    expect(a.annotate(event("legacy")).schemaObservation).toBeUndefined();
    const bad = readback();
    bad.runtime_snapshot.definitions.push(definition());
    await a.observe(bad);
    expect(a.annotate(event("bad")).schemaObservation).toBeUndefined();
    await a.observe(readback());
    a.annotate(event("expired"));
    now += 30_000;
    expect(
      a.annotate(event("expired", "completed")).schemaObservation,
    ).toBeUndefined();
    const pending = a.observe(readback());
    a.invalidate();
    await pending;
    expect(a.annotate(event("late")).schemaObservation).toBeUndefined();
    const closing = a.observe(readback());
    a.close();
    await closing;
    await a.observe(readback());
    expect(a.annotate(event("closed")).schemaObservation).toBeUndefined();
  });
});
