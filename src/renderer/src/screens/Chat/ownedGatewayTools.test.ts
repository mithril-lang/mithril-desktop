// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { DashboardGatewayClient } from "./dashboardGatewayClient";
import {
  callOwnedTool,
  OwnedToolCallError,
} from "@mithril/workspace/owned-gateway-tools";
class Socket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static last: Socket;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  send(frame: string): void {
    this.sent.push(JSON.parse(frame));
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
  constructor() {
    super();
    Socket.last = this;
  }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  result(value: unknown): void {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          id: this.sent.at(-1)!.id,
          result: value,
        }).replace('"nonfinite"', "1e999"),
      }),
    );
  }
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
// @lat: [[owned-tool-calls#Test specifications#Actual client wire]]
it.each([
  "return",
  "replay",
  "lost",
  "late",
  "retired",
  "reconnect",
  "foreign-attempt",
  "bad-state",
  "bad-output",
  "discovery",
  "mutated-input",
  "invalid-args",
])(
  "uses the actual client wire for one owned call without retry: %s",
  async (mode) => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", Socket);
    const client = new DashboardGatewayClient({ requestTimeoutMs: 50 });
    const connected = client.connect("wss://owned.test");
    const socket = Socket.last;
    socket.open();
    await connected;
    let owned = true;
    const args: Record<string, unknown> = {
      path: "owned.txt",
      content: "once",
    };
    if (mode === "invalid-args") args.content = Infinity;
    const call = {
      sessionId: "runtime",
      requestId: "stable-request",
      name: "write_file",
      arguments: args,
      timeoutMs: 1000,
      current: () => owned,
    };
    const promise = callOwnedTool(client, call);
    // Attach observation before deliberately rejecting the transport.
    const observed = promise.then(
      (value) => value,
      (error) => error,
    );
    if (mode === "mutated-input") {
      args.content = "changed";
      call.sessionId = "foreign";
      call.requestId = "other";
    }
    if (mode !== "invalid-args") {
      expect(socket.sent).toEqual([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools.show",
          params: { session_id: "runtime" },
        },
      ]);
      socket.result({
        sections: [],
        discovery_definitions: [
          { function: { name: "write_file", parameters: { type: "object" } } },
        ],
        runtime_snapshot: {
          protocol: "hermes-session-tool-snapshot-v1",
          status: "built",
          coverage: "model-visible-only",
          context_id: "a".repeat(32),
          revision: "b".repeat(64),
          definitions:
            mode === "discovery"
              ? []
              : [
                  {
                    function: {
                      name: "write_file",
                      parameters: { type: "object" },
                    },
                  },
                ],
        },
      });
      await flush();
      // WebCrypto is real asynchronous work, not a microtask-only mock.
      await vi.waitFor(() =>
        expect(socket.sent.length).toBe(mode === "discovery" ? 1 : 2),
      );
      if (mode !== "discovery") {
        expect(socket.sent[1]).toMatchObject({
          method: "tools.call",
          params: {
            session_id: "runtime",
            request_id: "stable-request",
            arguments: { content: "once" },
            timeout_ms: 1000,
          },
        });
        if (mode === "lost") {
          await vi.advanceTimersByTimeAsync(4001);
        } else {
          if (mode === "retired") owned = false;
          if (mode === "late") vi.setSystemTime(Date.now() + 1001);
          if (mode === "reconnect") {
            client.close();
            const next = client.connect("wss://owned.test");
            Socket.last.open();
            await next;
          } else
            socket.result({
              protocol: "hermes-owned-tool-call-v1",
              attempt_id:
                mode === "foreign-attempt"
                  ? "rpc:foreign"
                  : "rpc:stable-request",
              state: mode === "bad-state" ? "running" : "returned",
              terminal: true,
              duplicate: mode === "replay",
              observation:
                mode === "replay" ? "metadata-only" : "handler-return",
              output:
                mode === "replay"
                  ? null
                  : mode === "bad-output"
                    ? { written: "nonfinite" }
                    : { written: true },
            });
        }
      }
    }
    const answer = await observed;
    if (["return", "replay", "mutated-input"].includes(mode))
      expect(answer).toMatchObject({
        attemptId: "rpc:stable-request",
        observation: mode === "replay" ? "metadata-only" : "handler-return",
      });
    else {
      expect(answer).toBeInstanceOf(OwnedToolCallError);
      expect(answer.outcome).toBe(
        ["discovery", "invalid-args"].includes(mode)
          ? "not-dispatched"
          : "unknown",
      );
    }
    expect(
      socket.sent.filter((frame) => frame.method === "tools.call"),
    ).toHaveLength(["discovery", "invalid-args"].includes(mode) ? 0 : 1);
    expect(
      socket.sent.some((frame) =>
        ["session.create", "session.resume", "prompt.submit"].includes(
          String(frame.method),
        ),
      ),
    ).toBe(false);
    client.close();
    expect(vi.getTimerCount()).toBe(0);
  },
);
