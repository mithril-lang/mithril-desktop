import "fake-indexeddb/auto";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RepositoryReplication from "./RepositoryReplication";
const preferences = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("./useWorkspacePreferences", () => ({
  useWorkspacePreferences: () => preferences.apply,
}));
vi.mock("@mithril/workspace/repository-react", () => ({
  useRepositoryReplication: () => ({
    notice: "",
    conflicts: [],
    deferred: 0,
    resolve: vi.fn(),
  }),
}));
const conflict = {
  sessionId: "native_source",
  native: "端末で編集した名前",
  cloud: "同期された名前",
  cloudRevision: 7,
};
const sync = vi.fn();
const resolve = vi.fn();
const resolveModel = vi.fn();
const resolveVisibility = vi.fn();
let changed: () => void;
let owner: string;
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("mithril-repository");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  vi.clearAllMocks();
  owner = "alice";
  sync.mockImplementation(async () => ({
    userId: owner,
    conflicts: owner === "alice" ? [conflict.sessionId] : [],
    titleConflicts: owner === "alice" ? [conflict] : [],
    deferred: [],
  }));
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      onCloudWorkspaceAccountChanged: (callback: () => void) => {
        changed = callback;
        return () => {};
      },
      cloudWorkspace: {
        status: async () => ({ userId: owner }),
        enable: async () => ({ userId: owner }),
        repository: {
          page: vi.fn(async () => ({
            schemaVersion: 1,
            userId: owner,
            documents: [],
            nextAfter: null,
          })),
          apply: vi.fn(),
        },
        replica: {},
      },
      cloudChat: {
        syncNativeHistory: sync,
        resolveNativeHistoryTitle: resolve,
        resolveNativeHistoryModel: resolveModel,
        resolveNativeHistoryVisibility: resolveVisibility,
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// @lat: [[cloud-workspace-tests#Automatic background connection recovery]]
it("resumes background synchronization after transient startup failure without another sign-in", async () => {
  vi.useFakeTimers();
  const status = vi.spyOn(window.hermesAPI.cloudWorkspace, "status");
  const enable = vi.spyOn(window.hermesAPI.cloudWorkspace, "enable");
  status.mockRejectedValueOnce(Error("Network unavailable"));
  const { unmount } = render(
    <RepositoryReplication profile="default" locale="en" enabled />,
  );
  await act(async () => {});
  expect(sync).not.toHaveBeenCalled();
  expect(enable).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(status).toHaveBeenCalledTimes(2);
  expect(enable).toHaveBeenCalledOnce();
  expect(sync).toHaveBeenCalledOnce();
  expect(screen.queryByText("Connection unavailable. Try again.")).toBeNull();
  unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(status).toHaveBeenCalledTimes(2);
});

it("does not retry missing authority or enable a stale account after an in-flight status read", async () => {
  vi.useFakeTimers();
  const originalStatus = window.hermesAPI.cloudWorkspace.status;
  const status = vi.spyOn(window.hermesAPI.cloudWorkspace, "status");
  const enable = vi.spyOn(window.hermesAPI.cloudWorkspace, "enable");
  status.mockRejectedValueOnce(
    Error("Cloud connection requires explicit workspace:read authorization"),
  );
  const first = render(
    <RepositoryReplication profile="default" locale="en" enabled />,
  );
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(status).toHaveBeenCalledOnce();
  expect(enable).not.toHaveBeenCalled();
  first.unmount();

  let finish!: (
    value: Awaited<ReturnType<typeof window.hermesAPI.cloudWorkspace.status>>,
  ) => void;
  const oldStatus = await originalStatus();
  status.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<RepositoryReplication profile="default" locale="en" enabled />);
  await act(async () => {});
  owner = "bob";
  await act(async () => {
    changed();
  });
  expect(enable).toHaveBeenCalledOnce();
  await act(async () => {
    finish(oldStatus);
  });
  expect(enable).toHaveBeenCalledOnce();
  expect(screen.queryByText(conflict.native)).toBeNull();
});
it("serializes online retries and cancels pending recovery on unmount", async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  const status = vi
    .spyOn(window.hermesAPI.cloudWorkspace, "status")
    .mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
  const { unmount } = render(
    <RepositoryReplication profile="default" locale="en" enabled />,
  );
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(status).toHaveBeenCalledOnce();
  await act(async () => {
    fail(Error("Offline"));
  });
  unmount();
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(status).toHaveBeenCalledOnce();
  expect(sync).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#Title conflict review interaction]]
it("shows both names and sends only the reviewed metadata choice", async () => {
  resolve.mockResolvedValue({ userId: "alice" });
  render(<RepositoryReplication profile="default" locale="ja" enabled />);
  expect(await screen.findByText(conflict.native)).toBeTruthy();
  expect(screen.getByText(conflict.cloud)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "同期された名前を使用" }));
  await waitFor(() =>
    expect(resolve).toHaveBeenCalledWith({
      ...conflict,
      userId: "alice",
      profile: "default",
      choice: "cloud",
    }),
  );
});
it("hides old-owner names and ignores a late failed resolution", async () => {
  let reject: (error: Error) => void;
  resolve.mockImplementation(
    () =>
      new Promise((_ok, no) => {
        reject = no;
      }),
  );
  render(<RepositoryReplication profile="default" locale="ja" enabled />);
  await screen.findByText(conflict.native);
  fireEvent.click(screen.getByRole("button", { name: "同期された名前を使用" }));
  owner = "bob";
  changed();
  await waitFor(() => expect(screen.queryByText(conflict.native)).toBeNull());
  reject!(Error("alice private resolution failure"));
  await waitFor(() =>
    expect(screen.queryByText("alice private resolution failure")).toBeNull(),
  );
});

// @lat: [[cloud-workspace-tests#Model conflict review interaction]]
it("reviews models in the existing sync notice and suppresses old-owner results", async () => {
  const model = { ...conflict, native: "native-model", cloud: "cloud-model" };
  sync.mockImplementation(async () => ({
    userId: owner,
    conflicts: owner === "alice" ? [model.sessionId] : [],
    modelConflicts: owner === "alice" ? [model] : [],
    deferred: [],
  }));
  let reject: (error: Error) => void;
  resolveModel.mockImplementation(
    () =>
      new Promise((_ok, no) => {
        reject = no;
      }),
  );
  render(<RepositoryReplication profile="default" locale="ja" enabled />);
  expect(await screen.findByText(model.native)).toBeTruthy();
  expect(screen.getByText(model.cloud)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "同期されたモデル情報を使用" }),
  );
  await waitFor(() =>
    expect(resolveModel).toHaveBeenCalledWith({
      ...model,
      userId: "alice",
      profile: "default",
      choice: "cloud",
    }),
  );
  expect(resolve).not.toHaveBeenCalled();
  owner = "bob";
  changed();
  await waitFor(() => expect(screen.queryByText(model.native)).toBeNull());
  reject!(Error("alice model failure"));
  await waitFor(() =>
    expect(screen.queryByText("alice model failure")).toBeNull(),
  );
});

// @lat: [[cloud-workspace-tests#Chat visibility review interaction]]
it("reviews visibility in the existing notice without exposing a separate history screen", async () => {
  const visibility = { ...conflict, native: "archived", cloud: "visible" };
  sync.mockImplementation(async () => ({
    userId: owner,
    conflicts: [visibility.sessionId],
    visibilityConflicts: [visibility],
    deferred: [],
  }));
  resolveVisibility.mockResolvedValue({ userId: "alice" });
  render(<RepositoryReplication profile="default" locale="ja" enabled />);
  expect(await screen.findByText("チャットの表示状態を確認")).toBeTruthy();
  expect(screen.getByText("非表示")).toBeTruthy();
  expect(screen.getByText("表示")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "同期された表示状態を使用" }),
  );
  await waitFor(() =>
    expect(resolveVisibility).toHaveBeenCalledWith({
      ...visibility,
      userId: "alice",
      profile: "default",
      choice: "cloud",
    }),
  );
  expect(resolve).not.toHaveBeenCalled();
  expect(resolveModel).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#Background presentation synchronization]]
it("applies confirmed cloud settings while no Workspace screen is open and refreshes other-device changes", async () => {
  const timers: { run: () => void; delay: number | undefined }[] = [];
  const originalInterval = globalThis.setInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation((run, delay) => {
    timers.push({ run: run as () => void, delay });
    return originalInterval(run, delay);
  });
  let revision = 1;
  const page = vi.spyOn(window.hermesAPI.cloudWorkspace.repository, "page");
  page.mockImplementation(async () => ({
    schemaVersion: 1,
    userId: owner,
    nextAfter: null,
    documents: [
      {
        collection: "preferences",
        id: "presentation",
        revision,
        deleted: false,
        updatedAt: revision,
        body: {
          schemaVersion: 1,
          scope: "presentation",
          values: { theme: revision === 1 ? "light" : "dark", locale: "ja" },
        },
      },
    ],
  }));
  render(<RepositoryReplication profile="default" locale="en" enabled />);
  await waitFor(() => expect(page).toHaveBeenCalled());
  await waitFor(() =>
    expect(preferences.apply).toHaveBeenLastCalledWith({
      theme: "light",
      locale: "ja",
    }),
  );
  expect(
    window.hermesAPI.cloudWorkspace.repository.apply,
  ).not.toHaveBeenCalled();
  revision = 2;
  await act(async () => {
    const timer = timers.find((timer) => timer.delay === 10000);
    expect(timer).toBeTruthy();
    timer!.run();
  });
  await waitFor(() =>
    expect(preferences.apply).toHaveBeenLastCalledWith({
      theme: "dark",
      locale: "ja",
    }),
  );
  expect(
    window.hermesAPI.cloudWorkspace.repository.apply,
  ).not.toHaveBeenCalled();
});
it("rejects an old-account preference reply after account change", async () => {
  let complete!: (
    value: Awaited<
      ReturnType<typeof window.hermesAPI.cloudWorkspace.repository.page>
    >,
  ) => void;
  vi.spyOn(
    window.hermesAPI.cloudWorkspace.repository,
    "page",
  ).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(<RepositoryReplication profile="default" locale="en" enabled />);
  await waitFor(() => expect(complete).toBeTruthy());
  owner = "bob";
  await act(async () => {
    changed();
  });
  await act(async () => {
    complete({
      schemaVersion: 1,
      userId: "alice",
      nextAfter: null,
      documents: [
        {
          collection: "preferences",
          id: "presentation",
          revision: 1,
          deleted: false,
          updatedAt: 1,
          body: {
            schemaVersion: 1,
            scope: "presentation",
            values: { theme: "light" },
          },
        },
      ],
    });
  });
  expect(preferences.apply).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#Cross-profile history review interaction]]
it("shows the source profile and sends its reviewed choice without switching the selected profile", async () => {
  const other = { ...conflict, profile: "research" };
  sync.mockResolvedValue({
    userId: "alice",
    conflicts: [other.sessionId],
    titleConflicts: [other],
    deferred: [],
  });
  resolve.mockResolvedValue({ userId: "alice" });
  render(<RepositoryReplication profile="default" locale="ja" enabled />);
  expect(
    await screen.findByText("チャット名の変更を確認 · research"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "同期された名前を使用" }));
  await waitFor(() =>
    expect(resolve).toHaveBeenCalledWith({
      ...other,
      userId: "alice",
      choice: "cloud",
    }),
  );
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Terminal background connection errors]]
it.each([
  "Workspace owner changed during connection",
  "Workspace request failed (400)",
  "Invalid workspace schema",
])(
  "does not retry a terminal background connection failure: %s",
  async (message) => {
    vi.useFakeTimers();
    const status = vi
      .spyOn(window.hermesAPI.cloudWorkspace, "status")
      .mockRejectedValue(Error(message));
    const enable = vi.spyOn(window.hermesAPI.cloudWorkspace, "enable");
    render(<RepositoryReplication profile="default" locale="en" enabled />);
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(status).toHaveBeenCalledOnce();
    expect(enable).not.toHaveBeenCalled();
  },
);
