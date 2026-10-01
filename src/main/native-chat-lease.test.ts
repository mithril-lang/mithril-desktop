import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  NativeChatLease,
  type NativeLeaseDependencies,
  type NativeRunHooks,
  type DeviceTurnOperation,
} from "./native-chat-lease";
const operation: DeviceTurnOperation = {
  operationId: "op1",
  baseRevision: 0,
  type: "device_turn",
  data: { content: "Fixture", model: "model1", deviceId: "device1" },
};
// Fixture return types retain Vitest mock methods for fault injection.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
interface Fixture {
  deps: NativeLeaseDependencies;
  lease: NativeChatLease;
  run: Mock<(hooks: NativeRunHooks) => Promise<void>>;
  stop: Mock<() => Promise<void>>;
  request: Mock<
    (path: string, body: unknown, signal: AbortSignal) => Promise<unknown>
  >;
  approval: Mock<() => Promise<"once">>;
  tick(): void;
  switch(): void;
}
function fixture(): Fixture {
  let owner = {
    userId: "owner",
    profile: "default",
    actor: "tokenhash",
    epoch: 1,
  };
  let session = {
    id: "s1",
    title: "Fixture",
    model: "model1",
    revision: 1,
    eventSeq: 1,
    deleted: false,
    activeTurn: {
      id: "turn1",
      status: "running",
      executionMode: "desktop_runtime",
      leaseExpiresAt: Date.now() + 10000,
    },
  };
  let tick = (): void => {};
  const stop = vi.fn(async () => {});
  const request = vi.fn(
    async (
      _path: string,
      body: unknown,
      _signal: AbortSignal,
    ): Promise<unknown> => {
      const input = body as Record<string, unknown>;
      const base = { schemaVersion: 1, userId: "owner", turnId: "turn1" };
      if (input.action === "claim")
        return {
          ...base,
          session,
          privateLeaseToken: "private-token-that-must-never-cross-ipc",
          expiresAt: Date.now() + 10000,
        };
      if (input.action === "heartbeat")
        return { ...base, expiresAt: Date.now() + 10000 };
      session = {
        ...session,
        eventSeq: session.eventSeq + 1,
        revision: session.revision + 1,
      };
      if (input.action === "checkpoint") {
        const events = input.events as Array<{
          type: string;
          data: Record<string, string>;
        }>;
        if (
          events.some(
            (e) => e.type === "turn_status" && e.data.status === "completed",
          )
        )
          session.activeTurn.status = "completed";
      }
      return { ...base, session, execute: true };
    },
  );
  const run = vi.fn(async (hooks: NativeRunHooks) => {
    await hooks.beforeInference();
    await hooks.checkpoint([
      { type: "assistant", data: { content: "Fixture answer" } },
      { type: "turn_phase", data: { phase: "completed" } },
      { type: "turn_status", data: { status: "completed" } },
    ]);
  });
  const approval = vi.fn(async () => "once" as const);
  const deps: NativeLeaseDependencies = {
    context: async () => owner,
    request,
    approval,
    now: () => Date.now(),
    watch: (cb) => {
      tick = cb;
      return () => {
        tick = () => {};
      };
    },
    runner: {
      guarantees: {
        fixedMithrilProvider: true,
        preInferenceGuard: true,
        preToolGuard: true,
        descendantStop: true,
        nativeApproval: true,
      },
      run,
      stop,
    },
  };
  return {
    deps,
    lease: new NativeChatLease(deps),
    run,
    stop,
    request,
    approval,
    tick: () => tick(),
    switch: () => {
      owner = { ...owner, epoch: 2, userId: "other" };
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("Main-only native device lease", () => {
  it("remains unavailable without a guarded runner and rejects unsafe operation extras", async () => {
    const f = fixture();
    delete f.deps.runner;
    expect(f.lease.readiness().available).toBe(false);
    await expect(f.lease.start("s1", operation, 1)).rejects.toThrow("runner");
    expect(f.request).not.toHaveBeenCalled();
    const ready = fixture();
    await expect(
      ready.lease.start(
        "s1",
        {
          ...operation,
          data: { ...operation.data, providerUrl: "https://example.com" },
        } as DeviceTurnOperation,
        1,
      ),
    ).rejects.toThrow("Invalid native turn");
  });
  it("binds fixed Mithril routing and returns only a public completion descriptor", async () => {
    const f = fixture();
    const result = await f.lease.start("s1", operation, 1);
    expect(result).toEqual({ status: "completed", turnId: "turn1" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(f.run.mock.calls[0][0].apiOrigin).toBe("https://api.mithril.fund");
    expect(
      f.request.mock.calls.every(
        ([path]) => path === "/v1/chat/sessions/s1/device",
      ),
    ).toBe(true);
    f.tick();
    expect(f.request).toHaveBeenCalledTimes(3);
  });
  it("never runs or retries a lost claim acknowledgement", async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new Error("Lost acknowledgement"));
    expect(await f.lease.start("s1", operation, 1)).toEqual({
      status: "uncertain",
    });
    expect(f.run).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.stop).toHaveBeenCalledTimes(1);
  });
  it("does not let a queued heartbeat invalidate an acknowledged completion", async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (path, body, signal) => {
      if ((body as { action: string }).action === "checkpoint") f.tick();
      return original(path, body, signal);
    });
    expect((await f.lease.start("s1", operation, 1)).status).toBe("completed");
    expect(f.stop).not.toHaveBeenCalled();
    expect(
      f.request.mock.calls.filter(
        ([, body]) => (body as { action: string }).action === "heartbeat",
      ),
    ).toHaveLength(1);
  });
  it("durably claims before tools and never re-executes a duplicate claim", async () => {
    const f = fixture();
    f.run.mockImplementation(async (hooks) => {
      const original = f.request.getMockImplementation()!;
      f.request.mockImplementation(async (path, body, signal) => {
        const value = (await original(path, body, signal)) as Record<
          string,
          unknown
        >;
        return (body as { action: string }).action === "tool_claim"
          ? { ...value, execute: false }
          : value;
      });
      expect(await hooks.beforeTool("tool1", "web_search")).toBe(false);
      await hooks.checkpoint([
        { type: "turn_status", data: { status: "completed" } },
      ]);
    });
    expect((await f.lease.start("s1", operation, 1)).status).toBe("completed");
    const tool = f.request.mock.calls.find(
      ([, body]) => (body as { action: string }).action === "tool_claim",
    )![1];
    expect(tool).toMatchObject({
      expectedEventSeq: 1,
      toolCallId: "tool1",
      name: "web_search",
    });
    expect(tool).not.toHaveProperty("arguments");
  });
  it("stops immediately on owner change even if the runner catches the guard error", async () => {
    const f = fixture();
    f.run.mockImplementation(async (hooks) => {
      f.switch();
      await expect(hooks.beforeInference()).rejects.toThrow();
      expect(hooks.signal.aborted).toBe(true);
    });
    expect((await f.lease.start("s1", operation, 1)).status).toBe("uncertain");
    expect(f.stop).toHaveBeenCalledTimes(1);
  });
  it("binds native approval to sender and run, then rechecks cancellation before continuing", async () => {
    const f = fixture();
    f.approval.mockImplementation(async () => {
      f.request.mockRejectedValueOnce(new Error("Cancelled"));
      return "once";
    });
    f.run.mockImplementation(async (hooks) => {
      await hooks.approval({
        requestId: "request1",
        command: "fixture",
        description: "Fixture",
        choices: ["once", "deny"],
      });
    });
    expect((await f.lease.start("s1", operation, 7)).status).toBe("uncertain");
    expect(f.approval).toHaveBeenCalledWith(
      { ownerId: 7, runId: "op1" },
      expect.anything(),
      expect.any(AbortSignal),
    );
    expect(f.stop).toHaveBeenCalledTimes(1);
  });
  it("stops on a locally expired lease while the runner is hanging", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.run.mockImplementation(() => new Promise(() => {}));
    const result = f.lease.start("s1", operation, 1);
    await vi.advanceTimersByTimeAsync(10001);
    expect((await result).status).toBe("uncertain");
    expect(f.stop).toHaveBeenCalledTimes(1);
  });
  it("aborts hanging requests and never executes after an invalid turn fence", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request.mockImplementationOnce(() => new Promise(() => {}));
    const result = f.lease.start("s1", operation, 1);
    await vi.advanceTimersByTimeAsync(4001);
    expect((await result).status).toBe("uncertain");
    expect(f.run).not.toHaveBeenCalled();
    const other = fixture();
    const original = other.request.getMockImplementation()!;
    other.request.mockImplementationOnce(async (path, body, signal) => {
      const value = (await original(path, body, signal)) as {
        session: { activeTurn: { id: string } };
      };
      value.session.activeTurn.id = "another-turn";
      return value;
    });
    expect((await other.lease.start("s1", operation, 1)).status).toBe(
      "uncertain",
    );
    expect(other.run).not.toHaveBeenCalled();
  });
});
