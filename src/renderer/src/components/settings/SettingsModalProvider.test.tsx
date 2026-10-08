import { useEffect } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsModalProvider } from "./SettingsModalProvider";
import {
  useSettingsModal,
  type OpenSettingsOptions,
} from "./SettingsModalContext";

vi.mock("./SettingsModal", () => ({
  default: ({
    profile,
    initialSection,
  }: {
    profile?: string;
    initialSection?: string;
  }) => (
    <div role="dialog">
      Native setup: {profile}/{initialSection}
    </div>
  ),
}));
afterEach(cleanup);

function Launcher({
  route,
}: {
  route?: (section?: string, opts?: OpenSettingsOptions) => boolean;
}): React.JSX.Element {
  const { openSettings, registerWorkspaceSettings } = useSettingsModal();
  useEffect(
    () => (route ? registerWorkspaceSettings(route) : undefined),
    [route, registerWorkspaceSettings],
  );
  return (
    <button
      onClick={() => openSettings("language", { profile: "selected-profile" })}
    >
      Settings command
    </button>
  );
}

// @lat: [[cloud-workspace-tests#Canonical Settings command routing]]
it("routes global commands through the workspace without mounting a second local preference editor", () => {
  const route = vi.fn(() => true);
  const { rerender } = render(
    <SettingsModalProvider>
      <Launcher route={route} />
    </SettingsModalProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings command" }));
  expect(route).toHaveBeenCalledWith("language", {
    profile: "selected-profile",
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(
    <SettingsModalProvider>
      <Launcher />
    </SettingsModalProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings command" }));
  expect(route).toHaveBeenCalledOnce();
  expect(screen.getByRole("dialog").textContent).toContain(
    "selected-profile/language",
  );
});

it("keeps explicitly declined profile targets in their original native setup", () => {
  const route = vi.fn(() => false);
  render(
    <SettingsModalProvider>
      <Launcher route={route} />
    </SettingsModalProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings command" }));
  expect(screen.getByRole("dialog").textContent).toContain(
    "selected-profile/language",
  );
});
