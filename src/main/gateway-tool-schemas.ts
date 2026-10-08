import { randomUUID } from "node:crypto";
import { toolSchemaHash } from "@mithril/workspace/tool-readiness";
import type { ChatToolEvent } from "../shared/chat-stream";

type Observation = NonNullable<ChatToolEvent["schemaObservation"]>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid tool schema readback.");
  return value as Record<string, unknown>;
}

/** Ephemeral metadata for one attached gateway turn, with no execution authority. */
export class GatewayToolSchemas {
  private context = randomUUID();
  private definitions = new Map<string, Observation>();
  private calls = new Map<string, { name: string; observation: Observation }>();
  private generation = 0;
  private seen = new Set<string>();
  private closed = false;

  constructor(private readonly now: () => number = Date.now) {}

  async observe(value: unknown): Promise<void> {
    if (this.closed) return;
    const generation = ++this.generation;
    this.definitions.clear();
    this.calls.clear();
    const observedAt = this.now();
    try {
      if (Buffer.byteLength(JSON.stringify(value), "utf8") > 2 * 1024 * 1024)
        throw new Error("Tool schema readback exceeds limit.");
      const result = object(value);
      const snapshot = object(result.runtime_snapshot);
      if (
        snapshot.protocol !== "hermes-session-tool-snapshot-v1" ||
        snapshot.coverage !== "model-visible-only" ||
        !["built", "not-built"].includes(String(snapshot.status))
      )
        throw new Error("Unknown tool schema protocol.");
      const built = snapshot.status === "built";
      if (
        built
          ? typeof snapshot.context_id !== "string" ||
            !/^[a-f0-9]{32}$/.test(snapshot.context_id) ||
            typeof snapshot.revision !== "string" ||
            !/^[a-f0-9]{64}$/.test(snapshot.revision)
          : snapshot.context_id !== null || snapshot.revision !== null
      )
        throw new Error("Invalid tool schema identity.");
      const definitions = new Map<string, Observation>();
      const read = async (
        entries: unknown,
        source: Observation["source"],
      ): Promise<void> => {
        if (
          !Array.isArray(entries) ||
          entries.length > 4096 ||
          (!built && source === "model-visible" && entries.length)
        )
          throw new Error("Invalid tool schema definitions.");
        const names = new Set<string>();
        for (const entry of entries) {
          const fn = object(object(entry).function);
          if (
            typeof fn.name !== "string" ||
            !/^[A-Za-z0-9_-]{1,256}$/.test(fn.name) ||
            names.has(fn.name)
          )
            throw new Error("Invalid tool schema name.");
          names.add(fn.name);
          const schemaHash = await toolSchemaHash(object(fn.parameters));
          definitions.set(fn.name, {
            schemaHash,
            contextId: `${this.context}:${built ? snapshot.context_id : "discovery"}`,
            revision:
              source === "model-visible" ? (snapshot.revision as string) : null,
            source,
            observedAt,
            expiresAt: observedAt + 30_000,
            verified: false,
          });
        }
      };
      await read(result.discovery_definitions, "profile-discovery");
      await read(snapshot.definitions, "model-visible");
      if (
        !this.closed &&
        generation === this.generation &&
        this.now() < observedAt + 30_000
      )
        this.definitions = definitions;
    } catch {
      // Unsupported/old/malformed discovery cannot change legacy execution.
      // It leaves this observer empty, with no fallback schema or authority.
    }
  }

  annotate(event: ChatToolEvent): ChatToolEvent {
    const clean = { ...event };
    delete clean.schemaObservation;
    if (this.closed || !event.hasStableCallId) return clean;
    if (event.status === "running") {
      if (this.seen.has(event.callId)) {
        this.calls.delete(event.callId);
        return clean;
      }
      if (this.seen.size >= 8192) return clean;
      this.seen.add(event.callId);
      const observation = this.definitions.get(event.name);
      if (observation && this.now() < observation.expiresAt)
        this.calls.set(event.callId, { name: event.name, observation });
    }
    const call = this.calls.get(event.callId);
    if (event.status !== "running") this.calls.delete(event.callId);
    if (
      call &&
      call.name === event.name &&
      this.now() < call.observation.expiresAt
    )
      clean.schemaObservation = { ...call.observation };
    return clean;
  }

  close(): void {
    this.closed = true;
    this.invalidate();
  }

  invalidate(): void {
    this.generation++;
    this.context = randomUUID();
    this.definitions.clear();
    this.calls.clear();
    this.seen.clear();
  }
}
