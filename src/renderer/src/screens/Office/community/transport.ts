import { parseFrame } from "./protocol";
import type {
  CommunityFrame,
  CommunityTransport,
  ConnectionState,
} from "./types";

const CHANNEL_NAME = "mithril-office-community";
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

function emitter<T>(): {
  on(h: (v: T) => void): () => void;
  emit(v: T): void;
} {
  const handlers = new Set<(v: T) => void>();
  return {
    on(h) {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    emit(v) {
      handlers.forEach((h) => h(v));
    },
  };
}

/**
 * Same-device transport: BroadcastChannel between windows of this app. Used
 * when no relay URL is configured, so the space still works (and is testable)
 * without a server; it just only contains people on this machine.
 */
export function createLocalTransport(): CommunityTransport {
  const frames = emitter<CommunityFrame>();
  const state = emitter<ConnectionState>();
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(CHANNEL_NAME);
  if (channel) {
    channel.onmessage = (e: MessageEvent): void => {
      const frame = parseFrame(e.data);
      if (frame) frames.emit(frame);
    };
  }
  // Emit "online" once handlers can attach.
  queueMicrotask(() => state.emit(channel ? "online" : "offline"));
  return {
    send: (frame) => channel?.postMessage(frame),
    onFrame: frames.on,
    onState: state.on,
    close: () => channel?.close(),
  };
}

/** Relay transport: JSON frames over a WebSocket, reconnecting with backoff. */
export function createWebSocketTransport(url: string): CommunityTransport {
  const frames = emitter<CommunityFrame>();
  const state = emitter<ConnectionState>();
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = (): void => {
    if (closed) return;
    state.emit("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      state.emit("offline");
      schedule();
      return;
    }
    socket = ws;
    ws.onopen = (): void => {
      attempt = 0;
      state.emit("online");
    };
    ws.onmessage = (e: MessageEvent): void => {
      if (typeof e.data !== "string" || e.data.length > 8_192) return;
      try {
        const frame = parseFrame(JSON.parse(e.data));
        if (frame) frames.emit(frame);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = (): void => {
      if (socket === ws) socket = null;
      state.emit("offline");
      schedule();
    };
    ws.onerror = (): void => ws.close();
  };

  const schedule = (): void => {
    if (closed || timer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt++);
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, delay);
  };

  connect();

  return {
    send(frame) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(frame));
      }
    },
    onFrame: frames.on,
    onState: state.on,
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    },
  };
}

export function createCommunityTransport(
  relayUrl: string | null,
): CommunityTransport {
  return relayUrl ? createWebSocketTransport(relayUrl) : createLocalTransport();
}
