import { afterEach, expect, it, vi } from "vitest";
import { NativeChildApprovalQueue } from "./native-child-approvals";
import type { NativeChildConsent } from "../../../../shared/workspace";
const scope = { userId: "owner", profile: "default", sessionId: "s1" },
  requestId = "b".repeat(64);
function fixture(): {
  api: {
    createNativeChildConsent: ReturnType<typeof vi.fn>;
    pollNativeChildConsent: ReturnType<typeof vi.fn>;
    reviewNativeChildConsent: ReturnType<typeof vi.fn>;
    cancelNativeChildConsent: ReturnType<typeof vi.fn>;
    executeNativeChildConsent: ReturnType<typeof vi.fn>;
  };
  changed: ReturnType<typeof vi.fn>;
  value: (state?: NativeChildConsent["state"]) => NativeChildConsent;
  queue: NativeChildApprovalQueue;
  controller: AbortController;
} {
  const expiresAt = Date.now() + 40000;
  const value = (
    state: NativeChildConsent["state"] = "pending",
  ): NativeChildConsent => ({
    userId: "owner",
    sessionId: "s1",
    requestId,
    state,
    expiresAt,
  });
  const api = {
      createNativeChildConsent: vi.fn(async () => value()),
      pollNativeChildConsent: vi.fn(async () => value()),
      reviewNativeChildConsent: vi.fn(async () => {}),
      cancelNativeChildConsent: vi.fn(async () => {}),
      executeNativeChildConsent: vi.fn(async () => ({
        phase: "child_result",
        round: 0,
        calls: [],
      })),
    },
    changed = vi.fn();
  return {
    api,
    changed,
    value,
    queue: new NativeChildApprovalQueue(api, changed),
    controller: new AbortController(),
  };
}
afterEach(() => vi.useRealTimers());
// @lat: [[mithril-code#Mithril Code#Native late creation withdrawal]]
it("cancels a request created after consumer retirement without exposing an approval or executing", async () => {
  const f = fixture();
  let resolve!: (v: NativeChildConsent) => void;
  f.api.createNativeChildConsent.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const call = f.queue.call(scope, { name: "write_file" }, f.controller.signal),
    rejected = expect(call).rejects.toThrow("withdrawn");
  f.controller.abort();
  await rejected;
  resolve(f.value());
  await vi.waitFor(() =>
    expect(f.api.cancelNativeChildConsent).toHaveBeenCalledExactlyOnceWith({
      ...scope,
      requestId,
    }),
  );
  expect(f.changed).not.toHaveBeenCalled();
  expect(f.api.executeNativeChildConsent).not.toHaveBeenCalled();
});
// @lat: [[mithril-code#Mithril Code#Native pending deadline and refusal]]
it.each(["expired", "denied", "changed-deadline", "network"])(
  "refuses %s while waiting and never dispatches",
  async (kind) => {
    vi.useFakeTimers();
    const f = fixture();
    if (kind === "denied")
      f.api.pollNativeChildConsent.mockResolvedValue(f.value("denied"));
    if (kind === "changed-deadline")
      f.api.pollNativeChildConsent.mockResolvedValue({
        ...f.value("allowed"),
        expiresAt: Date.now() + 50000,
      });
    if (kind === "network")
      f.api.pollNativeChildConsent.mockRejectedValue(Error("lost poll reply"));
    const call = f.queue.call(
        scope,
        { name: "write_file" },
        f.controller.signal,
      ),
      rejected = expect(call).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(kind === "expired" ? 41000 : 500);
    await rejected;
    expect(f.api.cancelNativeChildConsent).toHaveBeenCalledOnce();
    expect(f.api.executeNativeChildConsent).not.toHaveBeenCalled();
  },
);
// @lat: [[mithril-code#Mithril Code#Native unknown release is not retried]]
it("does not retry or claim cancellation after a released effect loses its reply", async () => {
  const f = fixture();
  f.api.createNativeChildConsent.mockResolvedValue(f.value("allowed"));
  f.api.executeNativeChildConsent.mockRejectedValue(
    Error("effect outcome unknown"),
  );
  await expect(
    f.queue.call(scope, { name: "write_file" }, f.controller.signal),
  ).rejects.toThrow("unknown");
  expect(f.api.executeNativeChildConsent).toHaveBeenCalledOnce();
  expect(f.api.cancelNativeChildConsent).not.toHaveBeenCalled();
  expect(f.api.pollNativeChildConsent).not.toHaveBeenCalled();
});
