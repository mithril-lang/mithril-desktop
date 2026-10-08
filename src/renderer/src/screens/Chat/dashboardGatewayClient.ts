export interface DashboardRpcEvent<T = unknown> {
  payload?: T;
  session_id?: string;
  type: string;
}

export interface DashboardGatewayClientOptions {
  /** How long `connect()` waits for the WebSocket handshake before giving up.
   *  Without this, a socket stuck in CONNECTING (TCP accepted but the upgrade
   *  never completes — e.g. when the renderer is starved) leaves the connect
   *  promise pending forever, wedging the whole transport with no error and no
   *  fallback (issue #718). */
  connectTimeoutMs?: number;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onEvent?: (event: DashboardRpcEvent) => void;
  requestTimeoutMs?: number;
}

interface JsonRpcResponse<T = unknown> {
  error?: { code?: number; message?: string } | string;
  id: number | string;
  jsonrpc?: "2.0";
  result?: T;
}

interface JsonRpcNotification {
  method?: string;
  params?: unknown;
  type?: string;
  payload?: unknown;
  session_id?: string;
}

interface PendingRequest<T = unknown> {
  reject: (reason: Error) => void;
  resolve: (value: T) => void;
  timeout: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeDashboardNotification(
  value: unknown,
): DashboardRpcEvent | null {
  if (!isRecord(value)) return null;

  const notification = value as JsonRpcNotification;
  if (typeof notification.type === "string") {
    return {
      type: notification.type,
      payload: notification.payload,
      session_id:
        typeof notification.session_id === "string"
          ? notification.session_id
          : undefined,
    };
  }

  if (
    notification.method === "event" &&
    isRecord(notification.params) &&
    typeof notification.params.type === "string"
  ) {
    return {
      type: notification.params.type,
      payload: notification.params.payload,
      session_id:
        typeof notification.params.session_id === "string"
          ? notification.params.session_id
          : undefined,
    };
  }

  if (typeof notification.method === "string") {
    const params = isRecord(notification.params) ? notification.params : {};
    return {
      type: notification.method,
      payload: params.payload,
      session_id:
        typeof params.session_id === "string" ? params.session_id : undefined,
    };
  }

  return null;
}

export class DashboardGatewayClient {
  private nextRequestId = 1;
  private epoch = 0;
  private pending = new Map<number | string, PendingRequest>();
  private socket: WebSocket | null = null;
  private capabilitySent = false;
  private approvals = new Map<
    string,
    { sessionId: string; requestId: string; choices: Set<string> }
  >();
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(private readonly options: DashboardGatewayClientOptions = {}) {
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  get connectionEpoch(): number {
    return this.epoch;
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(wsUrl: string): Promise<void> {
    this.close();

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      this.socket = socket;
      let settled = false;

      // Bound the handshake: a socket stuck in CONNECTING fires neither `open`
      // nor `error`, so without this timer the promise would never settle and
      // the transport would wedge forever (issue #718). On timeout we reject and
      // close the half-open socket so `ensureClient` can fall back to legacy.
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (this.socket === socket) this.socket = null;
        try {
          socket.close();
        } catch {
          // Best-effort teardown of the stalled socket.
        }
        reject(new Error("Hermes dashboard WebSocket connection timed out"));
      }, this.connectTimeoutMs);

      const failOpen = (event: Event): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        const current = this.socket === socket;
        if (current) this.socket = null;
        reject(new Error(`Could not connect to Hermes dashboard WebSocket`));
        if (current) this.options.onError?.(event);
      };

      socket.addEventListener(
        "open",
        () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          socket.removeEventListener("error", failOpen);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener("error", failOpen, { once: true });
      socket.addEventListener("message", (event) => {
        if (this.socket === socket) this.handleMessage(event);
      });
      socket.addEventListener("close", (event) => {
        const current = this.socket === socket;
        if (current) this.socket = null;
        // A close before the handshake settles must still reject the connect
        // promise — otherwise a CONNECTING→CLOSED transition with no `error`
        // event would hang it until the timeout fires.
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error("Hermes dashboard WebSocket closed"));
        }
        if (!current) return;
        this.approvals.clear();
        this.rejectPending("Hermes dashboard WebSocket closed");
        this.options.onClose?.(event);
      });
    });
  }

  request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error("Hermes dashboard WebSocket is not connected"),
      );
    }

    const id = this.nextRequestId++;
    const message = { jsonrpc: "2.0", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Hermes dashboard request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timeout,
      });
      socket.send(JSON.stringify(message));
    });
  }

  close(): void {
    this.epoch++;
    this.capabilitySent = false;
    this.approvals.clear();
    const socket = this.socket;
    this.socket = null;
    this.rejectPending("Hermes dashboard WebSocket closed");
    if (
      socket &&
      (socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN)
    ) {
      socket.close();
    }
  }

  private handleMessage(event: MessageEvent): void {
    let message: unknown;
    try {
      message =
        typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }

    if (isRecord(message) && "id" in message && !("method" in message)) {
      this.resolveResponse(message as unknown as JsonRpcResponse);
      return;
    }

    if (
      isRecord(message) &&
      typeof message.id === "string" &&
      /^srq-[a-f0-9]{12}$/.test(message.id) &&
      typeof message.method === "string"
    ) {
      const params = isRecord(message.params) ? message.params : {};
      if (message.method !== "approval" || !this.options.onEvent) {
        this.socket?.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Unsupported client request" },
          }),
        );
        return;
      }
      if (
        typeof params.session_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(params.session_id) ||
        typeof params.request_id !== "string" ||
        !params.request_id.trim() ||
        params.request_id.length > 256 ||
        !Array.isArray(params.choices) ||
        !params.choices.length ||
        params.choices.length > 4 ||
        params.choices.some(
          (choice) =>
            !["once", "session", "always", "deny"].includes(String(choice)),
        ) ||
        new Set(params.choices).size !== params.choices.length ||
        new TextEncoder().encode(JSON.stringify(message)).length > 128000 ||
        this.approvals.size >= 32
      ) {
        this.socket?.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32602, message: "Invalid approval request" },
          }),
        );
        return;
      }
      if (this.approvals.has(message.id)) return;
      this.approvals.set(message.id, {
        sessionId: params.session_id,
        requestId: params.request_id,
        choices: new Set(params.choices as string[]),
      });
      this.options.onEvent({
        type: "approval.request",
        session_id: params.session_id,
        payload: { ...params, server_request_id: message.id },
      });
      return;
    }
    const normalized = normalizeDashboardNotification(message);
    if (
      normalized?.type === "gateway.ready" &&
      !this.capabilitySent &&
      this.options.onEvent
    ) {
      this.capabilitySent = true;
      void this.request("client.capabilities", { server_requests: true }).catch(
        () => undefined,
      );
    }
    if (normalized?.type === "request.cancel") {
      const params =
        isRecord(message) && isRecord(message.params) ? message.params : {};
      const payload = isRecord(params.payload) ? params.payload : params;
      const id = String(payload.id ?? "");
      const approval = this.approvals.get(id);
      if (approval) {
        this.approvals.delete(id);
        this.options.onEvent?.({
          type: "approval.cancel",
          session_id: approval.sessionId,
          payload: { request_id: approval.requestId, server_request_id: id },
        });
      }
      return;
    }
    if (normalized) this.options.onEvent?.(normalized);
  }

  /** Queue a human choice on its original peer request; this is not an effect receipt. */
  answerApproval(id: string, sessionId: string, choice: string): boolean {
    const approval = this.approvals.get(id);
    if (
      !this.connected ||
      !approval ||
      approval.sessionId !== sessionId ||
      !approval.choices.has(choice)
    )
      return false;
    this.approvals.delete(id);
    try {
      this.socket!.send(
        JSON.stringify({ jsonrpc: "2.0", id, result: { choice } }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private resolveResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    window.clearTimeout(pending.timeout);

    if (response.error) {
      const message =
        typeof response.error === "string"
          ? response.error
          : response.error.message || "Hermes dashboard request failed";
      pending.reject(new Error(message));
      return;
    }

    pending.resolve(response.result);
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}
