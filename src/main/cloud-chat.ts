import {
  createHistoryFileTransport,
  type HistoryFileTransport,
} from "@mithril/workspace/history";
import { CloudWorkspace } from "./cloud-workspace";
import type {
  ChatGatewayRequest,
  ChatGatewaySelection,
} from "../shared/workspace";
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
  // Main-owned ephemeral inventory; server admission remains authoritative.
  private browserInventories = new Map<
    string,
    {
      ticket: symbol;
      turnId: unknown;
      executionToken: unknown;
      round?: number;
      parents?: Set<string>;
      tools?: Set<string>;
      expires?: number;
    }
  >();
  constructor(
    readonly auth: CloudWorkspace,
    private readonly openGatewayReview?: (url: string) => Promise<void>,
  ) {
    this.historyFiles = createHistoryFileTransport((path, init) =>
      auth.authorizedBinaryRequest(path, init),
    );
  }
  /** Fixed owner-scoped metadata only; selection and human grants remain Web-session operations. */
  async gatewaySelection(
    request: ChatGatewayRequest,
  ): Promise<ChatGatewaySelection> {
    const { selection } = await this.readGatewaySelection(request);
    return selection;
  }
  private async readGatewaySelection(request: ChatGatewayRequest): Promise<{
    selection: ChatGatewaySelection;
    context: Awaited<ReturnType<CloudWorkspace["nativeContext"]>>;
  }> {
    if (
      !request ||
      !chatId(request.sessionId) ||
      !chatId(request.userId) ||
      typeof request.profile !== "string" ||
      !request.profile ||
      Object.keys(request).some(
        (key) => !["userId", "profile", "sessionId"].includes(key),
      )
    )
      throw Error("Invalid tool connection request");
    request = structuredClone(request);
    const context = await this.auth.nativeContext();
    if (
      context.userId !== request.userId ||
      context.profile !== request.profile
    )
      throw Error("Tool connection owner or profile changed");
    const { value } = await this.auth.authorizedRequest(
      `/v1/chat/sessions/${encodeURIComponent(request.sessionId)}/gateway`,
      undefined,
      "chat:read",
      context,
    );
    const result = value as { sessionId?: unknown; binding?: unknown };
    if (
      !result ||
      result.sessionId !== request.sessionId ||
      !("binding" in result)
    )
      throw Error("Invalid tool connection response");
    const binding = result.binding as {
      stored_session_id?: unknown;
      revision?: unknown;
      active?: unknown;
    } | null;
    if (
      binding !== null &&
      (!binding ||
        typeof binding.stored_session_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(binding.stored_session_id) ||
        !Number.isSafeInteger(binding.revision) ||
        (binding.revision as number) < 1 ||
        ![0, 1].includes(binding.active as number))
    )
      throw Error("Invalid tool connection response");
    const selection: ChatGatewaySelection = {
      userId: context.userId,
      sessionId: request.sessionId,
      binding:
        binding === null
          ? null
          : {
              storedSessionId: binding.stored_session_id as string,
              revision: binding.revision as number,
              active: binding.active === 1,
            },
    };
    return { selection, context };
  }
  async reviewGateway(request: ChatGatewayRequest): Promise<void> {
    const { selection, context } = await this.readGatewaySelection(request);
    const current = await this.auth.nativeContext();
    if (
      context.userId !== current.userId ||
      context.profile !== current.profile ||
      context.epoch !== current.epoch ||
      context.actor !== current.actor
    )
      throw Error("Tool connection context changed");
    if (!this.openGatewayReview)
      throw Error("Tool connection review unavailable");
    const url = new URL("https://app.mithril.fund/");
    url.searchParams.set("session", selection.sessionId);
    await this.openGatewayReview(url.toString());
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
    childResult?: import("@mithril/workspace/client-tool-turn").ClientToolResult;
    childTools?: string[];
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
      JSON.stringify(body).length > 524288
    )
      throw Error("Invalid tool checkpoint");
    body = structuredClone(body);
    const context = await this.auth.nativeContext();
    const inventoryKey = JSON.stringify([context, id]);
    // Context fingerprints stay in main; bound memory across accounts/sessions.
    for (const [key, value] of this.browserInventories)
      if (value.expires !== undefined && value.expires <= Date.now())
        this.browserInventories.delete(key);
    const inventory = this.browserInventories.get(inventoryKey);
    const dynamicChild =
      inventory?.tools?.has(String(body.name)) &&
      inventory.turnId === body.turnId &&
      inventory.executionToken === body.executionToken &&
      inventory.round === body.round &&
      inventory.parents?.has(String(body.parentCallId)) &&
      (inventory.expires ?? 0) > Date.now();
    if (body.action === "child") {
      if (
        !chatId(body.parentCallId) ||
        !chatId(body.childId) ||
        (!dynamicChild &&
          ![
            "tool_catalog",
            "mithril_tool",
            "web_search",
            "web_extract",
          ].includes(String(body.name))) ||
        !body.args ||
        typeof body.args !== "object" ||
        Array.isArray(body.args) ||
        Buffer.byteLength(JSON.stringify(body.args), "utf8") > 16000 ||
        "results" in body
      )
        throw Error("Invalid child tool checkpoint");
    } else if (
      ["parentCallId", "childId", "name", "args"].some((key) => key in body)
    )
      throw Error("Invalid child tool checkpoint");
    const ticket = Symbol();
    if (body.action !== "child") {
      this.browserInventories.delete(inventoryKey);
      if (this.browserInventories.size >= 32)
        this.browserInventories.delete(
          this.browserInventories.keys().next().value!,
        );
      this.browserInventories.set(inventoryKey, {
        ticket,
        turnId: body.turnId,
        executionToken: body.executionToken,
        expires: Date.now() + 45000,
      });
    }
    const { value } = await this.auth.authorizedRequest(
      `/v1/chat/sessions/${encodeURIComponent(id)}/browser`,
      { ...body, toolProtocol: "mithril-browser-tools-v2" },
      "inference",
      context,
    );
    const result = value as {
      phase: string;
      round: number;
      calls: import("@mithril/workspace/client-tool-turn").ClientToolCall[];
      childResult?: import("@mithril/workspace/client-tool-turn").ClientToolResult;
      childTools?: string[];
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
      (result.calls !== undefined &&
        (!Array.isArray(result.calls) || result.calls.length > 2))
    )
      throw Error("Invalid tool response");
    if (
      body.action === "child" &&
      (result.phase !== "child_result" ||
        result.round !== body.round ||
        result.childResult?.id !== body.childId ||
        !result.childResult?.receipt ||
        typeof result.childResult?.receipt !== "object" ||
        Array.isArray(result.childResult?.receipt))
    )
      throw Error("Invalid child tool response");
    if (body.action !== "child" && result.phase === "child_result")
      throw Error("Unexpected child tool response");
    if (
      result.childTools !== undefined &&
      (!Array.isArray(result.childTools) ||
        result.childTools.length > 4100 ||
        new Set(result.childTools).size !== result.childTools.length ||
        result.childTools.some(
          (name) =>
            typeof name !== "string" ||
            !/^[A-Za-z0-9_-]{1,256}$/.test(name) ||
            ["js", "python", "mithril_code"].includes(name),
        ))
    )
      throw Error("Invalid child tool inventory");
    const latest = await this.auth.nativeContext();
    if (JSON.stringify(latest) !== JSON.stringify(context))
      throw Error("Chat owner changed");
    if (
      body.action !== "child" &&
      this.browserInventories.get(inventoryKey)?.ticket === ticket
    ) {
      if (
        body.action === "next" &&
        result.phase === "tools_wait" &&
        result.round === body.round &&
        result.childTools
      ) {
        const parents = new Set<string>();
        for (const call of result.calls ?? []) {
          if (
            !chatId(call?.id) ||
            !call.function ||
            ![
              "js",
              "python",
              "mithril_code",
              "tool_catalog",
              "mithril_tool",
              "web_search",
              "web_extract",
            ].includes(call.function.name)
          )
            throw Error("Invalid tool parent");
          if (["js", "python"].includes(call.function.name))
            parents.add(call.id);
        }
        this.browserInventories.set(inventoryKey, {
          ticket,
          turnId: body.turnId,
          executionToken: body.executionToken,
          round: result.round,
          parents,
          tools: new Set(result.childTools),
          expires: Date.now() + 45000,
        });
      } else this.browserInventories.delete(inventoryKey);
    }
    return result;
  }
}
