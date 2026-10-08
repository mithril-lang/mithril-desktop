import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { join } from "path";
import { tmpdir } from "os";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
  readdir,
} from "fs/promises";
import { randomUUID } from "crypto";
import type { DeviceCareHistoryEntry } from "../../shared/device-care";
import { getAppLocale } from "../locale";
import { DeviceCareStorage } from "./storage";
import { DeviceCareProtection } from "./protection";
import { DeviceCareMonitor } from "./monitor";
import { DeviceCareQuarantine } from "./quarantine";
import { CONSUMER_MAC, DeviceCareVendor } from "./vendor";
import { installedStorageSkill } from "./storage-skill";

export function registerDeviceCareIpc(
  getMainWindow: () => BrowserWindow | null,
): void {
  const owner = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = getMainWindow();
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Untrusted device-care caller");
    return window;
  };
  const storage = new DeviceCareStorage(
    join(tmpdir(), "hermes-desktop-media"),
    app.getPath("userData"),
  );
  const protection = new DeviceCareProtection();
  let operation: "scan" | "storage" | null = null;
  let scanRecorded: string | null = null;
  const historyPath = join(app.getPath("userData"), "device-care-history.json");
  let historyWrites: Promise<void> = Promise.resolve();
  const readHistory = async (): Promise<DeviceCareHistoryEntry[]> => {
    try {
      const value = JSON.parse(await readFile(historyPath, "utf8"));
      return Array.isArray(value) ? value.slice(-100) : [];
    } catch {
      return [];
    }
  };
  const writeHistory = (
    entry: DeviceCareHistoryEntry | null,
  ): Promise<void> => {
    const next = historyWrites
      .catch(() => undefined)
      .then(async () => {
        const entries = entry
          ? [...(await readHistory()), entry].slice(-100)
          : [];
        const temporary = `${historyPath}.${randomUUID()}.tmp`;
        await mkdir(app.getPath("userData"), { recursive: true });
        await writeFile(temporary, JSON.stringify(entries), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, historyPath);
      });
    historyWrites = next;
    return next;
  };
  const synchronizeScan = async (): Promise<void> => {
    const job = protection.job();
    if (job && job.state !== "running" && job.id !== scanRecorded) {
      scanRecorded = job.id;
      operation = null;
      await writeHistory({
        id: job.id,
        kind: "scan",
        state: job.state,
        observedAt: job.finishedAt!,
        files: job.scannedFiles || 0,
        bytes: 0,
      });
    }
  };
  const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
    await synchronizeScan();
    if (operation) throw new Error("A device-care job is already running");
    operation = "storage";
    try {
      return await run();
    } finally {
      operation = null;
    }
  };
  const monitor = new DeviceCareMonitor(async (root) => {
    await synchronizeScan();
    if (operation) return null;
    operation = "scan";
    try {
      if ((await realpath(root)) !== root)
        throw Error("Selected folder changed");
      return await protection.start(root);
    } catch (error) {
      operation = null;
      throw error;
    }
  });
  const quarantine = new DeviceCareQuarantine(app.getPath("userData"), (path) =>
    protection.verifyCapturedFile(path),
  );
  const vendor = new DeviceCareVendor(app.getPath("userData"));
  const ja = (): boolean => getAppLocale() === "ja";
  ipcMain.handle(
    "device-care-storage-skill-status",
    (event, profile: unknown) => {
      owner(event);
      return installedStorageSkill(profile);
    },
  );
  ipcMain.handle("device-care-run-storage-skill", (event, profile: unknown) => {
    owner(event);
    return exclusive(async () => {
      const skill = await installedStorageSkill(profile);
      if (!skill)
        throw Error("Install the Desktop-enabled diskspace Skill first");
      let root = join(tmpdir(), "hermes-desktop-media");
      try {
        root = await realpath(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const report = await storage.analyze(root, true);
      report.workflow = {
        name: "mithril-diskspace-management",
        version: skill.version,
        state: report.candidates.length
          ? "awaiting-selection"
          : "nothing-eligible",
        cleanupScope: "desktop-generated-media",
      };
      await writeHistory({
        id: randomUUID(),
        kind: "analysis",
        state: report.status,
        observedAt: report.observedAt,
        files: report.files,
        bytes: report.logicalBytes,
      });
      return report;
    });
  });
  ipcMain.handle("device-care-status", (event) => {
    owner(event);
    return protection.status();
  });
  ipcMain.handle("device-care-analyze", async (event, scope: unknown) => {
    const window = owner(event);
    if (scope !== "temp" && scope !== "folder" && scope !== "home")
      throw new Error("Invalid storage scope");
    return exclusive(async () => {
      let root = join(tmpdir(), "hermes-desktop-media");
      if (scope === "home") root = await realpath(app.getPath("home"));
      if (scope === "folder") {
        const selected = await dialog.showOpenDialog(window, {
          title: ja() ? "容量を分析するフォルダー" : "Analyze folder storage",
          properties: ["openDirectory"],
        });
        if (selected.canceled || !selected.filePaths[0]) return null;
        root = await realpath(selected.filePaths[0]);
      } else {
        try {
          root = await realpath(root);
        } catch {
          /* No media files yet. */
        }
      }
      const report = await storage.analyze(root, scope === "temp");
      await writeHistory({
        id: randomUUID(),
        kind: "analysis",
        state: report.status,
        observedAt: report.observedAt,
        files: report.files,
        bytes: report.logicalBytes,
      });
      return report;
    });
  });
  ipcMain.handle("device-care-analyze-node", (event, id: unknown) => {
    owner(event);
    return exclusive(() => storage.analyzeNode(id));
  });
  ipcMain.handle("device-care-cancel-analysis", (event) => {
    owner(event);
    storage.cancel();
  });
  ipcMain.handle("device-care-plan", async (event, ids: unknown) => {
    owner(event);
    await synchronizeScan();
    if (operation) throw new Error("Device care is busy");
    return storage.plan(ids);
  });
  ipcMain.handle(
    "device-care-execute",
    async (event, id: unknown, digest: unknown) => {
      const window = owner(event);
      return exclusive(async () => {
        const receipt = await storage.execute(
          id,
          digest,
          async (plan) => {
            const result = await dialog.showMessageBox(window, {
              type: "warning",
              defaultId: 0,
              cancelId: 0,
              buttons: ja()
                ? ["キャンセル", "ゴミ箱へ移す"]
                : ["Cancel", "Move to Trash"],
              message: ja()
                ? `${plan.items.length} 件の一時ファイルをゴミ箱へ移しますか？`
                : `Move ${plan.items.length} temporary files to Trash?`,
              detail: `${plan.root}\n\n${plan.items.map((item) => item.name).join("\n")}\n\nSHA-256: ${plan.digest}\n\n${ja() ? "ゴミ箱から復元できます。空き容量はゴミ箱を空にするまで増えない場合があります。" : "Restore using the OS Trash. Free space may not increase until Trash is emptied."}`,
            });
            return result.response === 1;
          },
          (path) => shell.trashItem(path),
        );
        await writeHistory({
          id: randomUUID(),
          kind: "cleanup",
          state: receipt.status,
          observedAt: new Date().toISOString(),
          files: receipt.moved,
          bytes: receipt.movedBytes,
        });
        return receipt;
      });
    },
  );
  ipcMain.handle("device-care-start-scan", async (event) => {
    const window = owner(event);
    await synchronizeScan();
    if (operation) throw new Error("Device care is busy");
    operation = "scan";
    try {
      const selected = await dialog.showOpenDialog(window, {
        title: ja()
          ? "ローカルでウイルス検査するフォルダー"
          : "Choose folder for local virus scan",
        properties: ["openDirectory"],
      });
      if (selected.canceled || !selected.filePaths[0]) {
        operation = null;
        return null;
      }
      return await protection.start(await realpath(selected.filePaths[0]));
    } catch (error) {
      operation = null;
      throw error;
    }
  });
  ipcMain.handle("device-care-scan-job", async (event) => {
    owner(event);
    await synchronizeScan();
    return protection.job();
  });
  ipcMain.handle("device-care-cancel-scan", (event) => {
    owner(event);
    protection.cancel();
  });
  ipcMain.handle("device-care-history", async (event) => {
    owner(event);
    await synchronizeScan();
    await historyWrites;
    return readHistory();
  });
  ipcMain.handle("device-care-clear-history", (event) => {
    owner(event);
    return writeHistory(null);
  });
  // Interrupted staging is retained across launches; expose recovery locations without removing them.
  ipcMain.handle("device-care-recovery", async (event) => {
    owner(event);
    const names = await readdir(app.getPath("userData"));
    return names
      .filter(
        (name) =>
          name.startsWith("device-care-recovery-") ||
          name === "device-care-quarantine",
      )
      .map((name) => join(app.getPath("userData"), name));
  });
  ipcMain.handle("device-care-monitor-status", (event) => {
    owner(event);
    return monitor.status();
  });
  ipcMain.handle("device-care-start-monitor", async (event) => {
    const window = owner(event);
    const root = await exclusive(async () => {
      if (!(await protection.status()).available)
        throw Error("ClamAV is not installed");
      const result = await dialog.showOpenDialog(window, {
        title: ja()
          ? "Desktop 起動中に定期検査するフォルダー"
          : "Inspect this folder every minute while Desktop is open",
        properties: ["openDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return realpath(result.filePaths[0]);
    });
    return root ? monitor.start(root) : null;
  });
  ipcMain.handle("device-care-stop-monitor", (event) => {
    owner(event);
    return monitor.stop();
  });
  ipcMain.handle("device-care-review-quarantine", (event) => {
    owner(event);
    return exclusive(() => quarantine.review(protection.job()));
  });
  ipcMain.handle("device-care-quarantine-entries", (event) => {
    owner(event);
    return quarantine.entries();
  });
  ipcMain.handle("device-care-quarantine", async (event, id: unknown) => {
    const window = owner(event);
    return exclusive(() =>
      quarantine.quarantine(id, async (item) => {
        const result = await dialog.showMessageBox(window, {
          type: "warning",
          defaultId: 0,
          cancelId: 0,
          buttons: ja()
            ? ["キャンセル", "暗号化して隔離"]
            : ["Cancel", "Encrypt and quarantine"],
          message: ja()
            ? "検出されたファイルを隔離しますか？"
            : "Quarantine this detected file?",
          detail: `${item.path}\n${item.signature}\nSHA-256: ${item.digest}\n\n${ja() ? "原位置から移し、OS キーリングで保護した暗号化コピーを端末内に保存します。自動実行・アップロードはしません。" : "Remove from its original path and preserve an encrypted local copy protected by the OS keyring. No automatic execution or upload."}`,
        });
        return result.response === 1;
      }),
    );
  });
  ipcMain.handle(
    "device-care-restore-quarantine",
    async (event, id: unknown) => {
      const window = owner(event);
      return exclusive(async () => {
        const result = await dialog.showSaveDialog(window, {
          title: ja()
            ? "隔離ファイルの復元先（既存ファイルは上書きしません）"
            : "Restore quarantine to a new file (no overwrite)",
          defaultPath: "restored-file.bin",
        });
        if (result.canceled || !result.filePath) return false;
        return quarantine.restore(id, result.filePath, async (item) => {
          const answer = await dialog.showMessageBox(window, {
            type: "warning",
            defaultId: 0,
            cancelId: 0,
            buttons: ja() ? ["キャンセル", "復元"] : ["Cancel", "Restore"],
            message: ja()
              ? "検出された内容を復元しますか？"
              : "Restore the detected content?",
            detail: `${item.name}\n${item.signature}\n${result.filePath}\nSHA-256: ${item.digest}\n\n${ja() ? "有害な内容を含む可能性があります。復元しても実行はしません。暗号化コピーは保全します。" : "This may contain harmful content. Restoration does not execute it. The encrypted copy is retained."}`,
          });
          return answer.response === 1;
        });
      });
    },
  );
  ipcMain.handle("device-care-vendor-status", (event) => {
    owner(event);
    return vendor.status();
  });
  ipcMain.handle(
    "device-care-configure-vendor",
    (event, region: unknown, token: unknown) => {
      owner(event);
      return vendor.configure(region, token);
    },
  );
  ipcMain.handle("device-care-disconnect-vendor", (event) => {
    owner(event);
    return vendor.disconnect();
  });
  ipcMain.handle("device-care-vendor-alerts", (event) => {
    owner(event);
    return vendor.alerts();
  });
  ipcMain.handle("device-care-open-consumer", async (event) => {
    owner(event);
    if (!(await vendor.status()).consumerInstalled)
      throw Error("Trend Micro Antivirus for Mac is not installed");
    const error = await shell.openPath(CONSUMER_MAC);
    if (error) throw Error("Unable to open Trend Micro Antivirus");
  });
  app.on("before-quit", () => {
    monitor.stop();
    protection.cancel();
    storage.dispose();
  });
}
