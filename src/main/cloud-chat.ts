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
  type ChatSessionPage,
  type ChatSessionSnapshot,
  type ChatModel,
} from "@mithril/workspace/sessions";
import {
  readSessionInventory,
  type SessionTransport,
} from "@mithril/workspace/session-sync";

/** Fixed canonical D1 routes. No provider URLs or bearer credentials cross IPC. */
export class CloudChat implements SessionTransport {
  readonly historyFiles: HistoryFileTransport;
  constructor(readonly auth: CloudWorkspace) {
    this.historyFiles = createHistoryFileTransport((path, init) =>
      auth.authorizedBinaryRequest(path, init),
    );
  }
  async list(): Promise<ChatSessionList> {
    return readSessionInventory(async (cursor) => {
      const path =
        "/v1/chat/sessions?page=1" +
        (cursor
          ? `&anchor=${cursor.anchor}&after=${encodeURIComponent(cursor.after)}`
          : "");
      const { value } = await this.auth.authorizedRequest(path);
      return value as ChatSessionPage;
    });
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
    childResult?: import("@mithril/workspace/client-tool-turn").ClientToolResult;
  }> {
    if (
      !chatId(id) ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (k) =>
          ![
            "action",
            "turnId",
            "executionToken",
            "round",
            "results",
            "parentCallId",
            "childId",
            "name",
            "args",
          ].includes(k),
      ) ||
      !chatId(body.turnId) ||
      typeof body.executionToken !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.executionToken) ||
      !Number.isSafeInteger(body.round) ||
      (body.round as number) < 0 ||
      !["next", "result", "failed", "child"].includes(String(body.action)) ||
      (body.action === "child"
        ? body.results !== undefined ||
          !chatId(body.parentCallId) ||
          !chatId(body.childId) ||
          ![
            "tool_catalog",
            "mithril_tool",
            "web_search",
            "web_extract",
          ].includes(String(body.name)) ||
          body.args === undefined ||
          JSON.stringify(body.args).length > 16000
        : ["parentCallId", "childId", "name", "args"].some(
            (key) => body[key] !== undefined,
          )) ||
      JSON.stringify(body).length > 524288
    )
      throw Error("Invalid tool checkpoint");
    const { value } = await this.auth.authorizedRequest(
      `/v1/chat/sessions/${encodeURIComponent(id)}/browser`,
      { ...body, toolProtocol: "mithril-language-v1" },
      "inference",
      // The API bounds model completion to 60 seconds and child calls to 20.
      // Keep transport alive through that operation, without replaying it.
      body.action === "next" ? 65000 : body.action === "child" ? 25000 : 15000,
    );
    const result = value as {
      phase: string;
      round: number;
      calls: import("@mithril/workspace/client-tool-turn").ClientToolCall[];
      childResult?: import("@mithril/workspace/client-tool-turn").ClientToolResult;
    };
    if (
      ![
        "ready",
        "tools_wait",
        "completed",
        "uncertain",
        "child_result",
      ].includes(result.phase) ||
      !Number.isSafeInteger(result.round) ||
      (body.action === "child"
        ? result.phase !== "child_result" ||
          result.round !== body.round ||
          result.childResult?.id !== body.childId
        : result.phase === "child_result" ||
          result.childResult !== undefined) ||
      (result.calls !== undefined &&
        (!Array.isArray(result.calls) || result.calls.length > 2))
    )
      throw Error("Invalid tool response");
    return result;
  }
}
