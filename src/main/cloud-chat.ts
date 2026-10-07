import {
  createHistoryFileTransport,
  type HistoryFileTransport,
} from "@mithril/workspace/history";
import { CloudWorkspace } from "./cloud-workspace";
import {
  chatId,
  validateChatSession,
  validateChatOperation,
  validateChatEvent,
  validateChatModel,
  validateChatRuntimeAvailability,
  type ChatRuntimeAvailability,
  type ChatOperation,
  type ChatOperationResponse,
  type ChatReceipt,
  type ChatSessionList,
  type ChatSessionSnapshot,
  type ChatModel,
} from "@mithril/workspace/sessions";
import type { SessionTransport } from "@mithril/workspace/session-sync";

/** Fixed canonical D1 routes. No provider URLs or bearer credentials cross IPC. */
export class CloudChat implements SessionTransport {
  readonly historyFiles: HistoryFileTransport;
  constructor(readonly auth: CloudWorkspace) {
    this.historyFiles = createHistoryFileTransport((path, init) =>
      auth.authorizedBinaryRequest(path, init),
    );
  }
  async list(): Promise<ChatSessionList> {
    const { value } = await this.auth.authorizedRequest("/v1/chat/sessions");
    const result = value as ChatSessionList;
    if (
      !Array.isArray(result.sessions) ||
      !result.sessions.every(validateChatSession) ||
      new Set(result.sessions.map((s) => s.id)).size !== result.sessions.length
    )
      throw new Error("Chat session list invalid");
    return result;
  }
  async models(): Promise<ChatModel[]> {
    const { value } = await this.auth.authorizedRequest("/v1/chat/models");
    const models = (value as { models?: unknown }).models;
    if (
      !Array.isArray(models) ||
      !models.every(validateChatModel) ||
      new Set(models.map((m) => m.id)).size !== models.length
    )
      throw new Error("Chat model inventory invalid");
    return models;
  }
  async runtime(): Promise<ChatRuntimeAvailability> {
    const { value } = await this.auth.authorizedRequest(
      "/v1/chat/runtime",
      undefined,
      "sandbox",
    );
    if (!validateChatRuntimeAvailability(value))
      throw new Error("Chat runtime availability invalid");
    return value;
  }
  async events(id: string, after = 0): Promise<ChatSessionSnapshot> {
    if (!chatId(id) || !Number.isSafeInteger(after) || after < 0)
      throw new Error("Invalid chat checkpoint");
    const { value } = await this.auth.authorizedRequest(
      `/v1/chat/sessions/${encodeURIComponent(id)}/events?after=${after}`,
    );
    const result = value as ChatSessionSnapshot;
    if (
      !validateChatSession(result.session) ||
      result.session.id !== id ||
      !Array.isArray(result.events) ||
      !result.events.every(validateChatEvent) ||
      !result.events.every(
        (event, index) =>
          event.seq > (index ? result.events[index - 1].seq : after) &&
          event.seq <= result.session.eventSeq,
      ) ||
      typeof result.hasMore !== "boolean" ||
      (result.hasMore
        ? !result.events.length ||
          result.nextAfter !== result.events.at(-1)!.seq
        : result.nextAfter !== null)
    )
      throw new Error("Chat checkpoint invalid");
    return result;
  }
  async apply(
    id: string,
    operation: ChatOperation,
  ): Promise<ChatOperationResponse> {
    if (!chatId(id) || !validateChatOperation(operation))
      throw new Error("Unsupported chat operation");
    const { value } = await this.auth.authorizedRequest(
      `/v1/chat/sessions/${encodeURIComponent(id)}/operations`,
      { schemaVersion: 1, ...operation },
      operation.type === "runtime_turn"
        ? ["inference", "sandbox"]
        : operation.type === "turn" || operation.type === "browser_turn"
          ? "inference"
          : undefined,
    );
    const result = value as ChatOperationResponse;
    if (
      result.operationId !== operation.operationId ||
      !["accepted", "conflict"].includes(result.status) ||
      !validateChatSession(result.session) ||
      result.session.id !== id
    )
      throw new Error("Chat operation response invalid");
    return result;
  }
  async receipt(id: string, operationId: string): Promise<ChatReceipt> {
    if (!chatId(id) || !chatId(operationId))
      throw new Error("Invalid chat receipt");
    const { value } = await this.auth.authorizedRequest(
      `/v1/chat/sessions/${encodeURIComponent(id)}/operations/${encodeURIComponent(operationId)}`,
    );
    const result = value as ChatReceipt;
    if (
      result.operationId !== operationId ||
      !["accepted", "conflict", "unknown"].includes(result.status) ||
      (result.status === "unknown"
        ? result.session !== null
        : !validateChatSession(result.session) || result.session.id !== id)
    )
      throw new Error("Chat receipt invalid");
    return result;
  }
  async browserStep(
    id: string,
    body: Record<string, unknown>,
  ): Promise<{
    phase: string;
    round: number;
    calls: import("@mithril/workspace/client-tool-turn").ClientToolCall[];
  }> {
    if (
      !chatId(id) ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (k) =>
          !["action", "turnId", "executionToken", "round", "results"].includes(
            k,
          ),
      ) ||
      !chatId(body.turnId) ||
      typeof body.executionToken !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.executionToken) ||
      !Number.isSafeInteger(body.round) ||
      (body.round as number) < 0 ||
      !["next", "result", "failed"].includes(String(body.action)) ||
      JSON.stringify(body).length > 524288
    )
      throw Error("Invalid tool checkpoint");
    const { value } = await this.auth.authorizedRequest(
      `/v1/chat/sessions/${encodeURIComponent(id)}/browser`,
      { ...body, toolProtocol: "mithril-language-v1" },
      "inference",
    );
    const result = value as {
      phase: string;
      round: number;
      calls: import("@mithril/workspace/client-tool-turn").ClientToolCall[];
    };
    if (
      !["ready", "tools_wait", "completed", "uncertain"].includes(
        result.phase,
      ) ||
      !Number.isSafeInteger(result.round) ||
      (result.calls !== undefined &&
        (!Array.isArray(result.calls) || result.calls.length > 2))
    )
      throw Error("Invalid tool response");
    return result;
  }
}
