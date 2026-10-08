import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RestoreIntent } from "@mithril/workspace/archive-client";
import SettingsModal from "./SettingsModal";
const actions = vi.hoisted(() => ({
  backup: vi.fn(),
  prepare: vi.fn(),
  commit: vi.fn(),
  open: vi.fn(),
  legacyBackup: vi.fn(),
  legacyImport: vi.fn(),
  migrate: vi.fn(),
}));
vi.mock("../useI18n", async () => {
  const { settingsTranslator } =
    await import("@mithril/workspace/desktop-settings");
  return { useI18n: () => ({ locale: "en", t: settingsTranslator("en") }) };
});
vi.mock("./useSettingsData", () => ({
  useSettingsData: (profile?: string) => ({
    profile,
    backingUp: false,
    backupResult: null,
    importing: false,
    importResult: null,
    handleBackup: actions.legacyBackup,
    handleImport: actions.legacyImport,
    openclawFound: false,
    migrationDismissed: false,
    handleMigrate: actions.migrate,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud Data modal account custody]]
it("reopens the same prepared archive across tabs without replaying native actions", async () => {
  let pending: RestoreIntent | null = null;
  const pendingRead = vi.fn(async () => pending);
  actions.prepare.mockImplementation(async () => {
    pending = {
      owner: "alice",
      operationId: "restore-operation",
      baselineId: "baseline",
      digest: "a".repeat(64),
      snapshotId: "snapshot",
      phase: "prepared",
    };
    return pending;
  });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      openExternal: actions.open,
      cloudWorkspace: {
        status: async () => ({ userId: "alice", enabled: true }),
        archive: {
          pending: pendingRead,
          exportAndSave: actions.backup,
          chooseAndPrepare: actions.prepare,
          commit: actions.commit,
        },
        executionReview: {
          list: async () => ({
            schemaVersion: 1,
            userId: "alice",
            datasetGeneration: 1,
            entries: [],
            nextAfter: null,
          }),
          review: vi.fn(),
        },
      },
    },
  });
  render(
    <SettingsModal
      open
      profile="selected-profile"
      initialSection="data"
      onClose={() => {}}
    />,
  );
  const exportButton = screen.getByRole("button", { name: "Export backup" });
  await waitFor(() => expect(exportButton).toBeEnabled());
  expect(actions.backup).not.toHaveBeenCalled();
  expect(actions.prepare).not.toHaveBeenCalled();
  expect(actions.commit).not.toHaveBeenCalled();
  fireEvent.click(exportButton);
  await waitFor(() =>
    expect(actions.backup).toHaveBeenCalledExactlyOnceWith("alice"),
  );
  const chooseButton = screen.getByRole("button", { name: "Choose backup" });
  await waitFor(() => expect(chooseButton).toBeEnabled());
  fireEvent.click(chooseButton);
  const restoreButton = await screen.findByRole("button", {
    name: "Restore backup",
  });
  expect(restoreButton).toBeDisabled();
  expect(actions.prepare).toHaveBeenCalledExactlyOnceWith("alice");
  const identity = pending;
  fireEvent.click(screen.getByRole("button", { name: "Community" }));
  expect(document.querySelector(".settings-link-grid")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Data" }));
  expect(
    await screen.findByRole("button", { name: "Restore backup" }),
  ).toBeDisabled();
  expect(pending).toBe(identity);
  expect(pendingRead).toHaveBeenLastCalledWith("alice");
  expect(actions.backup).toHaveBeenCalledTimes(1);
  expect(actions.prepare).toHaveBeenCalledTimes(1);
  for (const action of [
    actions.commit,
    actions.open,
    actions.legacyBackup,
    actions.legacyImport,
    actions.migrate,
  ])
    expect(action).not.toHaveBeenCalled();
});
