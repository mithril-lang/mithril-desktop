import { describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  openExternal: vi.fn(async (): Promise<void> => {}),
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "0.8.0-preview.2" },
  ipcMain: {
    handle: (
      channel: string,
      handler: (...args: unknown[]) => unknown,
    ): void => {
      electronState.handlers.set(channel, handler);
    },
  },
  shell: { openExternal: electronState.openExternal },
}));
vi.mock("../updater-log", () => ({ updaterLogger: { info: () => {} } }));

import type { AppUpdater } from "electron-updater";
import {
  macManualUpdateReason,
  offeredUpdateVersion,
  setupManualUpdater,
  scheduleUpdateChecks,
  updateFeedAvailable,
} from "./updater";

// Verbatim `codesign -dv` output of the two bundles that produced the
// "Update failed" in updater.log: the installed 0.7.10 (Apple Development
// certificate) and the downloaded 0.7.12 (ad-hoc).
const SIGNED_0_7_10 =
  "Executable=/Applications/Kotoba.app/Contents/MacOS/Kotoba\nIdentifier=cloud.kotoba.desktop\nFormat=app bundle with Mach-O thin (arm64)\nCodeDirectory v=20500 size=448 flags=0x10000(runtime) hashes=3+7 location=embedded\nSignature size=9093\nTimestamp=Sep 23, 2026 at 7:45:30\nInfo.plist entries=38\nTeamIdentifier=3A5CBTEBFP\nRuntime Version=26.5.0\nSealed Resources version=2 rules=13 files=78\nInternal requirements count=1 size=184\n";
const ADHOC_0_7_12 =
  "Executable=/Applications/Kotoba.app/Contents/MacOS/Kotoba\nIdentifier=cloud.kotoba.desktop\nFormat=app bundle with Mach-O thin (arm64)\nCodeDirectory v=20400 size=301 flags=0x2(adhoc) hashes=3+3 location=embedded\nSignature=adhoc\nInfo.plist entries=38\nTeamIdentifier=not set\nSealed Resources version=2 rules=13 files=78\nInternal requirements count=0 size=12\n";

describe("offeredUpdateVersion", () => {
  it("offers nothing when the feed is not newer than the running build", () => {
    // electron-updater still returns the feed's info in this case; reporting
    // it as an update made the download fail with "Please check update first".
    expect(
      offeredUpdateVersion({
        isUpdateAvailable: false,
        updateInfo: { version: "0.8.0-preview.3" },
      }),
    ).toBeNull();
  });

  it("offers the feed version when an update is available", () => {
    expect(
      offeredUpdateVersion({
        isUpdateAvailable: true,
        updateInfo: { version: "0.8.0-preview.4" },
      }),
    ).toBe("0.8.0-preview.4");
  });

  it("offers nothing when the check returned no result", () => {
    expect(offeredUpdateVersion(null)).toBeNull();
  });
});

describe("updateFeedAvailable", () => {
  it("needs app-update.yml next to the app resources", () => {
    const exists = vi.fn((path: string) => path === "/r/app-update.yml");
    expect(updateFeedAvailable("/r", exists)).toBe(true);
    expect(updateFeedAvailable("/elsewhere", exists)).toBe(false);
  });
});

describe("macManualUpdateReason", () => {
  it("routes an ad-hoc bundle to the download page", () => {
    expect(macManualUpdateReason("darwin", () => ADHOC_0_7_12)).toBe(
      "ad-hoc code signature",
    );
  });

  it("keeps Squirrel for a bundle with a certificate identity", () => {
    expect(macManualUpdateReason("darwin", () => SIGNED_0_7_10)).toBeNull();
  });

  it("treats an unreadable signature as manual, with the error", () => {
    expect(
      macManualUpdateReason("darwin", () => {
        throw new Error("codesign exited 1: code object is not signed at all");
      }),
    ).toBe(
      "code signature unreadable (codesign exited 1: code object is not signed at all)",
    );
  });

  it("does not read as signed when the output is empty", () => {
    expect(macManualUpdateReason("darwin", () => "")).toBe(
      "code signature details not recognised",
    );
  });

  it("treats TeamIdentifier=not set without the adhoc line as manual", () => {
    expect(
      macManualUpdateReason(
        "darwin",
        () => "Signature size=10\nTeamIdentifier=not set\n",
      ),
    ).toBe("no TeamIdentifier");
  });

  it("never reads the signature off macOS", () => {
    const read = vi.fn(() => ADHOC_0_7_12);
    expect(macManualUpdateReason("win32", read)).toBeNull();
    expect(macManualUpdateReason("linux", read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not poll an unpublished feed for an ad-hoc preview", async () => {
    electronState.handlers.clear();
    electronState.openExternal.mockClear();
    const checkForUpdates = vi.fn();
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates,
    } as unknown as AppUpdater;

    setupManualUpdater(updater, "ad-hoc code signature", () => null);

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(checkForUpdates).not.toHaveBeenCalled();
    const check = electronState.handlers.get("check-for-updates") as
      | (() => Promise<string>)
      | undefined;
    await expect(check?.()).resolves.toBe("0.8.0-preview.2");
    expect(electronState.openExternal).toHaveBeenCalledWith(
      "https://app.mithril.fund/download/",
    );
    expect(checkForUpdates).not.toHaveBeenCalled();
  });
});

describe("scheduled update checks", () => {
  // @lat: [[cloud-workspace-tests#Periodic packaged update checks]]
  it("checks after startup, recovers failures and cancels on quit", async () => {
    vi.useFakeTimers();
    try {
      const check = vi
        .fn()
        .mockRejectedValueOnce(Error("offline"))
        .mockResolvedValue(null);
      const stop = scheduleUpdateChecks(check);
      await vi.advanceTimersByTimeAsync(4999);
      expect(check).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
      expect(check).toHaveBeenCalledTimes(2);
      stop();
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  // @lat: [[cloud-workspace-tests#Pending update check disposal]]
  it("does not overlap a pending check or rearm it after quit", async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const check = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const stop = scheduleUpdateChecks(check);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
      expect(check).toHaveBeenCalledTimes(1);
      stop();
      finish();
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
      expect(check).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
