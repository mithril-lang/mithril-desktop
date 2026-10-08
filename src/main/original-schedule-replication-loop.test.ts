import { afterEach, expect, it, vi } from "vitest";
import { OriginalScheduleReplicationLoop } from "./original-schedule-replication-loop";
afterEach(() => vi.useRealTimers());
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
// @lat: [[cloud-workspace-tests#Automatic schedule lifecycle polling]]
it("starts one screen-independent poller and releases it on shutdown", async () => {
  vi.useFakeTimers();
  const engine = {
    sync: vi.fn(async () => ({ status: "synced" as const })),
    stop: vi.fn(),
  };
  const create = vi.fn(async () => engine),
    unsubscribe = vi.fn();
  const loop = new OriginalScheduleReplicationLoop(
    { create, changed: () => unsubscribe },
    100,
  );
  loop.start();
  loop.start();
  await flush();
  expect(create).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(engine.sync).toHaveBeenCalledTimes(2);
  loop.stop();
  await vi.advanceTimersByTimeAsync(500);
  expect(create).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
// @lat: [[cloud-workspace-tests#Automatic schedule stale lifecycle cancellation]]
it("discards an engine created for a stale identity and immediately resumes the current identity", async () => {
  vi.useFakeTimers();
  let changed = (): void => {};
  let release!: (v: typeof old) => void;
  const old = {
    sync: vi.fn(async () => ({ status: "synced" as const })),
    stop: vi.fn(),
  };
  const fresh = {
    sync: vi.fn(async () => ({ status: "synced" as const })),
    stop: vi.fn(),
  };
  const create = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(fresh);
  const loop = new OriginalScheduleReplicationLoop({
    create,
    changed: (cb) => {
      changed = cb;
      return () => {};
    },
  });
  loop.start();
  changed();
  release(old);
  await flush();
  expect(old.sync).not.toHaveBeenCalled();
  expect(old.stop).toHaveBeenCalledTimes(1);
  expect(fresh.sync).toHaveBeenCalledTimes(1);
  loop.stop();
});
// @lat: [[cloud-workspace-tests#Automatic schedule interrupted lifecycle recovery]]
it("stops in-flight work on account change, avoids concurrent runs and retries failures on the next poll", async () => {
  vi.useFakeTimers();
  let changed = (): void => {},
    finish!: () => void;
  const old = {
    sync: vi.fn(
      () =>
        new Promise<{ status: "synced" }>((resolve) => {
          finish = () => resolve({ status: "synced" });
        }),
    ),
    stop: vi.fn(),
  };
  const fresh = {
    sync: vi
      .fn()
      .mockRejectedValueOnce(Error("offline"))
      .mockResolvedValue({ status: "synced" }),
    stop: vi.fn(),
  };
  const create = vi.fn().mockResolvedValueOnce(old).mockResolvedValue(fresh);
  const loop = new OriginalScheduleReplicationLoop(
    {
      create,
      changed: (cb) => {
        changed = cb;
        return () => {};
      },
    },
    100,
  );
  loop.start();
  await flush();
  changed();
  await vi.advanceTimersByTimeAsync(300);
  expect(create).toHaveBeenCalledTimes(1);
  expect(old.stop).toHaveBeenCalledTimes(1);
  finish();
  await flush();
  expect(fresh.sync).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(fresh.sync).toHaveBeenCalledTimes(2);
  loop.stop();
});
