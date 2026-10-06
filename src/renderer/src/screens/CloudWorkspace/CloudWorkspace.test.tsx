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
