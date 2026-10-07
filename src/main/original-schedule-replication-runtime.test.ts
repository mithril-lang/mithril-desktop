import type { OriginalScheduleReplicationPorts } from "./original-schedule-replication";
vi.mock("./mithril-token-store", () => ({ readMithrilToken: () => f.token }));
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  sync: vi.fn(),
  selected: vi.fn(),
  check: vi.fn(),
  stop: vi.fn(),
  tokenGuard: vi.fn(),
  bind: vi.fn(),
  token: "synthetic-account-a",
  timeZone: "UTC",
  ports: [] as OriginalScheduleReplicationPorts[],
  parseCreate: vi.fn(),
  parseTransition: vi.fn(),
  manual: vi.fn(),
  manualStop: vi.fn(),
  manualPorts: [] as {
    command: unknown;
    run: (input: unknown) => Promise<unknown>;
    inspect: (input: unknown) => Promise<unknown>;
    serialize: unknown;
  }[],
  manualCommand: vi.fn(),
  sourceRun: vi.fn(),
  sourceInspect: vi.fn(),
}));
vi.mock("electron", () => ({ app: { getPath: () => "/test/user-data" } }));
vi.mock("./cloud-workspace-runtime", () => ({
  cloudWorkspace: {
    status: async () => ({ userId: "alice" }),
    enable: async () => {},
    nativeContext: async () => ({
      userId: "alice",
      profile: "default",
      epoch: 1,
      actor: "actor",
    }),
    assertNativeContext: f.tokenGuard,
    repositoryPage: vi.fn(),
    repositoryApply: vi.fn(),
    repositoryHistory: vi.fn(),
    scheduleResources: {},
    originalScheduleCustody: vi.fn(),
    originalScheduleManual: f.manualCommand,
  },
  onCloudWorkspaceAccountChanged: () => () => {},
}));
vi.mock("./config", () => ({
  getConnectionConfig: () => ({ mode: "local" }),
  getConfigValue: () => f.timeZone,
}));
vi.mock("./utils", () => ({
  getActiveProfileNameSync: () => "default",
  profileHome: () => "/test/home",
}));
vi.mock("./installer", () => ({ HERMES_PYTHON: "/test/python" }));
vi.mock("./repository-kanban-runtime", () => ({
  bindRepositorySource: f.bind,
}));
vi.mock("./cronjobs", () => ({
  readOriginalCronSource: vi.fn(),
  prepareOriginalCronSource: f.parseCreate,
  prepareOriginalCronTransition: f.parseTransition,
  restoreOriginalCronSource: vi.fn(),
  prepareOriginalCronExecution: vi.fn(),
  bindOriginalCronExecution: vi.fn(),
  runOriginalCronSource: f.sourceRun,
  inspectOriginalCronSource: f.sourceInspect,
}));
vi.mock("./original-schedule-replication", () => ({
  OriginalScheduleReplication: class {
    constructor(ports: OriginalScheduleReplicationPorts) {
      f.ports.push(ports);
    }
    manualConsumer(ports: (typeof f.manualPorts)[number]): {
      poll: typeof f.manual;
      stop: typeof f.manualStop;
    } {
      f.manualPorts.push(ports);
      return { poll: f.manual, stop: f.manualStop };
    }
    sync = f.sync;
    assertScreenScope = f.check;
    assertSelectedExecution = f.selected;
    stop = f.stop;
  },
}));
import {
  runOriginalScheduleScreen,
  startOriginalScheduleReplication,
} from "./original-schedule-replication-runtime";
beforeEach(() => {
  vi.clearAllMocks();
  f.token = "synthetic-account-a";
  f.timeZone = "UTC";
  f.ports = [];
  f.manualPorts = [];
  f.manual.mockResolvedValue(undefined);
  f.sync.mockResolvedValue({ status: "synced" });
  f.check.mockResolvedValue(undefined);
  f.selected.mockResolvedValue(undefined);
});
const flush = async (): Promise<void> => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
// @lat: [[cloud-workspace-tests#Original Schedules operation lane]]
it("serializes original operations behind the same synchronization lane and publishes committed edits", async () => {
  let release!: () => void;
  const events: string[] = [];
  const first = runOriginalScheduleScreen(
    "default",
    async () => {
      events.push("first");
      await new Promise<void>((r) => {
        release = r;
      });
      return { success: true };
    },
    "edit",
  );
  const second = runOriginalScheduleScreen(
    "default",
    async () => {
      events.push("second");
      return [];
    },
    "read",
  );
  await flush();
  expect(events).toEqual(["first"]);
  release();
  await first;
  await second;
  expect(events).toEqual(["first", "second"]);
  expect(f.sync).toHaveBeenCalledTimes(3);
  expect(f.bind).toHaveBeenCalledWith(
    "/test/user-data/mithril-original-schedules/source-owners",
    "default",
    "alice",
  );
});
// @lat: [[cloud-workspace-tests#Original Schedules uncertain admission refusal]]
it("refuses uncertain synchronization, stale profiles and passive execution before Native actions", async () => {
  const action = vi.fn(async () => ({ success: true }));
  f.sync.mockResolvedValueOnce({
    status: "conflict",
    reason: "both-sources-changed",
  });
  await expect(
    runOriginalScheduleScreen("default", action, "edit"),
  ).rejects.toThrow("synchronization requires review");
  f.check.mockRejectedValueOnce(Error("Schedule profile changed"));
  await expect(
    runOriginalScheduleScreen("other", action, "read"),
  ).rejects.toThrow("profile changed");
  f.selected.mockRejectedValueOnce(Error("Run on selected device"));
  await expect(
    runOriginalScheduleScreen("default", action, "execute"),
  ).rejects.toThrow("selected device");
  expect(action).not.toHaveBeenCalled();
});
// @lat: [[cloud-workspace-tests#Original Schedules committed write recovery]]
it("retains a committed edit's acknowledgement after network loss and releases the lane for later work", async () => {
  f.sync
    .mockResolvedValueOnce({ status: "synced" })
    .mockRejectedValueOnce(Error("offline"));
  const action = vi.fn(async () => ({ success: true }));
  await expect(
    runOriginalScheduleScreen("default", action, "edit"),
  ).resolves.toEqual({ success: true });
  expect(action).toHaveBeenCalledTimes(1);
  await expect(
    runOriginalScheduleScreen("default", async () => [], "read"),
  ).resolves.toEqual([]);
  expect(f.stop).toHaveBeenCalledTimes(2);
});

// @lat: [[cloud-workspace-tests#Original Schedules mirror read recovery]]
it("keeps the owner-bound original inventory readable during a sync outage or conflict", async () => {
  for (const failure of ["offline", "conflict"]) {
    if (failure === "offline") f.sync.mockRejectedValueOnce(Error("offline"));
    else f.sync.mockResolvedValueOnce({ status: "conflict" });
    await expect(
      runOriginalScheduleScreen("default", async () => ["original"], "read"),
    ).resolves.toEqual(["original"]);
  }
});
// @lat: [[cloud-workspace-tests#Original Schedules queued identity isolation]]
it("discards a queued action after the signed-in account changes while another action is running", async () => {
  let release!: () => void;
  const first = runOriginalScheduleScreen(
    "default",
    async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return [];
    },
    "read",
  );
  const action = vi.fn(async () => ({ success: true }));
  const queued = runOriginalScheduleScreen("default", action, "edit");
  const refused = expect(queued).rejects.toThrow(
    "queued schedule action discarded",
  );
  await flush();
  f.token = "synthetic-account-b";
  release();
  await expect(first).rejects.toThrow("queued schedule action discarded");
  await refused;
  expect(action).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#Original Schedules background lane coordination]]
it("queues the background poll behind an in-flight screen action instead of entering the same replica lock concurrently", async () => {
  let release!: () => void;
  const operation = runOriginalScheduleScreen(
    "default",
    async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return [];
    },
    "read",
  );
  await flush();
  const stop = startOriginalScheduleReplication();
  try {
    await flush();
    expect(f.sync).toHaveBeenCalledTimes(1);
    release();
    await operation;
    await flush();
    await vi.waitFor(() => expect(f.sync).toHaveBeenCalledTimes(3));
  } finally {
    stop();
  }
});

// @lat: [[cloud-workspace-tests#Original parser mailbox runtime scope]]
it("calls the original Cron preparation ports under the captured account profile and timezone", async () => {
  await runOriginalScheduleScreen("default", async () => [], "read");
  const ports = f.ports.at(-1)!;
  const request = {
    ...ports.scope,
    operationId: "original-operation",
    input: { schedule: "every 5m" },
  };
  const preparation = {
    ...request,
    job: { id: "012345abcdef" },
    sourceText: '{"id":"012345abcdef"}',
  };
  f.parseCreate.mockResolvedValue({ success: true, preparation });
  expect(await ports.parser.prepareCreate(request)).toEqual(preparation);
  expect(f.parseCreate).toHaveBeenCalledWith(request);
  await expect(
    ports.parser.prepareCreate({ ...request, owner: "bob" }),
  ).rejects.toThrow("identity changed");
  expect(f.parseCreate).toHaveBeenCalledTimes(1);
  const transition = {
    ...ports.scope,
    operationId: "transition-operation",
    action: "pause" as const,
    source: { id: "012345abcdef" },
  };
  f.parseTransition.mockResolvedValue({
    success: true,
    preparation: {
      ...transition,
      job: { ...transition.source, enabled: false },
    },
  });
  expect(await ports.parser.prepareTransition(transition)).toEqual({
    ...transition,
    job: { ...transition.source, enabled: false },
  });
  expect(f.parseTransition).toHaveBeenCalledWith(transition);
  f.parseCreate.mockImplementationOnce(async () => {
    f.timeZone = "Asia/Tokyo";
    return { success: true, preparation };
  });
  await expect(ports.parser.prepareCreate(request)).rejects.toThrow(
    "profile changed",
  );
});

// @lat: [[cloud-workspace-tests#Original manual lifecycle wiring]]
it("starts manual consumption independently and leaves original screen operations available during a long run", async () => {
  let release!: () => void;
  f.manual.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const stop = startOriginalScheduleReplication();
  try {
    await vi.waitFor(() => expect(f.manual).toHaveBeenCalledTimes(1));
    const ports = f.manualPorts[0]!;
    const request = {
      owner: "alice",
      profile: "default",
      operationId: "operation",
      jobId: "one",
      expectedVersion: "a".repeat(64),
    };
    await ports.run(request);
    expect(f.sourceRun).toHaveBeenCalledWith(request, expect.any(Function));
    await ports.inspect(request);
    expect(f.sourceInspect).toHaveBeenCalledWith(request, expect.any(Function));
    const action = vi.fn(async () => []);
    await runOriginalScheduleScreen("default", action, "read");
    expect(action).toHaveBeenCalledTimes(1);
    stop();
    expect(f.manualStop).toHaveBeenCalled();
    release();
    await flush();
  } finally {
    stop();
  }
});
