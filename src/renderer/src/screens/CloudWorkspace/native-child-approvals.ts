import type {
  ChatGatewayRequest,
  CloudChatAPI,
  NativeChildConsent,
  NativeChildConsentRequest,
} from "../../../../shared/workspace";
export type PendingNativeChild = {
  request: NativeChildConsentRequest;
  name: string;
  expiresAt: number;
  review: () => Promise<void>;
  cancel: () => void;
};
const abortable = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const abort = (): void => reject(Error("Native approval withdrawn"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) abort();
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
const delay = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(Error("Native approval withdrawn"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 500);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
/** Approval precedes effect dispatch. Polls only metadata; effects are never retried. */
export class NativeChildApprovalQueue {
  private pending = new Map<string, PendingNativeChild>();
  constructor(
    private api: Pick<
      CloudChatAPI,
      | "createNativeChildConsent"
      | "pollNativeChildConsent"
      | "reviewNativeChildConsent"
      | "cancelNativeChildConsent"
      | "executeNativeChildConsent"
    >,
    private changed: (rows: PendingNativeChild[]) => void,
    readonly scopeKey = "",
  ) {}
  snapshot(): PendingNativeChild[] {
    return [...this.pending.values()];
  }
  async call(
    scope: ChatGatewayRequest,
    body: Record<string, unknown>,
    parent: AbortSignal,
  ): ReturnType<CloudChatAPI["browserStep"]> {
    parent.throwIfAborted();
    scope = { ...scope };
    body = structuredClone(body);
    const withdrawal = new AbortController(),
      signal = AbortSignal.any([parent, withdrawal.signal]);
    let request: NativeChildConsentRequest | undefined,
      released = false;
    const cancel = (handle: NativeChildConsentRequest): void => {
      void this.api.cancelNativeChildConsent(handle).catch(() => {});
    };
    const creation = this.api
      .createNativeChildConsent(scope, body)
      .then((value) => {
        if (signal.aborted) cancel({ ...scope, requestId: value.requestId });
        return value;
      });
    try {
      let value = await abortable(creation, signal);
      request = { ...scope, requestId: value.requestId };
      const handle = request;
      const valid = (v: NativeChildConsent): void => {
        if (
          v.userId !== scope.userId ||
          v.sessionId !== scope.sessionId ||
          v.requestId !== handle.requestId ||
          !/^[a-f0-9]{64}$/.test(v.requestId) ||
          !Number.isSafeInteger(v.expiresAt) ||
          v.expiresAt !== value.expiresAt ||
          v.expiresAt <= Date.now() ||
          !["pending", "approving", "allowed"].includes(v.state)
        )
          throw Error("Native approval unavailable");
      };
      valid(value);
      this.pending.set(handle.requestId, {
        request: handle,
        name: String(body.name),
        expiresAt: value.expiresAt,
        review: () => this.api.reviewNativeChildConsent(handle),
        cancel: () => withdrawal.abort(),
      });
      this.changed([...this.pending.values()]);
      while (value.state !== "allowed") {
        await delay(signal);
        signal.throwIfAborted();
        if (value.expiresAt <= Date.now())
          throw Error("Native approval expired");
        const next = await abortable(
          this.api.pollNativeChildConsent(handle),
          signal,
        );
        valid(next);
        value = next;
      }
      signal.throwIfAborted();
      if (value.expiresAt <= Date.now()) throw Error("Native approval expired");
      this.pending.delete(handle.requestId);
      this.changed([...this.pending.values()]);
      released = true;
      return await abortable(
        this.api.executeNativeChildConsent(handle),
        signal,
      );
    } finally {
      if (request) {
        this.pending.delete(request.requestId);
        this.changed([...this.pending.values()]);
        if (!released) cancel(request);
      }
    }
  }
}
