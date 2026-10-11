import { expect, it, vi } from "vitest";
import { workspaceEntry } from "./workspace-entry";
const cache = (
  userId: string | null,
  ready: boolean,
): import("../../shared/local-workspace").LocalWorkspaceSyncStatus => ({
  userId,
  ready,
  phase: "offline" as const,
  pending: 1,
  conflicts: [],
  lastSyncedAt: 1,
  message: "",
});
// @lat: [[local-workspace#Local SQLite workspace#Offline application entry]]
it("enters a previously checked cached workspace without waiting for a live account request", async () => {
  const getMithrilAccount = vi.fn(async () => {
    throw Error("network unavailable");
  });
  const enable = vi.fn(async () => ({ userId: "alice", enabled: true }));
  const api = {
    getMithrilAccount,
    cloudWorkspace: {
      enable,
      localSync: {
        status: async () => cache("alice", true),
        synchronize: vi.fn(),
        resolve: vi.fn(),
        onChanged: vi.fn(),
      },
    },
  };
  expect(await workspaceEntry(api, "default")).toEqual({
    allowed: true,
    live: false,
  });
  expect(getMithrilAccount).not.toHaveBeenCalled();
  expect(enable).toHaveBeenCalledOnce();
});
it("requires live identity for a new cache and refuses signed-out or revoked cached access", async () => {
  for (const state of [cache(null, true), cache("alice", false)]) {
    const api = {
      getMithrilAccount: vi.fn(async () => ({ live: false, userId: null })),
      cloudWorkspace: {
        enable: vi.fn(),
        localSync: {
          status: async () => state,
          synchronize: vi.fn(),
          resolve: vi.fn(),
          onChanged: vi.fn(),
        },
      },
    };
    expect(await workspaceEntry(api, "default")).toEqual({
      allowed: false,
      live: false,
    });
  }
});
