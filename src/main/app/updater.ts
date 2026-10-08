import { app, ipcMain, shell, type BrowserWindow } from "electron";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { AppUpdater } from "electron-updater";
import { dirname, join, resolve } from "path";
import { updaterLogger } from "../updater-log";

interface UpdaterDeps {
  getMainWindow: () => BrowserWindow | null;
}

let autoUpdaterInstance: AppUpdater | null = null;

// Where a person installs a new build by hand. The same origin as the
// electron-builder.yml `publish.url` feed; it redirects to the current brand's
// download page, which links the per-arch .dmg files.
const DOWNLOAD_PAGE_URL = "https://app.mithril.fund/download/";

/** Keep long-running clients current without overlapping provider requests. */
export function scheduleUpdateChecks(
  check: () => Promise<unknown>,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const run = async (): Promise<void> => {
    try {
      await check();
    } catch {
      // The updater emits its existing error event; a later check can recover.
    } finally {
      if (!stopped) timer = setTimeout(() => void run(), 4 * 60 * 60 * 1000);
    }
  };
  timer = setTimeout(() => void run(), 5000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/**
 * electron-updater reads its feed from `<resources>/app-update.yml`, which
 * electron-builder writes into packaged release builds. A bundle assembled
 * without it (a local `--dir` build) cannot check for updates; without this
 * guard every startup logged ENOENT and the sidebar showed "Update failed".
 */
export function updateFeedAvailable(
  resourcesPath: string = process.resourcesPath,
  exists: (path: string) => boolean = existsSync,
): boolean {
  return exists(join(resourcesPath, "app-update.yml"));
}

/**
 * Why macOS auto-update cannot be used for this bundle, or null when it can.
 *
 * Squirrel.Mac only installs a successor that satisfies the RUNNING bundle's
 * designated requirement. An ad-hoc signature's requirement is a cdhash pin,
 * so no other build can ever satisfy it: every install ends in "Code signature
 * … did not pass validation" (updater.log, 0.7.10 → 0.7.12). Until the app
 * ships with a Developer ID identity, the upgrade path is the download page.
 *
 * A signature that cannot be read is treated as manual too: opening the
 * download page is always safe, a Squirrel install that cannot validate is not.
 */
export function macManualUpdateReason(
  platform: NodeJS.Platform,
  readSignature: () => string,
): string | null {
  if (platform !== "darwin") return null;
  let details: string;
  try {
    details = readSignature();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `code signature unreadable (${message})`;
  }
  if (/^Signature=adhoc$/m.test(details)) return "ad-hoc code signature";
  if (/^TeamIdentifier=not set$/m.test(details)) return "no TeamIdentifier";
  if (!/^TeamIdentifier=\S+$/m.test(details)) {
    return "code signature details not recognised";
  }
  return null;
}

/** `codesign -dv` output for the running .app bundle. codesign prints the
 *  details on stderr, so both streams are returned; a non-zero exit throws. */
function readBundleSignature(): string {
  const bundle = resolve(app.getPath("exe"), "..", "..", "..");
  const result = spawnSync("/usr/bin/codesign", ["-dv", bundle], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`codesign exited ${result.status}: ${output.trim()}`);
  }
  return output;
}

/**
 * The version to offer, or null when the running build is current.
 * `checkForUpdates()` resolves with the FEED's version even when it is not
 * newer than ours, so returning `updateInfo.version` unconditionally made an
 * up-to-date app report "update available"; the follow-up download then
 * failed with electron-updater's "Please check update first".
 */
export function offeredUpdateVersion(
  result: {
    isUpdateAvailable?: boolean;
    updateInfo?: { version?: string };
  } | null,
): string | null {
  if (!result?.isUpdateAvailable) return null;
  return result.updateInfo?.version || null;
}

function updatePreferencesPath(): string {
  return join(app.getPath("userData"), "update-preferences.json");
}

function getAutoUpgradeEnabled(): boolean {
  const file = updatePreferencesPath();
  if (!existsSync(file)) {
    return true;
  }

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      autoUpgrade?: unknown;
    };
    return parsed.autoUpgrade !== false;
  } catch {
    return true;
  }
}

function setAutoUpgradeEnabled(enabled: boolean): void {
  const file = updatePreferencesPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ autoUpgrade: enabled }, null, 2)}\n`);
}

export function setupUpdater({ getMainWindow }: UpdaterDeps): void {
  ipcMain.handle("get-app-version", () => app.getVersion());
  ipcMain.handle("get-auto-upgrade-enabled", () => getAutoUpgradeEnabled());
  ipcMain.handle("set-auto-upgrade-enabled", (_event, enabled: boolean) => {
    setAutoUpgradeEnabled(enabled);
    if (autoUpdaterInstance) {
      autoUpdaterInstance.autoDownload = enabled;
    }
    return true;
  });

  const isPortableBuild = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (!app.isPackaged || isPortableBuild) {
    autoUpdaterInstance = null;
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {});
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as {
    autoUpdater: AppUpdater;
  };

  autoUpdaterInstance = autoUpdater;
  autoUpdater.logger = updaterLogger;

  const manualReason = macManualUpdateReason(
    process.platform,
    readBundleSignature,
  );
  if (manualReason) {
    setupManualUpdater(autoUpdater, manualReason, getMainWindow);
    return;
  }

  if (!updateFeedAvailable()) {
    updaterLogger.info(
      "No app-update.yml in this bundle (not a published build); updates are disabled",
    );
    autoUpdaterInstance = null;
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {});
    return;
  }

  autoUpdater.autoDownload = getAutoUpgradeEnabled();
  autoUpdater.autoInstallOnAppQuit = true;

  let updateChecked = false;
  autoUpdater.on("update-available", (info) => {
    updateChecked = true;
    getMainWindow()?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    getMainWindow()?.webContents.send("update-download-progress", {
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on("update-downloaded", () => {
    getMainWindow()?.webContents.send("update-downloaded");
  });
  autoUpdater.on("error", (err) => {
    getMainWindow()?.webContents.send("update-error", err.message);
  });

  ipcMain.handle("check-for-updates", async () => {
    try {
      updateChecked = false;
      const result = await autoUpdater.checkForUpdates();
      const version = offeredUpdateVersion(result);
      updateChecked = version !== null;
      return version;
    } catch {
      return null;
    }
  });
  ipcMain.handle("download-update", async () => {
    try {
      // downloadUpdate() throws "Please check update first" unless a check
      // found an update; the startup check may not have finished (or found
      // nothing), so make sure one has before downloading.
      if (!updateChecked) {
        const result = await autoUpdater.checkForUpdates();
        if (offeredUpdateVersion(result) === null) {
          getMainWindow()?.webContents.send(
            "update-error",
            "No update is available",
          );
          return false;
        }
        updateChecked = true;
      }
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getMainWindow()?.webContents.send("update-error", message);
      return false;
    }
  });
  ipcMain.handle("install-update", () => {
    updaterLogger.info(
      "Restart requested by user — calling quitAndInstall(isSilent=false, isForceRunAfter=true)",
    );
    autoUpdater.quitAndInstall(false, true);
  });

  const stopUpdateChecks = scheduleUpdateChecks(() =>
    autoUpdater.checkForUpdates(),
  );
  app.once("before-quit", stopUpdateChecks);
}

/**
 * Ad-hoc previews have no usable Squirrel channel: a successor cannot satisfy
 * the running bundle's cdhash-pinned requirement. Do not poll an unpublished
 * feed or emit a startup error. Every explicit update action opens the verified
 * download page instead.
 */
export function setupManualUpdater(
  autoUpdater: AppUpdater,
  reason: string,
  getMainWindow: () => BrowserWindow | null,
): void {
  updaterLogger.info(
    `macOS auto-install disabled: ${reason}; updates go through ${DOWNLOAD_PAGE_URL}`,
  );
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const openDownloadPage = async (): Promise<void> => {
    updaterLogger.info(`Opening ${DOWNLOAD_PAGE_URL} for a manual update`);
    await shell.openExternal(DOWNLOAD_PAGE_URL);
    getMainWindow()?.webContents.send("update-available", {
      version: app.getVersion(),
      releaseNotes: "Manual preview downloads",
    });
  };

  ipcMain.handle("check-for-updates", async () => {
    await openDownloadPage();
    return app.getVersion();
  });
  ipcMain.handle("download-update", async () => {
    try {
      await openDownloadPage();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getMainWindow()?.webContents.send("update-error", message);
      return false;
    }
  });
  ipcMain.handle("install-update", () => openDownloadPage());
}
