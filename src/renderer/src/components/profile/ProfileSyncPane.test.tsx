import "fake-indexeddb/auto";
import {
  render,
  waitFor,
  fireEvent,
  screen,
  act,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
import ProfileSyncPane from "./ProfileSyncPane";

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("mithril-repository");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
function installApi(userId: string | null = "alice"): {
  status: ReturnType<typeof vi.fn>;
  enable: ReturnType<typeof vi.fn>;
  page: ReturnType<typeof vi.fn>;
  legacy: ReturnType<typeof vi.fn>;
  accountChanged: () => void;
} {
  const status = vi.fn(async () => ({ userId, enabled: !!userId }));
  const enable = vi.fn(async () => ({ userId, enabled: !!userId }));
  const page = vi.fn(async () => ({
    schemaVersion: 1,
    userId,
    documents: [
      {
        collection: "profile",
        id: "profile-metadata-fatha",
        body: {
          format: "mithril-profile-metadata-v1",
          profile: "fatha",
          resourceId: "profile-metadata-" + "a".repeat(64),
          manifest: "b".repeat(64),
          digest: "c".repeat(64),
          size: 12,
        },
        deleted: false,
        revision: 1,
        updatedAt: 1,
      },
    ],
    nextAfter: null,
  }));
  const legacy = vi.fn();
  let accountChanged = (): void => {};
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      cloudWorkspace: { status, enable, repository: { page, apply: vi.fn() } },
      onCloudWorkspaceAccountChanged: vi.fn((callback: () => void) => {
        accountChanged = callback;
        return () => {};
      }),
      getAgentSyncStatus: legacy,
      getLinkedAgentId: legacy,
      syncAgents: legacy,
    },
  });
  return {
    status,
    enable,
    page,
    legacy,
    accountChanged: (): void => accountChanged(),
  };
}
describe("ProfileSyncPane canonical workspace", () => {
  // @lat: [[cloud-workspace-tests#Shared profile Sync signed out]]
  it("shows sign-in only when the actual workspace identity is absent", async () => {
    const api = installApi(null);
    render(<ProfileSyncPane profile="fatha" />);
    await screen.findByText("agents.syncSignInHint");
    expect(screen.queryByText("agents.syncNow")).toBeNull();
    expect(api.legacy).not.toHaveBeenCalled();
  });
  // @lat: [[cloud-workspace-tests#Shared profile Sync target outcome]]
  it("verifies original profile metadata through the canonical API and never uses retired agent sync", async () => {
    const api = installApi();
    render(<ProfileSyncPane profile="fatha" />);
    await screen.findByText("Verified");
    expect(screen.queryByText("agents.syncSignInHint")).toBeNull();
    const before = api.page.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() =>
      expect(api.page.mock.calls.length).toBeGreaterThan(before),
    );
    expect(api.legacy).not.toHaveBeenCalled();
  });
  // @lat: [[cloud-workspace-tests#Canonical profile Sync transient failure]]
  it("retains retry after an identity transport failure without misreporting signed out", async () => {
    const api = installApi();
    api.status.mockRejectedValueOnce(Error("Connection unavailable"));
    render(<ProfileSyncPane profile="fatha" />);
    await screen.findByText("Connection unavailable");
    expect(screen.queryByText("agents.syncSignInHint")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "agents.syncNow" }));
    await screen.findByText("Verified");
    expect(api.legacy).not.toHaveBeenCalled();
  });
  // @lat: [[cloud-workspace-tests#Canonical profile Sync stale identity]]
  it("discards a late identity after an account-change refresh", async () => {
    const api = installApi("bob");
    let resolve!: (value: { userId: string; enabled: boolean }) => void;
    api.status.mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    render(<ProfileSyncPane profile="fatha" />);
    await act(async () => api.accountChanged());
    await screen.findByText("Verified");
    const before = api.page.mock.calls.length;
    await act(async () => resolve({ userId: "alice", enabled: true }));
    expect(api.page.mock.calls.length).toBe(before);
    expect(api.legacy).not.toHaveBeenCalled();
  });
});
