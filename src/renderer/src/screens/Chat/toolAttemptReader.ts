/** Metadata observation on an already attached transport; never admission or retry. */
const states = [
  "pending",
  "running",
  "blocked",
  "rejected",
  "not-dispatched",
  "returned",
  "returned-error",
] as const;
export interface ToolAttempt {
  attempt_id: string;
  tool_name: string;
  state: (typeof states)[number];
  terminal: boolean;
}
export interface ToolAttemptPage {
  available: boolean;
  attempts: ToolAttempt[];
  next_cursor: string | null;
}
export interface AttemptClient {
  connected: boolean;
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}
export interface AttemptAuthority {
  client: AttemptClient;
  sessionId: string;
  generation: number;
}
export interface AttemptObservation {
  status: "idle" | "reading" | "unknown" | "ready";
  page: ToolAttemptPage | null;
}
const cursor = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 512 &&
  /^(?:rpc:)?[A-Za-z0-9_-]+$/.test(v);

export function parseToolAttemptPage(raw: unknown): ToolAttemptPage {
  if (
    !raw ||
    typeof raw !== "object" ||
    new TextEncoder().encode(JSON.stringify(raw)).length > 2_000_000
  )
    throw new Error("Invalid attempt metadata");
  const p = raw as Record<string, unknown>;
  if (
    p.protocol !== "hermes-tool-attempts-v1" ||
    p.coverage !== "exact-session-metadata-only" ||
    typeof p.available !== "boolean" ||
    !Array.isArray(p.attempts) ||
    p.attempts.length > 100 ||
    (p.next_cursor !== null && !cursor(p.next_cursor))
  )
    throw new Error("Invalid attempt metadata");
  const ids = new Set<string>();
  const attempts = p.attempts.map((value): ToolAttempt => {
    if (!value || typeof value !== "object") throw new Error("Invalid attempt");
    const row = value as ToolAttempt & { parent_call_id?: unknown };
    if (
      !cursor(row.attempt_id) ||
      typeof row.parent_call_id !== "string" ||
      !row.parent_call_id.length ||
      row.parent_call_id.length > 512 ||
      typeof row.tool_name !== "string" ||
      !row.tool_name.length ||
      row.tool_name.length > 512 ||
      !states.includes(row.state) ||
      typeof row.terminal !== "boolean" ||
      row.terminal !== !["pending", "running"].includes(row.state) ||
      ids.has(row.attempt_id)
    )
      throw new Error("Invalid attempt");
    ids.add(row.attempt_id);
    return {
      attempt_id: row.attempt_id,
      tool_name: row.tool_name,
      state: row.state,
      terminal: row.terminal,
    };
  });
  if (
    (!p.available && (attempts.length || p.next_cursor !== null)) ||
    (p.next_cursor !== null && !attempts.length)
  )
    throw new Error("Invalid attempt metadata");
  return {
    available: p.available,
    attempts,
    next_cursor: p.next_cursor as string | null,
  };
}

export class ToolAttemptReader {
  private epoch = 0;
  private value: AttemptObservation = { status: "idle", page: null };
  private listeners = new Set<() => void>();
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  constructor(private authority: () => AttemptAuthority | null) {}
  snapshot = (): AttemptObservation => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(
    status: AttemptObservation["status"],
    page: ToolAttemptPage | null = null,
  ): void {
    this.value = { status, page };
    this.listeners.forEach((listener) => listener());
  }
  invalidate = (): void => {
    this.epoch++;
    clearTimeout(this.deadline);
    clearTimeout(this.expiry);
    this.publish("unknown");
  };
  read = async (before?: string): Promise<void> => {
    if (this.value.status === "reading") return;
    const owner = this.authority();
    if (
      !owner ||
      !owner.client.connected ||
      (before !== undefined &&
        (!cursor(before) || before !== this.value.page?.next_cursor))
    ) {
      this.invalidate();
      return;
    }
    this.invalidate();
    const epoch = this.epoch;
    const current = (): boolean => {
      const next = this.authority();
      return (
        epoch === this.epoch &&
        !!next &&
        next.client === owner.client &&
        next.client.connected &&
        next.sessionId === owner.sessionId &&
        next.generation === owner.generation
      );
    };
    this.publish("reading");
    this.deadline = setTimeout(() => {
      if (epoch === this.epoch) this.invalidate();
    }, 3_000);
    try {
      const raw = await owner.client.request("tools.attempts", {
        session_id: owner.sessionId,
        limit: 50,
        ...(before ? { before_attempt_id: before } : {}),
      });
      if (!current()) {
        if (epoch === this.epoch) this.invalidate();
        return;
      }
      const page = parseToolAttemptPage(raw);
      clearTimeout(this.deadline);
      this.publish(
        page.available ? "ready" : "unknown",
        page.available ? page : null,
      );
      if (page.available)
        this.expiry = setTimeout(() => this.invalidate(), 30_000);
    } catch {
      if (epoch === this.epoch) this.invalidate();
    }
  };
}
