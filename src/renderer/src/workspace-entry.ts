import type { CloudWorkspaceAPI } from "../../shared/workspace";
interface EntryAPI {
  cloudWorkspace?: Pick<CloudWorkspaceAPI, "enable" | "localSync">;
  getMithrilAccount(
    profile: string,
  ): Promise<{ live?: boolean; userId?: string | null } | null>;
}
/** Cached metadata access is distinct from live account/execution authorization. */
// @lat: [[local-workspace#Local SQLite workspace#Offline application entry]]
export async function workspaceEntry(
  api: EntryAPI,
  profile: string,
): Promise<{ allowed: boolean; live: boolean }> {
  const local = await api.cloudWorkspace?.localSync?.status().catch(() => null);
  if (local?.ready && local.userId) {
    // The main process binds this cache to the current credential/profile. It
    // verifies remote authority in the background; no network read blocks entry.
    void api.cloudWorkspace!.enable().catch(() => undefined);
    return { allowed: true, live: false };
  }
  const account = await api.getMithrilAccount(profile).catch(() => null);
  const live = !!account?.live && !!account.userId;
  return { allowed: live, live };
}
