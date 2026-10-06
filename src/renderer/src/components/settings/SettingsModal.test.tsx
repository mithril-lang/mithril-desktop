import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SettingsModal from "./SettingsModal";
const actions = vi.hoisted(() => ({
  backup: vi.fn(),
  imported: vi.fn(),
  migrate: vi.fn(),
  open: vi.fn(),
}));
vi.mock("../useI18n", async () => {
  const { settingsTranslator } =
    await import("@mithril/workspace/desktop-settings");
  return { useI18n: () => ({ t: settingsTranslator("en") }) };
});
vi.mock("./useSettingsData", () => ({
  useSettingsData: (profile?: string) => {
    const [backupResult, setBackupResult] = useState<string | null>(null);
    return {
      profile,
      backingUp: false,
      backupResult,
      importing: false,
      importResult: null,
      handleBackup: () => {
        actions.backup(profile);
        setBackupResult("Backup created successfully");
      },
      handleImport: actions.imported,
      openclawFound: false,
      migrationDismissed: false,
      handleMigrate: actions.migrate,
    };
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("keeps original Data results across native tabs and runs only explicit profile-owned actions", async () => {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { openExternal: actions.open },
  });
  render(
    <SettingsModal
      open
      profile="selected-profile"
      initialSection="data"
      onClose={() => {}}
    />,
  );
  expect(actions.backup).not.toHaveBeenCalled();
  expect(actions.imported).not.toHaveBeenCalled();
  expect(actions.migrate).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Export Backup", exact: true }),
  );
  expect(actions.backup).toHaveBeenCalledExactlyOnceWith("selected-profile");
  await screen.findByText("Backup created successfully");
  fireEvent.click(
    screen.getByRole("button", { name: "Community", exact: true }),
  );
  expect(document.querySelector(".settings-link-grid")).toBeTruthy();
  expect(actions.open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Data", exact: true }));
  expect(screen.getByText("Backup created successfully")).toBeInTheDocument();
  expect(actions.backup).toHaveBeenCalledTimes(1);
});
