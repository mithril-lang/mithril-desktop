import { statSync } from "fs";
import { profilePaths } from "./utils";
import { legacyProviderSnapshot } from "./legacy-provider-snapshot";
import type { LegacyProviderSnapshot } from "../shared/legacy-provider";
import { CloudChat } from "./cloud-chat";
import { CloudWorkspace } from "./cloud-workspace";
import { readCloudAccountToken } from "./mithril-token-store";
import { mithrilApiOrigin } from "./mithril-token";
import { getActiveProfileNameSync } from "./utils";
import { onCloudWorkspaceInvalidated } from "./cloud-workspace-events";

const listeners = new Set<() => void>();
export const cloudChat = new CloudChat(
  new CloudWorkspace({
    token: () => readCloudAccountToken(getActiveProfileNameSync()),
    profile: () => getActiveProfileNameSync() || "default",
    origin: mithrilApiOrigin,
    fetch: (input, init) => fetch(input, init),
    changed: () => listeners.forEach((listener) => listener()),
    readScope: "chat:read",
    writeScope: "chat:write",
  }),
);
onCloudWorkspaceInvalidated(() => cloudChat.auth.reset());
export function onCloudChatAccountChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function captureLegacyProviderSnapshot(): Promise<LegacyProviderSnapshot> {
  const context = await cloudChat.auth.nativeContext();
  return legacyProviderSnapshot(context.userId, Date.now(), () => {
    try {
      return statSync(profilePaths(context.profile).configFile);
    } catch {
      return null;
    }
  });
}
