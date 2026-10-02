import { randomUUID } from "crypto";
import {
  chatId,
  validateChatOperation,
  validateChatSession,
  validateChatEvent,
  type ChatSession,
  type ChatEventType,
} from "@mithril/workspace/sessions";
import type {
  ApprovalChoice,
  ChatApprovalRequest,
} from "../shared/chat-approval";

export interface NativeChatOwner {
  userId: string;
  profile: string;
  actor: string;
  epoch: number;
}
export interface DeviceTurnOperation {
  operationId: string;
  baseRevision: number;
  type: "device_turn";
  data: {
    content: string;
    model: string;
    deviceId: string;
    deviceLabel?: string;
  };
}
export interface NativeCheckpoint {
  type: ChatEventType;
  data: Record<string, string>;
}
export interface NativeRunHooks {
  /** Fixed routing identity, never a provider URL from the renderer. */
  apiOrigin: "https://api.mithril.fund";
  model: string;
  content: string;
  signal: AbortSignal;
  beforeInference(): Promise<void>;
  beforeTool(toolCallId: string, name: string): Promise<boolean>;
  checkpoint(events: NativeCheckpoint[]): Promise<void>;
  approval(request: ChatApprovalRequest): Promise<ApprovalChoice>;
}
/** A legacy gateway does not satisfy this contract and must never be installed here. */
export interface GuardedNativeRunner {
  guarantees: {
    fixedMithrilProvider: true;
    preInferenceGuard: true;
    preToolGuard: true;
    descendantStop: true;
    nativeApproval: true;
  };
  run(hooks: NativeRunHooks): Promise<void>;
  stop(): Promise<void>;
}
export interface NativeLeaseDependencies {
  context(): Promise<NativeChatOwner>;
  request(path: string, body: unknown, signal: AbortSignal): Promise<unknown>;
  approval(
    owner: { ownerId: number; runId: string },
    request: ChatApprovalRequest,
    signal: AbortSignal,
  ): Promise<ApprovalChoice>;
  runner?: GuardedNativeRunner;
  now(): number;
  watch(callback: () => void): () => void;
}
const sameOwner = (a: NativeChatOwner, b: NativeChatOwner): boolean =>
  a.userId === b.userId &&
  a.profile === b.profile &&
  a.actor === b.actor &&
  a.epoch === b.epoch;
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/** Private device claims never cross IPC. Failed acknowledgements are uncertain, not replayable work. */
export class NativeChatLease {
  private active = false;
  constructor(private readonly deps: NativeLeaseDependencies) {}
  readiness(): { available: boolean; reason: string } {
    const g = this.deps.runner?.guarantees;
    const available =
      !!g &&
      g.fixedMithrilProvider === true &&
      g.preInferenceGuard === true &&
      g.preToolGuard === true &&
      g.descendantStop === true &&
      g.nativeApproval === true;
    return {
      available,
      reason: available
        ? "Guarded current-device runtime ready; explicit dispatch and native approvals required."
        : "Current-device D1 dispatch needs a runner with fixed Mithril routing, pre-tool lease checks, native approvals and descendant stop. Existing native Office and Chat remain available.",
    };
  }
  async start(
    sessionId: string,
    operation: DeviceTurnOperation,
    ownerId: number,
  ): Promise<{ status: "completed" | "uncertain"; turnId?: string }> {
    if (!this.readiness().available || !this.deps.runner)
      throw new Error(this.readiness().reason);
    if (this.active) throw new Error("A guarded native turn is already active");
    if (
      !chatId(sessionId) ||
      !validateChatOperation(operation) ||
      operation.type !== "device_turn" ||
      !Number.isSafeInteger(ownerId) ||
      ownerId < 0
    )
      throw new Error("Invalid native turn");
    this.active = true;
    const runner = this.deps.runner;
    const controller = new AbortController();
    let stopPromise: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      controller.abort();
      return (stopPromise ??= runner.stop());
    };
    let turnId: string | undefined;
    let expiresAt = 0;
    let token = "";
    let session: ChatSession | undefined;
    let owner: NativeChatOwner;
    let completed = false;
    let cancelWatch = (): void => {};
    let leaseTimer: ReturnType<typeof setTimeout> | undefined;
    const hardTimer = setTimeout(() => {
      void stop().catch(() => undefined);
    }, 120000);
    const renewTimer = (): void => {
      clearTimeout(leaseTimer);
      leaseTimer = setTimeout(
        () => {
          void stop().catch(() => undefined);
        },
        Math.max(0, expiresAt - this.deps.now()),
      );
    };
    const bounded = <T>(job: Promise<T>, timeout = 4000): Promise<T> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          void stop().catch(() => undefined);
          reject(new Error("Native acknowledgement timed out"));
        }, timeout);
        const aborted = (): void => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", aborted);
          reject(new Error("Native execution stopped"));
        };
        if (controller.signal.aborted) {
          clearTimeout(timer);
          aborted();
          return;
        }
        controller.signal.addEventListener("abort", aborted, { once: true });
        job.then(resolve, reject).finally(() => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", aborted);
        });
      });
    let queue = Promise.resolve();
    const serialize = <T>(job: () => Promise<T>): Promise<T> => {
      const result = queue.then(async () => {
        try {
          return await job();
        } catch (error) {
          await stop();
          throw error;
        }
      });
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const check = async (): Promise<void> => {
      if (
        completed ||
        controller.signal.aborted ||
        (expiresAt && this.deps.now() >= expiresAt)
      )
        throw new Error("Native lease expired or stopped");
      if (!sameOwner(owner, await bounded(this.deps.context())))
        throw new Error("Native owner changed");
      if (controller.signal.aborted) throw new Error("Native lease stopped");
    };
    const checkedResponse = async (
      body: unknown,
    ): Promise<Record<string, unknown>> => {
      await check();
      const value = record(
        await bounded(
          this.deps.request(
            `/v1/chat/sessions/${encodeURIComponent(sessionId)}/device`,
            body,
            controller.signal,
          ),
        ),
      );
      await check();
      if (
        !value ||
        value.schemaVersion !== 1 ||
        value.userId !== owner.userId ||
        (turnId && value.turnId !== turnId)
      )
        throw new Error("Native lease response invalid");
      return value;
    };
    const updateSession = (value: Record<string, unknown>): void => {
      if (
        !validateChatSession(value.session) ||
        value.session.id !== sessionId ||
        value.session.deleted ||
        (session &&
          (value.session.eventSeq < session.eventSeq ||
            value.session.revision < session.revision)) ||
        value.session.activeTurn?.id !== turnId ||
        value.session.activeTurn?.executionMode !== "desktop_runtime"
      )
        throw new Error("Native checkpoint invalid");
      session = value.session;
    };
    const heartbeat = async (): Promise<void> => {
      const value = await checkedResponse({
        action: "heartbeat",
        turnId,
        privateLeaseToken: token,
      });
      if (
        typeof value.expiresAt !== "number" ||
        value.expiresAt <= this.deps.now()
      )
        throw new Error("Native lease heartbeat invalid");
      expiresAt = value.expiresAt;
      renewTimer();
    };
    try {
      owner = await bounded(this.deps.context());
      const claim = await checkedResponse({ action: "claim", operation });
      if (
        !chatId(claim.turnId) ||
        typeof claim.privateLeaseToken !== "string" ||
        claim.privateLeaseToken.length < 32 ||
        typeof claim.expiresAt !== "number" ||
        claim.expiresAt <= this.deps.now()
      )
        throw new Error("Native claim invalid");
      turnId = claim.turnId;
      token = claim.privateLeaseToken;
      expiresAt = claim.expiresAt;
      updateSession(claim);
      renewTimer();
      cancelWatch = this.deps.watch(() => {
        if (!completed)
          void serialize(async () => {
            if (!completed) await heartbeat();
          }).catch(() => undefined);
      });
      await bounded(
        runner.run({
          apiOrigin: "https://api.mithril.fund",
          model: operation.data.model,
          content: operation.data.content,
          signal: controller.signal,
          beforeInference: () => serialize(heartbeat),
          beforeTool: (toolCallId, name) =>
            serialize(async () => {
              if (!chatId(toolCallId) || !chatId(name))
                throw new Error("Invalid native tool descriptor");
              await heartbeat();
              const value = await checkedResponse({
                action: "tool_claim",
                turnId,
                privateLeaseToken: token,
                commandId: randomUUID(),
                expectedEventSeq: session!.eventSeq,
                toolCallId,
                name,
              });
              updateSession(value);
              if (value.execute !== true && value.execute !== false)
                throw new Error("Native tool claim invalid");
              return value.execute;
            }),
          checkpoint: (events) =>
            serialize(async () => {
              const allowed = [
                "assistant_delta",
                "assistant",
                "turn_phase",
                "tool_result",
                "turn_status",
              ];
              if (
                !events.length ||
                events.length > 32 ||
                !events.every(
                  (e, i) =>
                    allowed.includes(e.type) &&
                    validateChatEvent({
                      ...e,
                      seq: i + 1,
                      turnId,
                      createdAt: 1,
                    }),
                )
              )
                throw new Error("Nonportable native checkpoint");
              const value = await checkedResponse({
                action: "checkpoint",
                turnId,
                privateLeaseToken: token,
                commandId: randomUUID(),
                expectedEventSeq: session!.eventSeq,
                events,
              });
              updateSession(value);
              if (
                events.some(
                  (e) =>
                    e.type === "turn_status" && e.data.status === "completed",
                )
              ) {
                if (session!.activeTurn?.status !== "completed")
                  throw new Error("Native completion receipt invalid");
                completed = true;
                cancelWatch();
                clearTimeout(leaseTimer);
              }
            }),
          approval: async (request) => {
            await serialize(heartbeat);
            const choice = await bounded(
              this.deps.approval(
                { ownerId, runId: operation.operationId },
                request,
                controller.signal,
              ),
              120000,
            );
            await serialize(heartbeat);
            if (!request.choices.includes(choice)) {
              await stop();
              throw new Error("Native approval choice invalid");
            }
            return choice;
          },
        }),
        120000,
      );
      await queue;
      if (!completed || controller.signal.aborted)
        throw new Error("Native turn lacks completed receipt");
      return { status: "completed", turnId };
    } catch {
      await stop();
      return { status: "uncertain", ...(turnId ? { turnId } : {}) };
    } finally {
      cancelWatch();
      clearTimeout(leaseTimer);
      clearTimeout(hardTimer);
      token = "";
      this.active = false;
    }
  }
}
