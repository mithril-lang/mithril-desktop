// Isolated qualification; dashboard location/issuer are fixtures, preload and sender guard are production.
import { app, BrowserWindow, ipcMain, session } from "electron";
import { readFileSync } from "node:fs";
import { assertCloudWorkspaceSender } from "../src/main/cloud-workspace-sender.ts";

/** @returns {Promise<void>} */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript launcher return is documented above.
async function start() {
  const config = JSON.parse(
    readFileSync(process.env.MITHRIL_MEMORY_ELECTRON_FIXTURE, "utf8"),
  );
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.origin))
    throw Error("loopback qualification only");
  app.setPath("userData", config.userData);
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 800,
    webPreferences: {
      preload: config.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript qualification delegates to typed production guard.
  const trusted = (event) =>
    assertCloudWorkspaceSender(
      event,
      win,
      "/qualification/renderer/index.html",
      config.origin,
    );
  // These fixed IPC responses replace dashboard launch/profile configuration, not its RPC client.
  for (const channel of ["start-dashboard", "dashboard-status"]) {
    ipcMain.handle(channel, (event, profile, connectionId) => {
      trusted(event);
      if (!["a", "b"].includes(profile) || connectionId !== "qualifier")
        throw Error("qualification profile refused");
      return {
        running: true,
        connection: {
          wsUrl: config.origin.replace("http:", "ws:") + "/api/ws",
        },
      };
    });
  }
  ipcMain.handle(
    "fresh-dashboard-ws-url",
    async (event, profile, connectionId) => {
      trusted(event);
      if (!["a", "b"].includes(profile) || connectionId !== "qualifier")
        throw Error("qualification profile refused");
      const response = await fetch(config.origin + "/qualification/ticket", {
        method: "POST",
        headers: { "X-Qualification-Issuer": config.issuer },
        redirect: "error",
      });
      if (!response.ok) throw Error("qualification ticket refused");
      const { ticket } = await response.json();
      return (
        config.origin.replace("http:", "ws:") +
        "/api/ws?ticket=" +
        encodeURIComponent(ticket)
      );
    },
  );
  ipcMain.handle("record-agent-runtime-info", (event) => {
    trusted(event);
    return true;
  });
  await win.loadURL(config.origin + "/qualification/renderer/index.html");
  app.on("window-all-closed", () => app.quit());
}
void start().catch(() => {
  console.error("isolated memory Electron launch failed");
  app.exit(1);
});
