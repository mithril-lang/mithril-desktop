import { app, BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { LocalWorkspace } from "./local-workspace";
import {
  cloudWorkspace,
  onCloudWorkspaceAccountChanged,
} from "./cloud-workspace-runtime";
import { readCloudAccountToken } from "./mithril-token-store";
import { getActiveProfileNameSync } from "./utils";
import { mithrilApiOrigin } from "./mithril-token";
let service: LocalWorkspace | undefined;
function currentScope(): string | null {
  const profile = getActiveProfileNameSync() || "default";
  const token = readCloudAccountToken(profile);
  if (!token || !/^mf_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256")
    .update(JSON.stringify([mithrilApiOrigin(), profile, token]))
    .digest("hex");
}
let activeScope: string | null = null;
export function localWorkspace(): LocalWorkspace {
  service ??= new LocalWorkspace(
    join(app.getPath("userData"), "workspace", "workspace.sqlite"),
    () => {
      // No bearer, credential or local path is sent to the renderer or stored in SQLite.
      activeScope = currentScope();
      return activeScope;
    },
    cloudWorkspace,
    () => {
      for (const win of BrowserWindow.getAllWindows())
        if (!win.isDestroyed()) win.webContents.send("local-workspace-changed");
    },
  );
  return service;
}
// A remote authorization refusal is handled by the service itself. Only a real
// credential/profile change retires the active scope and fences in-flight work.
onCloudWorkspaceAccountChanged(() => {
  if (currentScope() !== activeScope) service?.reset();
});
app.on("before-quit", () => service?.close());
