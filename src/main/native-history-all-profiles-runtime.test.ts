import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type {
  NativeHistorySync,
  NativeHistoryPorts,
} from "./native-history-sync";
const f = vi.hoisted(() => ({
  home: "",
  data: "",
  epoch: 1,
  mode: "local",
  missingSource: false,
  selected: "research",
  token: "mf_" + "a".repeat(43),
  action: undefined as undefined | ((profile: string) => void),
  resolutions: [] as Array<{ profile: string; field: string }>,
  runs: [] as string[],
  completed: [] as string[],
  bound: new Map<string, string>(),
  changed: undefined as undefined | (() => void),
}));
vi.mock("electron", () => ({ app: { getPath: () => f.data } }));
vi.mock("./installer", () => ({
  get HERMES_HOME() {
    return f.home;
  },
}));
vi.mock("./utils", () => ({
  getActiveProfileNameSync: () => f.selected,
  activeStateDbPath: (profile: string) =>
    join(
      f.home,
      profile === "default" ? "" : "profiles/" + profile,
      "state.db",
    ),
}));
vi.mock("./config", () => ({ getConnectionConfig: () => ({ mode: f.mode }) }));
vi.mock("./mithril-token-store", () => ({
  readCloudAccountToken: () => f.token,
}));
vi.mock("./mithril-token", () => ({
  mithrilApiOrigin: () => "https://api.mithril.fund",
}));
vi.mock("./cloud-chat-runtime", () => ({
  cloudChat: {
    auth: {
      enable: vi.fn(async () => {}),
      nativeContext: async () => ({
        userId: "owner",
        profile: f.selected,
        epoch: f.epoch,
        actor: createHash("sha256").update(f.token).digest("hex"),
      }),
      assertNativeContext: (context: { epoch: number; profile: string }) => {
        if (context.epoch !== f.epoch || context.profile !== f.selected)
          throw Error("retired");
      },
    },
  },
  onCloudChatAccountChanged: (callback: () => void) => {
    f.changed = callback;
    return () => {
      f.changed = undefined;
    };
  },
}));
vi.mock("./repository-kanban-runtime", () => ({
  bindRepositorySource: (
    _directory: string,
    profile: string,
    owner: string,
  ) => {
    if (f.bound.has(profile) && f.bound.get(profile) !== owner)
      throw Error("foreign");
    f.bound.set(profile, owner);
  },
  repositorySourceOwned: (_directory: string, profile: string, owner: string) =>
    f.bound.get(profile) === owner,
}));
vi.mock("./db", () => ({
  getDbConnection: () =>
    f.missingSource
      ? null
      : {
          name: "fixture",
          transaction: (operation: () => unknown) => operation,
        },
}));
vi.mock("./sessions", () => ({
  listSessions: (_limit: number, _offset: number, profile: string) => [
    { id: "original-" + profile, title: profile, model: "original-model" },
  ],
  getSessionMessages: (_id: string, profile: string) => [
    {
      kind: "user",
      id: "message-" + profile,
      timestamp: 1,
      content: "Original " + profile,
    },
  ],
}));
vi.mock("./native-history-deletions", () => ({
  bindNativeHistorySources: vi.fn(),
  nativeHistoryDeletions: () => [],
  prepareNativeHistoryDeletion: vi.fn(),
  acknowledgeNativeHistoryDeletion: vi.fn(),
}));
vi.mock("./remote-history-store", () => ({
  remoteHistoryStore: vi.fn(),
  clearRemoteHistoryStores: vi.fn(),
}));
vi.mock("./native-history-cache", () => ({
  nativeHistoryItemId: (item: { id: string }) => item.id,
  materializeHistoryItem: vi.fn(),
  replaceNativeHistoryCache: vi.fn(),
  setNativeHistoryCacheOwner: vi.fn(),
  clearNativeHistoryCacheOwners: vi.fn(),
  replaceRemoteSessionCache: vi.fn(),
  remoteSessionCacheRevision: vi.fn(),
}));
vi.mock("./native-history-sync", () => ({
  nativeCloudSessionId: (profile: string, id: string) => profile + "-" + id,
  NativeHistorySync: class {
    constructor(private ports: NativeHistoryPorts) {}
    async run(): Promise<Awaited<ReturnType<NativeHistorySync["run"]>>> {
      if (this.ports.cacheRemote)
        expect((await this.ports.context()).profile).toBe(f.selected);
      const context = await this.ports.context();
      f.runs.push(context.profile);
      f.action?.(context.profile);
      const sources = await this.ports.source();
      if (sources.length) {
        expect(sources[0].id).toBe("original-" + context.profile);
        const items = await sources[0].items("fixture-session");
        expect(items[0]).toMatchObject({
          kind: "user",
          content: "Original " + context.profile,
        });
      }
      f.completed.push(context.profile);
      return {
        userId: context.userId,
        synced: 1,
        reconstructed: 0,
        conflicts: [context.profile],
        titleConflicts: [
          {
            sessionId: "session-" + context.profile,
            native: "old",
            cloud: "new",
            cloudRevision: 1,
          },
        ],
        modelConflicts: [],
        visibilityConflicts: [],
        deferred: [],
      };
    }
    async resolveTitle(request: {
      profile: string;
    }): Promise<Awaited<ReturnType<NativeHistorySync["run"]>>> {
      f.resolutions.push({ profile: request.profile, field: "title" });
      return this.run();
    }
    async resolveModel(request: {
      profile: string;
    }): Promise<Awaited<ReturnType<NativeHistorySync["run"]>>> {
      f.resolutions.push({ profile: request.profile, field: "model" });
      return this.run();
    }
    async resolveVisibility(request: {
      profile: string;
    }): Promise<Awaited<ReturnType<NativeHistorySync["run"]>>> {
      f.resolutions.push({ profile: request.profile, field: "visibility" });
      return this.run();
    }
  },
}));
import { serializeNativeHistory } from "./native-history-runtime";
import * as historyRuntime from "./native-history-runtime";
import {
  startAllProfileHistoryReplication,
  synchronizeAllProfileHistories,
  resolveOwnedProfileHistory,
} from "./native-history-all-profiles-runtime";
let stop: (() => void) | undefined;
let directory = "";
beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "mithril-all-history-")));
  f.home = join(directory, "home");
  f.data = join(directory, "data");
  for (const path of [
    f.home,
    f.data,
    join(f.home, "profiles", "research"),
    join(f.home, "profiles", "empty"),
    join(f.home, "profiles", "foreign"),
  ])
    mkdirSync(path, { recursive: true });
  f.bound = new Map([["foreign", "another-owner"]]);
  f.resolutions = [];
  f.runs = [];
  f.completed = [];
  f.epoch = 1;
  f.mode = "local";
  f.missingSource = false;
  f.selected = "research";
  f.action = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        user: { id: "owner" },
        via: "api_token",
        scopes: ["chat:read", "chat:write"],
      }),
    ),
  );
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});
// @lat: [[cloud-workspace-tests#All-profile history background source coverage]]
it("visits every owned original profile with fixed API contexts without changing the selected profile", async () => {
  stop = startAllProfileHistoryReplication();
  await vi.waitFor(() =>
    expect(f.completed).toEqual(["default", "empty", "research"]),
  );
  expect(f.selected).toBe("research");
  expect(f.bound.get("foreign")).toBe("another-owner");
  expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([url]) => url === "https://api.mithril.fund/v1/me"),
  ).toBe(true);
});
// @lat: [[cloud-workspace-tests#All-profile history account retirement]]
it("stops the captured pass when account context changes and never proceeds to another source", async () => {
  f.action = () => {
    f.epoch++;
  };
  stop = startAllProfileHistoryReplication();
  await vi.waitFor(() => expect(f.runs).toEqual(["default"]));
  expect(f.completed).toEqual([]);
});
// @lat: [[cloud-workspace-tests#All-profile history source replacement]]
it("refuses a replaced original profile directory before accepting its result", async () => {
  f.action = (profile) => {
    if (profile === "research") {
      renameSync(
        join(f.home, "profiles", profile),
        join(f.home, "profiles", "retired-research"),
      );
      mkdirSync(join(f.home, "profiles", profile));
    }
  };
  stop = startAllProfileHistoryReplication();
  await vi.waitFor(() =>
    expect(f.runs).toEqual(["default", "empty", "research"]),
  );
  expect(f.completed).toEqual(["default", "empty"]);
});
// @lat: [[cloud-workspace-tests#All-profile history source failure isolation]]
it("retains a failed source and continues archiving other owned profiles", async () => {
  f.action = (profile) => {
    if (profile === "default")
      throw Error("Original source temporarily unavailable");
  };
  stop = startAllProfileHistoryReplication();
  await vi.waitFor(() => expect(f.completed).toEqual(["empty", "research"]));
  expect(f.runs).toEqual(["default", "empty", "research"]);
  expect(f.bound.get("default")).toBe("owner");
  expect(f.selected).toBe("research");
});

// @lat: [[cloud-workspace-tests#All-profile history lifecycle retirement]]
it("does not accept in-flight source results or visit another profile after shutdown", async () => {
  f.action = () => stop?.();
  stop = startAllProfileHistoryReplication();
  await vi.waitFor(() => expect(f.runs).toEqual(["default"]));
  expect(f.completed).toEqual([]);
  expect(f.changed).toBeUndefined();
});

// @lat: [[cloud-workspace-tests#All-profile history native connection isolation]]
it("does not read original local history through a remote connection", async () => {
  f.mode = "ssh";
  stop = startAllProfileHistoryReplication();
  await vi.waitFor(() => expect(f.changed).toBeTypeOf("function"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(f.runs).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#Shared history journal serialization]]
it("serializes foreground and background journal work and releases the lane after failure", async () => {
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = serializeNativeHistory(async () => {
    events.push("first-start");
    await gate;
    events.push("first-finish");
    throw Error("retained intent");
  });
  const failure = expect(first).rejects.toThrow("retained intent");
  const second = serializeNativeHistory(async () => {
    events.push("second-start");
  });
  await vi.waitFor(() => expect(events).toEqual(["first-start"]));
  release();
  await failure;
  await second;
  expect(events).toEqual(["first-start", "first-finish", "second-start"]);
});

// @lat: [[cloud-workspace-tests#All-profile history review coverage]]
it("aggregates profile-labelled conflicts without changing the selected profile", async () => {
  const result = await synchronizeAllProfileHistories();
  expect(result.synced).toBe(3);
  expect(result.titleConflicts.map((row) => row.profile)).toEqual([
    "default",
    "empty",
    "research",
  ]);
  expect(f.selected).toBe("research");
});

// @lat: [[cloud-workspace-tests#All-profile history resolution ownership]]
it("routes reviewed metadata to its owned source and rejects foreign or retired owners", async () => {
  const request = {
    userId: "owner",
    profile: "default",
    sessionId: "session-default",
    native: "old",
    cloud: "new",
    cloudRevision: 1,
    choice: "cloud" as const,
  };
  for (const field of ["title", "model", "visibility"] as const)
    await resolveOwnedProfileHistory(request, field);
  expect(f.resolutions).toEqual(
    ["title", "model", "visibility"].map((field) => ({
      profile: "default",
      field,
    })),
  );
  expect(f.selected).toBe("research");
  await expect(
    resolveOwnedProfileHistory({ ...request, profile: "foreign" }, "title"),
  ).rejects.toThrow("Owned history profile unavailable");
  await expect(
    resolveOwnedProfileHistory(
      { ...request, userId: "another-owner" },
      "title",
    ),
  ).rejects.toThrow("History owner changed");
  expect(f.resolutions).toHaveLength(3);
});

// @lat: [[cloud-workspace-tests#All-profile history remote compatibility]]
it("preserves remote history and resolution through the existing authenticated adapter", async () => {
  f.mode = "ssh";
  const report = {
    userId: "owner",
    synced: 0,
    reconstructed: 1,
    conflicts: [],
    titleConflicts: [],
    modelConflicts: [],
    visibilityConflicts: [],
    deferred: [],
  };
  const sync = vi
    .spyOn(historyRuntime, "synchronizeNativeHistory")
    .mockResolvedValue(report);
  const resolve = vi
    .spyOn(historyRuntime, "resolveNativeHistoryTitle")
    .mockResolvedValue(report);
  expect(await synchronizeAllProfileHistories()).toMatchObject({
    reconstructed: 1,
  });
  const request = {
    userId: "owner",
    profile: "research",
    sessionId: "remote",
    native: "old",
    cloud: "new",
    cloudRevision: 1,
    choice: "cloud" as const,
  };
  await resolveOwnedProfileHistory(request, "title");
  expect(sync).toHaveBeenCalledOnce();
  expect(resolve).toHaveBeenCalledWith(request);
  expect(f.runs).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#All-profile history stale resolution retirement]]
it("rejects a reviewed result when the captured account retires during resolution", async () => {
  f.action = () => {
    f.epoch++;
  };
  await expect(
    resolveOwnedProfileHistory(
      {
        userId: "owner",
        profile: "default",
        sessionId: "session-default",
        native: "old",
        cloud: "new",
        cloudRevision: 1,
        choice: "cloud",
      },
      "title",
    ),
  ).rejects.toThrow("retired");
  expect(f.completed).toEqual([]);
});

// @lat: [[cloud-workspace-tests#All-profile history empty installation reconstruction]]
it("retains selected-profile remote reconstruction when the original home is absent", async () => {
  rmSync(f.home, { recursive: true });
  f.selected = "default";
  f.missingSource = true;
  const report = await synchronizeAllProfileHistories();
  expect(report.synced).toBe(1);
  expect(report.deferred).toEqual([]);
  expect(f.completed).toEqual(["default"]);
});
