import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsModalProvider } from "../../components/settings/SettingsModalProvider";
import { useSettingsModal } from "../../components/settings/SettingsModalContext";
import { useWorkspaceSettingsRoute } from "./useWorkspaceSettingsRoute";
vi.mock("../../components/settings/SettingsModal", () => ({
  default: () => <div role="dialog">Bootstrap settings</div>,
}));
afterEach(cleanup);
function Workspace({
  activeProfile,
  open,
}: {
  activeProfile: string;
  open: () => void;
}): React.JSX.Element {
  const { openSettings, registerWorkspaceSettings } = useSettingsModal();
  const request = useWorkspaceSettingsRoute(
    registerWorkspaceSettings,
    activeProfile,
    open,
  );
  return (
    <>
      <output aria-label="Settings target">
        {request.profile}/{request.section}/{request.nonce}
      </output>
      <button
        onClick={() => openSettings("connection", { profile: "other-agent" })}
      >
        Other agent settings
      </button>
      <button onClick={() => openSettings("appearance")}>
        Current agent settings
      </button>
    </>
  );
}
// @lat: [[cloud-workspace-tests#Explicit profile Settings routing]]
it("opens another profile through the canonical workspace and keeps its target independent of Chat", () => {
  const open = vi.fn();
  const { rerender } = render(
    <SettingsModalProvider>
      <Workspace activeProfile="chat-agent" open={open} />
    </SettingsModalProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Other agent settings" }));
  expect(screen.getByLabelText("Settings target").textContent).toBe(
    "other-agent/connection/1",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(open).toHaveBeenCalledOnce();
  rerender(
    <SettingsModalProvider>
      <Workspace activeProfile="new-chat-agent" open={open} />
    </SettingsModalProvider>,
  );
  expect(screen.getByLabelText("Settings target").textContent).toBe(
    "other-agent/connection/1",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Current agent settings" }),
  );
  expect(screen.getByLabelText("Settings target").textContent).toBe(
    "new-chat-agent/appearance/2",
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});
