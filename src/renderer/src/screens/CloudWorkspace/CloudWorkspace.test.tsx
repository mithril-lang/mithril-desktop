import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CloudWorkspace from "./CloudWorkspace";

const enable = vi.fn(async () => ({ userId: "user-a", enabled: true }));
const disable = vi.fn(async () => undefined);
const snapshot = vi.fn(async () => ({
  schemaVersion: 1,
  userId: "user-a",
  cursor: 0,
  records: [],
}));
let accountChanged: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      cloudWorkspace: {
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
  it("mounts eight real shared views with no automatic user data access, then binds explicit main consent", async () => {
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
    expect(enable).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Enable.*sync/i }));
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));
    await screen.findByText(/Sync enabled for this account/);
    expect(snapshot).toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Disconnect and clear cached workspace/i,
      }),
    );
    await waitFor(() => expect(disable).toHaveBeenCalledTimes(1));
  });

  // @lat: [[cloud-workspace-tests#Cloud workspace tests#Renderer account reset]]
  it("resets shared cached owner on main account change and profile change without resending edits", async () => {
    const { rerender } = render(<CloudWorkspace profile="default" />);
    fireEvent.click(screen.getByRole("button", { name: /Enable.*sync/i }));
    await screen.findByText(/Sync enabled for this account/);
    accountChanged();
    await waitFor(() =>
      expect(
        screen.queryByText(/Sync enabled for this account/),
      ).not.toBeInTheDocument(),
    );
    const previousCalls = snapshot.mock.calls.length;
    rerender(<CloudWorkspace profile="another-profile" />);
    expect(
      screen.getByRole("button", { name: /Enable.*sync/i }),
    ).toBeInTheDocument();
    expect(snapshot.mock.calls.length).toBe(previousCalls);
  });
});
