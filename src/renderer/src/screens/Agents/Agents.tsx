import { DesktopAgentCreateModal } from "@mithril/workspace/desktop-agent-create";
import { DesktopAgentsTable } from "@mithril/workspace/desktop-agents";
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, ChatBubble, Pencil, X } from "../../assets/icons";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { useI18n } from "../../components/useI18n";
import { OrbLoader } from "../../components/OrbLoader";
import { useProfileModal } from "../../components/profile/ProfileModalContext";
import { useWorkspaceIdentity } from "../../components/useWorkspaceIdentity";

interface ProfileInfo {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
  gatewayShared?: boolean;
  color?: string;
  avatar?: string | null;
}

interface AgentsProps {
  activeProfile: string;
  onSelectProfile: (name: string) => void;
  onChatWith: (name: string) => void;
}

function Agents({
  activeProfile,
  onSelectProfile,
  onChatWith,
}: AgentsProps): React.JSX.Element {
  const { t } = useI18n();
  const identity = useWorkspaceIdentity(activeProfile);
  const { openProfile } = useProfileModal();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [cloneConfig, setCloneConfig] = useState(true);
  // Source profile to clone config/keys/skills from when `cloneConfig` is on.
  const [cloneSource, setCloneSource] = useState("default");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // Profile whose gateway we're waiting on after a switch — drives the
  // "Starting…" status while it spins up.
  const [startingProfile, setStartingProfile] = useState<string | null>(null);

  const loadProfiles = useCallback(async (): Promise<void> => {
    try {
      const list = await window.hermesAPI.listProfiles();
      setProfiles(list);
      setListError("");
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  // A switched profile starts its gateway asynchronously, so the pid file the
  // status reads from isn't written yet when the switch returns. Poll the list
  // until that profile reports running (or we give up) so the row flips to
  // "Running" on its own instead of only after a manual refresh/revisit.
  const gatewayPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopGatewayPoll = useCallback((): void => {
    if (gatewayPollRef.current) {
      clearTimeout(gatewayPollRef.current);
      gatewayPollRef.current = null;
    }
  }, []);

  const pollGatewayReady = useCallback(
    (name: string): void => {
      stopGatewayPoll();
      // ~15 attempts × 700ms ≈ 10s, enough for a cold gateway to come up.
      let attemptsLeft = 15;
      const settle = (): void =>
        setStartingProfile((current) => (current === name ? null : current));
      const tick = async (): Promise<void> => {
        attemptsLeft -= 1;
        try {
          const list = await window.hermesAPI.listProfiles();
          setProfiles(list);
          if (list.find((p) => p.id === name)?.gatewayRunning) {
            settle();
            return;
          }
        } catch {
          // A transient listing failure (e.g. SSH) shouldn't strand the
          // spinner — fall through to retry or give up like any other miss.
        }
        if (attemptsLeft <= 0) {
          settle();
          return;
        }
        gatewayPollRef.current = setTimeout(tick, 700);
      };
      gatewayPollRef.current = setTimeout(tick, 700);
    },
    [stopGatewayPoll],
  );

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Cancel any in-flight gateway poll when the page unmounts.
  useEffect(() => stopGatewayPoll, [stopGatewayPoll]);

  // Original working copies are refreshed after background repository replication.
  // This is list refresh, not an assertion that every profile has synchronized.
  useEffect(() => {
    if (!identity.owner) return undefined;
    let active = true;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const list = await window.hermesAPI.listProfiles();
        if (active) {
          setProfiles(list);
          setListError("");
        }
      } catch {
        // Preserve the last list; a later refresh can recover a transient failure.
      } finally {
        busy = false;
      }
    }, 20_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [identity.owner, activeProfile]);

  // Open the create modal, defaulting the clone source to the active profile.
  function openCreate(): void {
    setNewName("");
    setError("");
    setCloneConfig(true);
    setCloneSource(activeProfile || "default");
    setShowCreate(true);
  }

  function closeCreate(): void {
    setShowCreate(false);
    setError("");
  }

  async function handleCreate(): Promise<void> {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError("");
    const result = await window.hermesAPI.createProfile(
      name,
      cloneConfig ? cloneSource : null,
    );
    setCreating(false);
    if (result.success) {
      setShowCreate(false);
      setNewName("");
    } else {
      setError(result.error || t("agents.createFailed"));
    }
    loadProfiles();
  }

  async function handleSelect(name: string): Promise<void> {
    // Show "Starting…" only when this profile's gateway isn't already up, so
    // switching to an already-running profile doesn't flash a fake spinner.
    const alreadyRunning = profiles.find((p) => p.id === name)?.gatewayRunning;
    setStartingProfile(alreadyRunning ? null : name);
    await window.hermesAPI.setActiveProfile(name);
    onSelectProfile(name);
    loadProfiles();
    pollGatewayReady(name);
  }

  // "Chat" button — make the agent active (starts its gateway) then open a
  // conversation with it. The only path here that starts a chat.
  async function handleChatWith(name: string): Promise<void> {
    await window.hermesAPI.setActiveProfile(name);
    onChatWith(name);
    loadProfiles();
  }

  if (loading) {
    return (
      <div className="agents-container">
        <div className="agents-loading">
          <OrbLoader state="searching" size={64} />
        </div>
      </div>
    );
  }

  return (
    <div className="agents-container">
      <div className="agents-header">
        <div>
          <h2 className="agents-title">{t("agents.title")}</h2>
          <p className="agents-subtitle">{t("agents.subtitle")}</p>
        </div>
        <div className="agents-header-actions">
          {listError && (
            <>
              <span className="agents-sync-hint" role="status">
                {listError}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void loadProfiles()}
              >
                {t("common.refresh")}
              </button>
            </>
          )}
          {identity.error && (
            <>
              <span className="agents-sync-hint" role="status">
                {identity.error}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void identity.refresh()}
                disabled={identity.checking}
              >
                {t("common.retry")}
              </button>
            </>
          )}
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={14} />
            {t("agents.newAgent")}
          </button>
        </div>
      </div>

      {!showCreate && error && (
        <div className="agents-create-error">{error}</div>
      )}

      <DesktopAgentCreateModal
        open={showCreate}
        name={newName}
        error={error}
        creating={creating}
        onNameChange={(name) => {
          setNewName(name);
          setError("");
        }}
        onCancel={closeCreate}
        onCreate={handleCreate}
        t={t}
        X={X}
        clone={{
          enabled: cloneConfig,
          source: cloneSource,
          profiles,
          onEnabled: setCloneConfig,
          onSource: setCloneSource,
        }}
      />

      <DesktopAgentsTable
        profiles={profiles}
        activeProfile={activeProfile}
        startingProfile={startingProfile}
        onSelect={(id) => void handleSelect(id)}
        onChatWith={(id) => void handleChatWith(id)}
        onEdit={(id) => {
          setError("");
          openProfile(id, {
            onChanged: loadProfiles,
            onDeleted: (name) => {
              if (activeProfile === name) onSelectProfile("default");
            },
          });
        }}
        Avatar={ProfileAvatar}
        Pencil={Pencil}
        ChatBubble={ChatBubble}
        t={t}
      />
    </div>
  );
}

export default Agents;
