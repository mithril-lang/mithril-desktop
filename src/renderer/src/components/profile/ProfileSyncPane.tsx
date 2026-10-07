import { useCallback, useEffect, useState } from "react";
import { DesktopProfileSync } from "@mithril/workspace/desktop-profile-sync";
import { useI18n } from "../useI18n";
import type { AgentSyncStatus } from "../../../../shared/agent-sync";

interface ProfileSyncPaneProps {
  /** Stable profile id — matches `outcome.profile` from a sync pass. */
  profile: string;
}

/**
 * Per-profile cloud-sync controls, shown as the profile modal's "Sync" tab.
 * Sync itself is app-wide (one pass reconciles every profile), so "Sync now"
 * triggers the same `syncAgents()` the Agents screen uses and then surfaces
 * this profile's result — a manual path when the auto-sync-on-visit hasn't run.
 */
export default function ProfileSyncPane({
  profile,
}: ProfileSyncPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<AgentSyncStatus | null>(null);
  const [linkedAgentId, setLinkedAgentId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [s, linked] = await Promise.all([
        window.hermesAPI.getAgentSyncStatus(),
        window.hermesAPI.getLinkedAgentId(profile),
      ]);
      setStatus(s);
      setLinkedAgentId(linked);
    } catch {
      // Bridge unavailable (old preload/tests): leave the pane in its hint state.
    }
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!window.hermesAPI.onAgentSyncUpdated) return undefined;
    return window.hermesAPI.onAgentSyncUpdated(() => {
      void refresh();
    });
  }, [refresh]);

  const runSync = useCallback(async (): Promise<void> => {
    setSyncing(true);
    try {
      await window.hermesAPI.syncAgents();
    } catch {
      // Result is surfaced via the status refresh below.
    } finally {
      setSyncing(false);
      void refresh();
    }
  }, [refresh]);

  return (
    <DesktopProfileSync
      profile={profile}
      status={status}
      linkedAgentId={linkedAgentId}
      syncing={syncing}
      onSync={runSync}
      t={t}
    />
  );
}
