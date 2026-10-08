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
  const ja = (): boolean => getAppLocale() === "ja";
  ipcMain.handle("device-care-status", (event) => {
    owner(event);
    return protection.status();
  });
  ipcMain.handle("device-care-analyze", async (event, scope: unknown) => {
    const window = owner(event);
    if (scope !== "temp" && scope !== "folder")
      throw new Error("Invalid storage scope");
    return exclusive(async () => {
      let root = join(tmpdir(), "hermes-desktop-media");
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
      .filter((name) => name.startsWith("device-care-recovery-"))
      .map((name) => join(app.getPath("userData"), name));
  });
  app.on("before-quit", () => {
    protection.cancel();
    storage.cancel();
  });
}
