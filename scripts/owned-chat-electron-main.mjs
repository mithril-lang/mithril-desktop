// Opt-in qualification entry: real Electron, production preload/IPC/main classes.
// Account issuance, model inventory and OS browser-open are explicit fixtures.
import { app, BrowserWindow, ipcMain, session } from "electron";
import { readFileSync } from "node:fs";
import { CloudChat } from "../src/main/cloud-chat.ts";
import { CloudWorkspace } from "../src/main/cloud-workspace.ts";
import { registerCloudChatIPC } from "../src/main/cloud-chat-ipc.ts";
import { assertCloudWorkspaceSender } from "../src/main/cloud-workspace-sender.ts";

/** @returns {Promise<void>} */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript launcher return is documented above.
async function start() {
  const file = process.env.MITHRIL_OWNED_ELECTRON_FIXTURE;
  if (!file) throw Error("explicit qualification configuration required");
  const config = JSON.parse(readFileSync(file, "utf8"));
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.origin))
    throw Error("loopback qualification only");
  app.setPath("userData", config.userData);
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  const state = {
    opened: [],
    openCount: 0,
    openedJson: "[]",
    nativeIntent: null,
    requests: 0,
    reviews: [],
    secondary: null,
  };
  const auth = new CloudWorkspace({
    token: () => config.token,
    profile: () => "default",
    origin: () => config.origin,
    fetch: async (input, init) => {
      state.requests++;
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.pathname === "/v1/chat/models")
        return Response.json({
          schemaVersion: 1,
          userId: config.owner,
          models: [{ id: "mock", available: true }],
        });
      return fetch(input, init);
    },
    changed: () => {},
    readScope: "chat:read",
    writeScope: "chat:write",
  });
  await auth.enable();
  const main = new CloudChat(auth, async (url) => {
    state.opened.push(url);
    state.openCount++;
    state.openedJson = JSON.stringify(state.opened);
  });
  const originalCreate = main.createNativeChildConsent.bind(main);
  main.createNativeChildConsent = (request, body) => {
    state.nativeIntent = structuredClone(body);
    return originalCreate(request, body);
  };
  const originalReview = main.reviewNativeChildConsent.bind(main);
  main.reviewNativeChildConsent = async (request) => {
    const review = { state: "pending", reason: "", openedAfter: -1 };
    state.reviews.push(review);
    try {
      await originalReview(request);
      review.state = "returned";
      review.openedAfter = state.opened.length;
    } catch (error) {
      review.state = "failed";
      // Only fixed main error categories: never persist credentials or requests.
      const message = error instanceof Error ? error.message : "";
      review.reason =
        /^(Native approval (?:retired|unavailable|context changed|scope retired|response changed|deadline changed)|Workspace request failed \(\d{3}\))$/.test(
          message,
        )
          ? message
          : "other main review refusal";
      throw error;
    }
  };
  const options = {
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      preload: config.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  };
  const win = new BrowserWindow(options);
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript guard delegates to the typed production function.
  const trusted = (event) =>
    assertCloudWorkspaceSender(
      event,
      win,
      "/qualification/renderer/index.html",
      config.origin,
    );
  registerCloudChatIPC(ipcMain, trusted, main);
  // Workspace import remains outside this qualification. Only initial enable is exposed.
  ipcMain.handle("cloud-workspace-enable", (event) => {
    trusted(event);
    return auth.enable();
  });
  globalThis.__ownedChatQualification = {
    state,
    mainWindow: win,
    createSecondary: async () => {
      const secondary = new BrowserWindow(options);
      state.secondary = secondary;
      await secondary.loadURL(config.origin + "/qualification/context");
    },
  };
  app.on("window-all-closed", () => app.quit());
  await win.loadURL(config.origin + "/desktop");
}
void start().catch((error) => {
  console.error(error);
  app.exit(1);
});
