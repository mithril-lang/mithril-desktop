import { CloudWorkspace } from "./cloud-workspace";
import { readMithrilToken } from "./mithril-token-store";
import { mithrilApiOrigin } from "./mithril-token";
import { getActiveProfileNameSync } from "./utils";
import { onCloudWorkspaceInvalidated } from "./cloud-workspace-events";

const listeners = new Set<() => void>();
export const cloudWorkspace = new CloudWorkspace({
  token: () => readMithrilToken(getActiveProfileNameSync()),
  profile: () => getActiveProfileNameSync() || "default",
  origin: mithrilApiOrigin,
  fetch: (input, init) => fetch(input, init),
  changed: () => listeners.forEach((listener) => listener()),
});
onCloudWorkspaceInvalidated(() => cloudWorkspace.reset());

export function onCloudWorkspaceAccountChanged(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
