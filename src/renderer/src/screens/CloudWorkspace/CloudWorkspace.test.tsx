import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CloudWorkspace from "./CloudWorkspace";
import type { WorkspaceRecord } from "@mithril/workspace/protocol";
const preferences = vi.hoisted(() => ({
  setTheme: vi.fn(),
  setLocale: vi.fn(),
}));
vi.mock("../../components/ThemeProvider", () => ({
  useTheme: () => ({ setTheme: preferences.setTheme }),
}));
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ setLocale: preferences.setLocale }),
}));

const enable = vi.fn(async () => ({ userId: "user-a", enabled: true }));
const disable = vi.fn(async () => undefined);
const snapshot = vi.fn(async () => ({
  schemaVersion: 1,
  userId: "user-a",
  cursor: 0,
  records: [] as WorkspaceRecord[],
}));
let accountChanged: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  enable.mockReset().mockResolvedValue({ userId: "user-a", enabled: true });
  snapshot.mockReset().mockResolvedValue({
    schemaVersion: 1,
    userId: "user-a",
    cursor: 0,
    records: [],
  });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      cloudWorkspace: {
        catalog: vi.fn(async () => []),
        enable,
        disable,
        getSnapshot: snapshot,
        applyOperations: vi.fn(),
        history: vi.fn(),
      },
      onCloudWorkspaceAccountChanged: (callback: () => void) => {
        accountChanged = callback;
        return () => undefined;
      },
      fetchRegistry: vi.fn(async () => ({
        skills: [],
        mcps: [],
        agents: [],
        workflows: [],
        plugins: [],
      })),
    },
  });
});
afterEach(cleanup);

describe("Desktop shared workspace", () => {
  // @lat: [[discover#Original Discover#Shared marketplace]]
  it("opens the original five-tab marketplace and table detail from main-owned API document ports", async () => {
    const api = window.hermesAPI.cloudWorkspace;
    api.discoverDocuments = {
      fetchRegistry: vi.fn(async () => ({
        skills: [
          {
            id: "original",
            registry: "mithril" as const,
            name: "Original API skill",
            description: "Full metadata",
          },
        ],
        mcps: [],
        agents: [],
        workflows: [],
        plugins: [],
      })),
      fetchRegistryDetail: vi.fn(async () => ({
        markdown:
          "| Name | Value |\n| --- | --- |\n| Original | Complete table |",
      })),
    };
    api.repository = {
      page: vi.fn(async () => ({
        schemaVersion: 1 as const,
        userId: "user-a",
        documents: [],
        nextAfter: null,
      })),
      apply: vi.fn(),
    };
    render(<CloudWorkspace profile="default" initialView="discover" />);
    await screen.findByText("Original API skill");
    expect(screen.getByRole("button", { name: /^MCPs/ })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Original API skill"));
    await screen.findByRole("table");
    expect(
      screen.getByRole("cell", { name: "Complete table" }),
    ).toBeInTheDocument();
    expect(api.applyOperations).not.toHaveBeenCalled();
    expect(api.repository.apply).not.toHaveBeenCalled();
  });
  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Shared renderer consent]]
  it("mounts shared views and automatically reads through the existing scoped main adapter", async () => {
    render(<CloudWorkspace profile="default" />);
    for (const name of [
      "Discover",
      "Office",
      "Kanban",
      "Projects",
      "Capability",
      "Memory",
      "Settings",
      "Profile",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));
    await screen.findByText(/Cloud synced/);
    expect(snapshot).toHaveBeenCalled();
    expect(
      window.hermesAPI.cloudWorkspace.applyOperations,
    ).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(snapshot.mock.calls.length).toBeGreaterThan(2));
    expect(disable).not.toHaveBeenCalled();
  });

  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Renderer account reset]]
  it("rechecks identity after account and profile changes without replaying edits", async () => {
    const { rerender } = render(<CloudWorkspace profile="default" />);
    await screen.findByText(/Cloud synced/);
    accountChanged();
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(2));
    await screen.findByText(/Cloud synced/);
    rerender(<CloudWorkspace profile="another-profile" />);
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(3));
    await screen.findByText(/Cloud synced/);
    expect(
      window.hermesAPI.cloudWorkspace.applyOperations,
    ).not.toHaveBeenCalled();
  });
});

// @lat: [[cloud-workspace#Cloud workspace#Rich repository implementation in progress#Acknowledged appearance and language observation (draft)]]
it("applies cloud language and appearance through original native providers without execution", async () => {
  snapshot.mockResolvedValue({
    schemaVersion: 1,
    userId: "user-a",
    cursor: 1,
    records: [
      {
        id: "prefs",
        kind: "preferences",
        revision: 1,
        data: { theme: "dark", locale: "ja" },
        deleted: false,
        updatedAt: 1,
      },
    ],
  });
  render(<CloudWorkspace profile="default" />);
  await waitFor(() =>
    expect(preferences.setTheme).toHaveBeenCalledWith("dark"),
  );
  expect(preferences.setLocale).toHaveBeenCalledWith("ja");
  expect(
    window.hermesAPI.cloudWorkspace.applyOperations,
  ).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Explicit native reconnection recovery]]
it("opens the original account card only after explicit reconnect and resumes after authorization", async () => {
  enable.mockRejectedValue(
    new Error(
      "Cloud connection requires explicit workspace:read authorization. Existing tokens are never upgraded automatically.",
    ),
  );
  Object.assign(window.hermesAPI, {
    getMithrilAccount: vi.fn(async () => null),
    getMithrilFirstRunState: vi.fn(async () => ({ protection: "keychain" })),
    mithrilDeviceLogin: vi.fn(),
    onMithrilDeviceCode: vi.fn(() => () => undefined),
  });
  Object.assign(window.hermesAPI.cloudWorkspace, {
    repository: {
      page: vi.fn(async () => ({
        schemaVersion: 1,
        userId: "user-a",
        documents: [],
        nextAfter: null,
      })),
      apply: vi.fn(),
    },
    discoverDocuments: {
      fetchRegistry: vi.fn(async () => ({
        skills: [],
        mcps: [],
        agents: [],
        workflows: [],
        plugins: [],
      })),
      fetchRegistryDetail: vi.fn(),
    },
  });
  render(<CloudWorkspace profile="default" initialView="discover" />);
  await screen.findByText(/Cloud connection requires explicit workspace:read/);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(window.hermesAPI.mithrilDeviceLogin).not.toHaveBeenCalled();
  expect(snapshot).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Reconnect" }),
  );
  await screen.findByRole("dialog", { name: "Reconnect to Mithril" });
  expect(
    screen.getByRole("button", { name: "Sign in with browser" }),
  ).toBeInTheDocument();
  expect(window.hermesAPI.getMithrilAccount).toHaveBeenCalledWith("default");
  expect(window.hermesAPI.mithrilDeviceLogin).not.toHaveBeenCalled();
  enable.mockResolvedValue({ userId: "user-a", enabled: true });
  accountChanged();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(snapshot).toHaveBeenCalled());
  expect(
    window.hermesAPI.cloudWorkspace.applyOperations,
  ).not.toHaveBeenCalled();
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Transient reconnect never requests authorization]]
it("keeps transient network reconnection on the existing transport without an account prompt", async () => {
  enable.mockRejectedValue(
    new Error(
      "Workspace network unavailable; reconnect to check pending changes",
    ),
  );
  render(<CloudWorkspace profile="default" />);
  await screen.findByText(/Workspace network unavailable/);
  fireEvent.click(
    screen.getByRole("button", { name: "Reconnect" }),
  );
  await waitFor(() => expect(enable).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(snapshot).not.toHaveBeenCalled();
});
