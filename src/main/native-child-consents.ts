import { finiteToolJson } from "@mithril/workspace/owned-gateway-tools";
import { chatId } from "@mithril/workspace/sessions";
import type { CloudWorkspace } from "./cloud-workspace";
import type {
  ChatGatewayRequest,
  NativeChildConsent,
  NativeChildConsentRequest,
} from "../shared/workspace";

type Context = Awaited<ReturnType<CloudWorkspace["nativeContext"]>>;
export type NativeChildIntent = {
  turnId: string;
  executionToken: string;
  round: number;
  parentCallId: string;
  childId: string;
  name: string;
  args: Record<string, unknown>;
};
function scope(request: ChatGatewayRequest): void {
  if (
    !request ||
    !chatId(request.userId) ||
    !chatId(request.sessionId) ||
    typeof request.profile !== "string" ||
    !request.profile ||
    request.profile.length > 200 ||
    Object.keys(request).some(
      (k) => !["userId", "profile", "sessionId"].includes(k),
    )
  )
    throw Error("Invalid native approval scope");
}
function intent(body: Record<string, unknown>): NativeChildIntent {
  if (
    !body ||
    Object.keys(body).some(
      (k) =>
        ![
          "turnId",
          "executionToken",
          "round",
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
    !chatId(body.parentCallId) ||
    !chatId(body.childId) ||
    typeof body.name !== "string" ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(body.name) ||
    !body.args ||
    typeof body.args !== "object" ||
    Array.isArray(body.args)
  )
    throw Error("Invalid native approval intent");
  return finiteToolJson(body, 32000) as NativeChildIntent;
}
type NativeConsentRecord = {
  scope: ChatGatewayRequest;
  context: Context;
  intent: NativeChildIntent;
  value: NativeChildConsent;
  released: boolean;
};
/** Main-owned exact intents. Neither callers nor Web locators carry human authority. */
export class NativeChildConsents {
  private records = new Map<string, NativeConsentRecord>();
  constructor(
    private auth: CloudWorkspace,
    private open?: (url: string) => Promise<void>,
  ) {}
  private validate(
    value: unknown,
    request: ChatGatewayRequest,
    requestId?: string,
  ): NativeChildConsent {
    const v = value as NativeChildConsent & { schemaVersion?: unknown };
    if (
      !v ||
      v.schemaVersion !== 1 ||
      v.userId !== request.userId ||
      v.sessionId !== request.sessionId ||
      !/^[a-f0-9]{64}$/.test(v.requestId) ||
      (requestId && v.requestId !== requestId) ||
      !Number.isSafeInteger(v.expiresAt) ||
      ![
        "pending",
        "approving",
        "allowed",
        "denied",
        "cancelled",
        "retired",
      ].includes(v.state)
    )
      throw Error("Native approval response changed");
    return {
      userId: v.userId,
      sessionId: v.sessionId,
      requestId: v.requestId,
      state: v.state,
      expiresAt: v.expiresAt,
    };
  }
  async create(
    request: ChatGatewayRequest,
    body: Record<string, unknown>,
    context: Context,
  ): Promise<NativeChildConsent> {
    scope(request);
    request = {
      userId: request.userId,
      profile: request.profile,
      sessionId: request.sessionId,
    };
    const captured = intent(body);
    finiteToolJson(captured.args, 16000);
    if (
      context.userId !== request.userId ||
      context.profile !== request.profile
    )
      throw Error("Native approval context changed");
    for (const [id, row] of this.records)
      if (row.value.expiresAt <= Date.now()) this.records.delete(id);
    if (this.records.size >= 32)
      throw Error("Native approval capacity exceeded");
    const { value } = await this.auth.authorizedRequest(
      `/v1/chat/sessions/${encodeURIComponent(request.sessionId)}/gateway/native-consent`,
      captured,
      ["chat:write", "inference"],
      context,
    );
    const result = this.validate(value, request);
    if (
      result.expiresAt <= Date.now() ||
      result.expiresAt > Date.now() + 60000 ||
      !["pending", "allowed"].includes(result.state)
    )
      throw Error("Native approval expired");
    const old = this.records.get(result.requestId);
    if (
      old &&
      (old.released ||
        JSON.stringify(old.intent) !== JSON.stringify(captured) ||
        JSON.stringify(old.context) !== JSON.stringify(context))
    )
      throw Error("Native approval already retired");
    this.records.set(result.requestId, {
      scope: request,
      context: { ...context },
      intent: captured,
      value: result,
      released: false,
    });
    return result;
  }
  private record(request: NativeChildConsentRequest): NativeConsentRecord {
    if (
      !request ||
      Object.keys(request).some(
        (k) => !["userId", "profile", "sessionId", "requestId"].includes(k),
      ) ||
      !/^[a-f0-9]{64}$/.test(request.requestId)
    )
      throw Error("Invalid native approval handle");
    scope({
      userId: request.userId,
      profile: request.profile,
      sessionId: request.sessionId,
    });
    const row = this.records.get(request.requestId);
    if (
      !row ||
      JSON.stringify(row.scope) !==
        JSON.stringify({
          userId: request.userId,
          profile: request.profile,
          sessionId: request.sessionId,
        })
    )
      throw Error("Native approval scope retired");
    return row;
  }
  async poll(request: NativeChildConsentRequest): Promise<NativeChildConsent> {
    const row = this.record(request);
    if (row.released || row.value.expiresAt <= Date.now())
      throw Error("Native approval retired");
    const { value } = await this.auth.authorizedRequest(
      `/v1/chat/sessions/${encodeURIComponent(row.scope.sessionId)}/gateway/native-consent/${request.requestId}`,
      undefined,
      "chat:write",
      row.context,
    );
    const result = this.validate(value, row.scope, request.requestId);
    if (result.expiresAt !== row.value.expiresAt)
      throw Error("Native approval deadline changed");
    row.value = result;
    if (["denied", "cancelled", "retired"].includes(result.state))
      row.released = true;
    return result;
  }
  async review(request: NativeChildConsentRequest): Promise<void> {
    const value = await this.poll(request),
      row = this.record(request);
    if (
      value.state !== "pending" ||
      value.expiresAt <= Date.now() ||
      !this.open
    )
      throw Error("Native approval unavailable");
    const current = await this.auth.nativeContext();
    if (JSON.stringify(current) !== JSON.stringify(row.context) || row.released)
      throw Error("Native approval context changed");
    const url = new URL("https://app.mithril.fund/");
    url.searchParams.set("session", row.scope.sessionId);
    url.searchParams.set("toolApproval", value.requestId);
    await this.open(url.toString());
  }
  async cancel(request: NativeChildConsentRequest): Promise<void> {
    const row = this.record(request);
    if (row.released) return; // A local cancellation never claims an in-flight effect stopped.
    row.released = true;
    await this.auth.authorizedRequest(
      `/v1/chat/sessions/${encodeURIComponent(row.scope.sessionId)}/gateway/native-consent/${request.requestId}`,
      undefined,
      "chat:write",
      row.context,
      "DELETE",
    );
  }
  async execute<T>(
    request: NativeChildConsentRequest,
    dispatch: (
      id: string,
      body: Record<string, unknown>,
      context: Context,
    ) => Promise<T>,
  ): Promise<T> {
    const value = await this.poll(request),
      row = this.record(request);
    if (
      value.state !== "allowed" ||
      value.expiresAt <= Date.now() ||
      row.released
    )
      throw Error("Native approval not allowed");
    // Claim before dispatch; lost replies never cause a new automatic effect attempt.
    row.released = true;
    return dispatch(
      row.scope.sessionId,
      { ...structuredClone(row.intent), action: "child" },
      { ...row.context },
    );
  }
}
