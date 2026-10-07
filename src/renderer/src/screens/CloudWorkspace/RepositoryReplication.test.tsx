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
beforeEach(() => {
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
        repository: {},
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
