// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OriginalScheduleManualConsumer } from "./original-schedule-manual-consumer";
import { NativeOriginalScheduleReplicaStore } from "./original-schedule-replica-store";
import {
  originalManualNativeRequest,
  originalManualWireRequest,
  type OriginalManualBinding,
  type OriginalManualJournalEntry,
} from "./original-schedule-manual-journal";
import type {
  OriginalManualCommand,
  OriginalManualResult,
} from "./original-schedule-manual";
import type {
  OriginalCronRunResult,
  OriginalCronInspectResult,
} from "./cron-source-run";
interface ConsumerFixture {
  store(): NativeOriginalScheduleReplicaStore;
  consumer(): OriginalScheduleManualConsumer;
  read(): Promise<OriginalManualJournalEntry[]>;
  command: ReturnType<
    typeof vi.fn<
      (command: OriginalManualCommand) => Promise<OriginalManualResult>
    >
  >;
  run: ReturnType<typeof vi.fn<() => Promise<OriginalCronRunResult>>>;
  inspect: ReturnType<typeof vi.fn<() => Promise<OriginalCronInspectResult>>>;
  bind: ReturnType<typeof vi.fn<() => Promise<OriginalManualBinding>>>;
  active(value: boolean): void;
  reportLoss(value: boolean): void;
  fresh(value: boolean): void;
}
const roots: string[] = [];
const scope = { owner: "alice", profile: "default", timeZone: "Asia/Tokyo" };
const binding: OriginalManualBinding = {
  ...scope,
  jobId: "one",
  operationId: "manual-one",
  sourceRevision: 2,
  sourceDigest: "a".repeat(64),
  authorityRevision: 3,
  nativeVersion: "b".repeat(64),
};
function fixture(): ConsumerFixture {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-manual-consumer-")),
  );
  roots.push(root);
  let active = true,
    loseReport = false,
    fresh = true;
  const store = (): NativeOriginalScheduleReplicaStore =>
    new NativeOriginalScheduleReplicaStore(root, scope);
  const command = vi.fn(
    async (c: OriginalManualCommand): Promise<OriginalManualResult> => {
      if (c.action === "take")
        return {
          fresh,
          authorityRevision: 3,
          request: {
            userId: scope.owner,
            ...originalManualWireRequest(binding),
            status: "unknown",
          },
        };
      if (loseReport) throw Error("lost report reply");
      const { action: _action, ...receipt } = c;
      return { userId: scope.owner, ...receipt };
    },
  );
  const run = vi.fn(
    async (): Promise<OriginalCronRunResult> => ({
      success: true as const,
      receipt: {
        ...originalManualNativeRequest(binding),
        status: "completed" as const,
      },
    }),
  );
  const inspect = vi.fn(
    async (): Promise<OriginalCronInspectResult> => ({
      success: true,
      receipt: { ...originalManualNativeRequest(binding), status: "unknown" },
    }),
  );
  const bind = vi.fn(
    async (): Promise<OriginalManualBinding> => structuredClone(binding),
  );
  const check = async (): Promise<void> => {
    if (!active) throw Error("account changed");
  };
  const consumer = (): OriginalScheduleManualConsumer =>
    new OriginalScheduleManualConsumer({
      scope,
      store: store(),
      command,
      run,
      inspect,
      bind,
      check,
    });
  const read = async (): Promise<OriginalManualJournalEntry[]> => {
    const s = store();
    return s.exclusive(scope, async () => s.manualRequests(scope));
  };
  return {
    store,
    consumer,
    read,
    command,
    run,
    inspect,
    bind,
    active: (v: boolean) => {
      active = v;
    },
    reportLoss: (v: boolean) => {
      loseReport = v;
    },
    fresh: (v: boolean) => {
      fresh = v;
    },
  };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

// @lat: [[cloud-workspace-tests#Original manual consumer retained report replay]]
it("reopens actual SQLite after a lost report and resends the result without executing again", async () => {
  const f = fixture();
  f.reportLoss(true);
  await expect(f.consumer().poll()).rejects.toThrow("lost report reply");
  expect(await f.read()).toEqual([
    { binding, status: "completed", reported: false },
  ]);
  expect(f.run).toHaveBeenCalledTimes(1);
  f.reportLoss(false);
  f.fresh(false);
  await f.consumer().poll();
  expect(await f.read()).toEqual([
    { binding, status: "completed", reported: true },
  ]);
  expect(f.run).toHaveBeenCalledTimes(1);
  expect(
    f.command.mock.calls.filter(([c]) => c.action === "complete"),
  ).toHaveLength(2);
});

// @lat: [[cloud-workspace-tests#Original manual consumer nonblocking execution]]
it("releases the cross-process replica lock during long execution and ignores simultaneous local polls", async () => {
  const f = fixture();
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((r) => {
    started = r;
  });
  f.run.mockImplementationOnce(async () => {
    started();
    await new Promise<void>((r) => {
      release = r;
    });
    return {
      success: true,
      receipt: { ...originalManualNativeRequest(binding), status: "completed" },
    };
  });
  const consumer = f.consumer(),
    running = consumer.poll();
  await entered;
  await consumer.poll();
  // A second actual store acquires the lock while the original Agent peer runs.
  const s = f.store();
  await s.exclusive(scope, async () =>
    expect(s.manualRequests(scope)[0]!.status).toBe("unknown"),
  );
  expect(f.run).toHaveBeenCalledTimes(1);
  release();
  await running;
});

// @lat: [[cloud-workspace-tests#Original manual consumer uncertainty retention]]
it("does not rerun unknown outcomes or dispatch after a lost take", async () => {
  const f = fixture();
  f.run.mockRejectedValueOnce(Error("child disconnected"));
  await f.consumer().poll();
  expect(await f.read()).toEqual([
    { binding, status: "unknown", reported: true },
  ]);
  await f.consumer().poll(); // even a faulty peer repeating fresh permission cannot repeat the effect
  expect(f.run).toHaveBeenCalledTimes(1);
  const other = fixture();
  other.command.mockRejectedValueOnce(Error("lost take"));
  await expect(other.consumer().poll()).rejects.toThrow("lost take");
  other.fresh(false);
  await other.consumer().poll();
  expect(other.run).not.toHaveBeenCalled();
  expect(await other.read()).toEqual([
    { binding, status: "unknown", reported: true },
  ]);
});

// @lat: [[cloud-workspace-tests#Original manual server uncertainty discovery]]
it("recovers a server-unknown request without a native journal only through exact Agent inspection", async () => {
  for (const status of [
    "completed",
    "rejected",
    "unknown",
    "absent",
  ] as const) {
    const f = fixture();
    f.fresh(false);
    f.inspect.mockResolvedValue({
      success: true,
      receipt: { ...originalManualNativeRequest(binding), status },
    });
    await f.consumer().poll();
    expect(f.run).not.toHaveBeenCalled();
    expect(f.inspect).toHaveBeenCalledTimes(1);
    const retained = status === "absent" ? "unknown" : status;
    expect(await f.read()).toEqual([
      { binding, status: retained, reported: true },
    ]);
    expect(f.command).toHaveBeenLastCalledWith({
      action: "complete",
      ...originalManualWireRequest(binding),
      status: retained,
    });
    await f.consumer().poll();
    expect(f.run).not.toHaveBeenCalled();
  }
});

// @lat: [[cloud-workspace-tests#Original manual consumer identity admission]]
it("refuses mismatched source/custody bindings and foreign or replayed take receipts", async () => {
  const f = fixture();
  for (const patch of [
    { owner: "bob" },
    { nativeVersion: "invalid" },
    { sourceDigest: "c".repeat(64) },
    { authorityRevision: 4 },
    { timeZone: "UTC" },
  ]) {
    f.bind.mockResolvedValueOnce({ ...binding, ...patch });
    await expect(f.consumer().poll()).rejects.toThrow("binding unconfirmed");
  }
  f.command.mockResolvedValueOnce({
    fresh: true,
    authorityRevision: 3,
    request: {
      userId: "bob",
      ...originalManualWireRequest(binding),
      status: "unknown",
    },
  });
  await expect(f.consumer().poll()).rejects.toThrow("take receipt unconfirmed");
  f.fresh(false);
  await f.consumer().poll();
  expect(f.run).not.toHaveBeenCalled();
  expect(await f.read()).toEqual([
    { binding, status: "unknown", reported: true },
  ]);
});

// @lat: [[cloud-workspace-tests#Original manual consumer account change fence]]
it("retains uncertainty after account change or stop without reporting a stale completion", async () => {
  for (const kind of ["account", "stop"]) {
    const f = fixture(),
      consumer = f.consumer();
    f.run.mockImplementationOnce(async () => {
      if (kind === "account") f.active(false);
      else consumer.stop();
      return {
        success: true,
        receipt: {
          ...originalManualNativeRequest(binding),
          status: "completed",
        },
      };
    });
    await expect(consumer.poll()).rejects.toThrow(
      kind === "account" ? "account changed" : "consumer stopped",
    );
    expect(await f.read()).toEqual([
      { binding, status: "unknown", reported: false },
    ]);
    expect(
      f.command.mock.calls.filter(([c]) => c.action === "complete"),
    ).toHaveLength(0);
    f.active(true);
    f.fresh(false);
    await f.consumer().poll();
    expect(f.run).toHaveBeenCalledTimes(1);
  }
});

// @lat: [[cloud-workspace-tests#Original manual read-only result recovery]]
it("recovers exact terminal results after restart even when unknown was reported, without dispatching", async () => {
  for (const status of ["completed", "rejected"] as const) {
    const f = fixture();
    f.run.mockRejectedValueOnce(Error("lost child reply"));
    await f.consumer().poll();
    expect(await f.read()).toEqual([
      { binding, status: "unknown", reported: true },
    ]);
    f.fresh(false);
    f.inspect.mockResolvedValue({
      success: true,
      receipt: { ...originalManualNativeRequest(binding), status },
    });
    f.reportLoss(true);
    await expect(f.consumer().poll()).rejects.toThrow("lost report reply");
    expect(await f.read()).toEqual([{ binding, status, reported: false }]);
    f.reportLoss(false);
    await f.consumer().poll();
    expect(await f.read()).toEqual([{ binding, status, reported: true }]);
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.inspect).toHaveBeenCalledTimes(1);
  }
});

// @lat: [[cloud-workspace-tests#Original manual read-only uncertainty fence]]
it("never executes absent or uncertain inspection results and fences account changes before retaining terminal data", async () => {
  const f = fixture();
  f.run.mockRejectedValueOnce(Error("lost child reply"));
  await f.consumer().poll();
  f.fresh(false);
  for (const status of ["absent", "unknown"] as const) {
    f.inspect.mockResolvedValueOnce({
      success: true,
      receipt: { ...originalManualNativeRequest(binding), status },
    });
    await f.consumer().poll();
  }
  f.inspect.mockResolvedValueOnce({
    success: true,
    receipt: {
      ...originalManualNativeRequest(binding),
      owner: "bob",
      status: "completed",
    },
  });
  await f.consumer().poll();
  f.inspect.mockRejectedValueOnce(Error("private failure"));
  await f.consumer().poll();
  expect(await f.read()).toEqual([
    { binding, status: "unknown", reported: true },
  ]);
  f.inspect.mockImplementationOnce(async () => {
    f.active(false);
    return {
      success: true,
      receipt: { ...originalManualNativeRequest(binding), status: "completed" },
    };
  });
  await expect(f.consumer().poll()).rejects.toThrow("account changed");
  expect(await f.read()).toEqual([
    { binding, status: "unknown", reported: true },
  ]);
  expect(f.run).toHaveBeenCalledTimes(1);
});
