import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { LocalWorkspace } from "../../src/main/local-workspace";
import { CloudWorkspace } from "../../src/main/cloud-workspace";
let online = true;
app.setPath("userData", process.env.WORKSPACE_QA_HOME!);
void app
  .whenReady()
  .then(async () => {
    const cloud = new CloudWorkspace({
      token: () => process.env.WORKSPACE_QA_TOKEN!,
      profile: () => "default",
      origin: () => process.env.WORKSPACE_QA_ENDPOINT!,
      changed: () => {},
      fetch: async (url, init) => {
        if (!online) throw Error("offline");
        return fetch(url, init);
      },
    });
    const local = new LocalWorkspace(
      join(app.getPath("userData"), "workspace.sqlite"),
      () => "qa-account",
      cloud,
      () => {
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.send("qa-changed");
      },
    );
    Object.assign(globalThis, { qaStartupStage: "auth" });
    await local.enable();
    await local.sync();
    if (!local.syncStatus().ready) throw Error(local.syncStatus().message);
    online = false;
    await local.sync();
    Object.assign(globalThis, {
      workspaceQA: {
        local,
        offline: () => {
          online = false;
        },
        online: () => {
          online = true;
        },
      },
    });
    ipcMain.handle("qa-enable", () => local.enable());
    ipcMain.handle("qa-snapshot", () => local.getSnapshot());
    ipcMain.handle("qa-apply", (_event, ops, owner) =>
      local.applyOperations(ops, owner),
    );
    ipcMain.handle("qa-status", () => local.syncStatus());
    ipcMain.handle("qa-sync", async () => {
      await local.reconnect();
      return local.syncStatus();
    });
    ipcMain.handle("qa-resolve", (_event, id, choice) =>
      local.resolve(id, choice),
    );
    Object.assign(globalThis, { qaStartupStage: "windows" });
    for (let i = 0; i < 2; i++) {
      const win = new BrowserWindow({
        width: 960,
        height: 700,
        title: `Mithril SQLite QA ${i + 1}`,
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          contextIsolation: true,
          sandbox: true,
        },
      });
      await win.loadFile(join(__dirname, "renderer", "index.html"));
    }
    app.on("before-quit", () => local.close());
  })
  .catch((error) => {
    Object.assign(globalThis, { qaStartupError: String(error) });
  });
