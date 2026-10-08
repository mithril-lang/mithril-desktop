// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardGatewayClient } from "./dashboardGatewayClient";

// A controllable WebSocket stand-in: it never opens, errors, or closes on its
// own, so each test drives the readyState transition explicitly. This lets us
// exercise the connect handshake — in particular the stalled CONNECTING case
// that wedged the transport before issue #718 added a connect timeout.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | null = null;

  readyState = FakeWebSocket.CONNECTING;
  closeCalls = 0;
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(public url: string) {
    FakeWebSocket.last = this;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (candidate) => candidate !== handler,
    );
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  emit(type: string, event: unknown = {}): void {
    for (const handler of this.listeners[type] ?? []) handler(event);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.last = null;
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardGatewayClient.connect", () => {
  it("rejects and closes the socket when the handshake stalls", async () => {
    const client = new DashboardGatewayClient({ connectTimeoutMs: 1_000 });
    const connecting = client.connect("ws://localhost/api/ws");
    const assertion = expect(connecting).rejects.toThrow(/timed out/i);

    // Socket never fires open/error/close — only the timeout should settle it.
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;

    expect(FakeWebSocket.last?.closeCalls).toBe(1);
    expect(client.connected).toBe(false);
  });

  it("resolves on open and cancels the timeout", async () => {
    const client = new DashboardGatewayClient({ connectTimeoutMs: 1_000 });
    const connecting = client.connect("ws://localhost/api/ws");

    const socket = FakeWebSocket.last;
    if (!socket) throw new Error("socket not created");
    socket.readyState = FakeWebSocket.OPEN;
    socket.emit("open");
    await connecting;

    expect(client.connected).toBe(true);
    // A late timeout firing must not tear down a healthy socket.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(socket.closeCalls).toBe(0);
    expect(client.connected).toBe(true);
  });

  it("rejects when the socket closes before the handshake settles", async () => {
    const client = new DashboardGatewayClient({ connectTimeoutMs: 10_000 });
    const connecting = client.connect("ws://localhost/api/ws");
    const assertion = expect(connecting).rejects.toThrow(/closed/i);

    FakeWebSocket.last?.emit("close", {});
    await assertion;
  });
});

// @lat: [[owned-tool-calls#Test specifications#Peer approval wire]]
it("answers only a captured current approval and retires cancellation without auto-approval", async () => {
  const onEvent = vi.fn();
  const client = new DashboardGatewayClient({ onEvent });
  const opening = client.connect("ws://localhost/api/ws");
  const socket = FakeWebSocket.last!;
  const send = vi.fn();
  Object.assign(socket, { send });
  socket.readyState = FakeWebSocket.OPEN;
  socket.emit("open");
  await opening;
  const receive = (frame: unknown): void =>
    socket.emit("message", { data: JSON.stringify(frame) });
  receive({ method: "event", params: { type: "gateway.ready", payload: {} } });
  const capability = JSON.parse(send.mock.calls[0][0]);
  expect(capability).toMatchObject({
    method: "client.capabilities",
    params: { server_requests: true },
  });
  receive({ id: capability.id, result: {} });
  const request = {
    id: "srq-0123456789ab",
    method: "approval",
    params: {
      session_id: "owned",
      request_id: "queue-one",
      command: "owned test operation",
      choices: ["once", "deny"],
    },
  };
  receive(request);
  expect(send).toHaveBeenCalledTimes(1);
  expect(onEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "approval.request",
      session_id: "owned",
      payload: expect.objectContaining({ server_request_id: request.id }),
    }),
  );
  expect(client.answerApproval(request.id, "foreign", "once")).toBe(false);
  expect(client.answerApproval(request.id, "owned", "always")).toBe(false);
  expect(client.answerApproval(request.id, "owned", "once")).toBe(true);
  expect(JSON.parse(send.mock.calls[1][0])).toEqual({
    jsonrpc: "2.0",
    id: request.id,
    result: { choice: "once" },
  });
  expect(client.answerApproval(request.id, "owned", "once")).toBe(false);
  receive({ ...request, id: "srq-abcdef012345" });
  receive({
    method: "event",
    params: {
      type: "request.cancel",
      payload: {
        id: "srq-abcdef012345",
        method: "approval",
        reason: "timeout",
      },
    },
  });
  expect(onEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "approval.cancel", session_id: "owned" }),
  );
  expect(client.answerApproval("srq-abcdef012345", "owned", "once")).toBe(
    false,
  );
  receive({
    id: "srq-abcdef678901",
    method: "secret",
    params: { session_id: "owned" },
  });
  expect(JSON.parse(send.mock.calls.at(-1)![0])).toMatchObject({
    error: { code: -32601 },
  });
  receive({ ...request, id: "srq-abcdef012347" });
  send.mockImplementationOnce(() => {
    throw Error("lost choice send");
  });
  expect(client.answerApproval("srq-abcdef012347", "owned", "once")).toBe(
    false,
  );
  expect(client.answerApproval("srq-abcdef012347", "owned", "once")).toBe(
    false,
  );
  receive({ ...request, id: "srq-abcdef012346" });
  client.close();
  expect(client.answerApproval("srq-abcdef012346", "owned", "once")).toBe(
    false,
  );
  expect(vi.getTimerCount()).toBe(0);
});

// @lat: [[owned-tool-calls#Test specifications#Retired socket cannot affect current peer]]
it("ignores retired socket messages and close while the new socket has an outstanding request", async () => {
  const onEvent = vi.fn(),
    onClose = vi.fn();
  const client = new DashboardGatewayClient({ onEvent, onClose });
  const first = client.connect("ws://localhost/first");
  const old = FakeWebSocket.last!;
  Object.assign(old, { send: vi.fn() });
  old.readyState = FakeWebSocket.OPEN;
  old.emit("open");
  await first;
  const second = client.connect("ws://localhost/second");
  const current = FakeWebSocket.last!;
  const send = vi.fn();
  Object.assign(current, { send });
  current.readyState = FakeWebSocket.OPEN;
  current.emit("open");
  await second;
  const pending = client.request("tools.show", { session_id: "owned" });
  old.emit("message", {
    data: JSON.stringify({
      method: "event",
      params: { type: "session.info", payload: {} },
    }),
  });
  old.emit("close");
  expect(onEvent).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  const id = JSON.parse(send.mock.calls[0][0]).id;
  current.emit("message", {
    data: JSON.stringify({ id, result: { current: true } }),
  });
  expect(await pending).toEqual({ current: true });
  client.close();
  expect(vi.getTimerCount()).toBe(0);
});

// @lat: [[owned-tool-calls#Test specifications#Shared approval retirement]]
it("uses compiled shared approval custody to retire repeated and conflicting peer IDs", async () => {
  const onEvent = vi.fn();
  const client = new DashboardGatewayClient({ onEvent });
  const opening = client.connect("ws://localhost/api/ws");
  const socket = FakeWebSocket.last!;
  const send = vi.fn();
  Object.assign(socket, { send });
  socket.readyState = FakeWebSocket.OPEN;
  socket.emit("open");
  await opening;
  const request = {
    id: "srq-000000000001",
    method: "approval",
    params: {
      session_id: "owned",
      request_id: "queue",
      command: "first",
      choices: ["once", "deny"],
    },
  };
  const receive = (value: unknown): void =>
    socket.emit("message", { data: JSON.stringify(value) });
  receive(request);
  receive(request);
  expect(onEvent).toHaveBeenCalledTimes(1);
  receive({ ...request, params: { ...request.params, command: "changed" } });
  expect(onEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "approval.cancel", session_id: "owned" }),
  );
  expect(client.answerApproval(request.id, "owned", "once")).toBe(false);
  receive(request);
  expect(JSON.parse(send.mock.calls.at(-1)![0])).toMatchObject({
    error: { code: -32602 },
  });
  expect(onEvent).toHaveBeenCalledTimes(2);
  client.close();
  expect(vi.getTimerCount()).toBe(0);
});
