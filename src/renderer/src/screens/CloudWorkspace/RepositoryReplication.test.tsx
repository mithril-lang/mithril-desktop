import {
  cleanup,
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
      },
    },
  });
});
afterEach(cleanup);
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
