import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Database,
  Plug,
  Pencil,
  Puzzle,
  Refresh,
  Settings,
  Signal,
  Drama,
  Trash,
  User,
  Wallet,
  X,
} from "../../assets/icons";
import ProfileAvatar from "../common/ProfileAvatar";
import { DesktopProfileIdentity } from "@mithril/workspace/desktop-profile";
import { fileToAvatarDataUrl } from "../../utils/imageResize";
import { useI18n } from "../useI18n";
import Soul from "../../screens/Soul/Soul";
import { MemoryEntries } from "../../screens/Memory/MemoryEntries";
import type { MemoryData } from "../../screens/Memory/types";
import { AppModal, AppModalTitle } from "../modal/AppModal";
import ProfileWalletPane from "./ProfileWalletPane";
import ProfileSyncPane from "./ProfileSyncPane";
import { OrbLoader } from "../OrbLoader";
import type { ProfileSection } from "./ProfileModalContext";

/** Mirrors the entry shape returned by `window.hermesAPI.listProfiles()`. */
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
  color?: string;
  avatar?: string | null;
}

export interface ProfileModalProps {
  /** Profile to view/edit (legacy prop name; value is the profile id). */
  name: string;
  open: boolean;
  onClose: () => void;
  onExited?: () => void;
  /** Fired after any successful mutation so the opener can refresh its list. */
  onChanged?: () => void;
  /** Fired after the profile is deleted, before the modal closes. */
  onDeleted?: (name: string) => void;
  /** Section to show when the modal opens; defaults to "profile". */
  initialSection?: ProfileSection;
}

type ProfileChipIcon = React.ComponentType<{
  size?: number;
  className?: string;
}>;

/** Left-nav sections. Built to grow; each renders into the right-hand content
 *  pane. */
const PROFILE_SECTIONS: ReadonlyArray<{
  id: ProfileSection;
  labelKey: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: "profile", labelKey: "agents.sectionProfile", Icon: User },
  { id: "persona", labelKey: "agents.sectionPersona", Icon: Drama },
  { id: "agentMemory", labelKey: "agents.sectionAgentMemory", Icon: Database },
  { id: "wallet", labelKey: "agents.sectionWallet", Icon: Wallet },
  { id: "sync", labelKey: "agents.sectionSync", Icon: Refresh },
  { id: "advanced", labelKey: "agents.sectionAdvanced", Icon: Settings },
];

/**
 * Global profile detail/appearance modal (80vw × 80vh). Opened from anywhere
 * via the ProfileModalProvider's `openProfile`. Self-loads its data through
 * `listProfiles()` (there is no single-profile IPC) and re-loads after each
 * mutation so it always reflects the live profile. Notifies the opener via
 * `onChanged` / `onDeleted` so sibling lists (sidebar, Agents) stay in sync.
 */
export default function ProfileModal({
  name,
  open,
  onClose,
  onExited,
  onChanged,
  onDeleted,
  initialSection,
}: ProfileModalProps): React.JSX.Element {
  const id = name;
  const { t } = useI18n();
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [section, setSection] = useState<ProfileSection>(
    initialSection ?? "profile",
  );
  // Re-apply on every open so a reused modal instance honours the opener's
  // requested section (e.g. the bank ATM deep-links to "wallet").
  useEffect(() => {
    if (open) setSection(initialSection ?? "profile");
  }, [open, initialSection]);
  const [error, setError] = useState("");
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await window.hermesAPI.listProfiles();
      setProfile(list.find((p) => p.id === id) ?? null);
    } catch {
      /* keep last-known profile */
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMemoryData = useCallback(async (): Promise<void> => {
    if (!profile) return;
    setMemoryLoading(true);
    setMemoryError("");
    try {
      const data = await window.hermesAPI.readMemory(profile.id);
      setMemoryData(data as MemoryData);
    } catch {
      setMemoryError(t("memory.loadFailed"));
    } finally {
      setMemoryLoading(false);
    }
  }, [profile, t]);

  useEffect(() => {
    setMemoryData(null);
    setMemoryError("");
  }, [id]);

  useEffect(() => {
    if (section === "agentMemory" && profile && !memoryData && !memoryLoading) {
      void loadMemoryData();
    }
  }, [loadMemoryData, memoryData, memoryLoading, profile, section]);

  const afterMutation = useCallback(async (): Promise<void> => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  async function handleDelete(): Promise<void> {
    if (deleting) return;
    setDeleting(true);
    setConfirmDelete(false);
    setError("");
    try {
      const result = await window.hermesAPI.deleteProfile(id);
      if (result.success) {
        onDeleted?.(id);
        onChanged?.();
        onClose();
      } else {
        setError(result.error || t("agents.deleteFailed"));
      }
    } catch {
      setError(t("agents.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  function providerLabel(provider: string): string {
    if (!provider || provider === "auto") return t("agents.auto");
    if (provider === "custom") return t("agents.local");
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  const profileChips: ReadonlyArray<{
    key: string;
    value: string;
    Icon: ProfileChipIcon;
    state?: "on" | "off";
  }> = profile
    ? [
        {
          key: "provider",
          value: providerLabel(profile.provider),
          Icon: Plug,
        },
        {
          key: "model",
          value: profile.model
            ? profile.model.split("/").pop() || profile.model
            : t("agents.noModel"),
          Icon: Brain,
        },
        {
          key: "skills",
          value: t("agents.skillsCount", { count: profile.skillCount }),
          Icon: Puzzle,
        },
        {
          key: "gateway",
          value: profile.gatewayRunning
            ? t("agents.gatewayRunning")
            : t("agents.gatewayOff"),
          Icon: Signal,
          state: profile.gatewayRunning ? "on" : "off",
        },
      ]
    : [];
  const agentName = profile?.name || id;

  return (
    <AppModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      onExitComplete={onExited}
      className="profile-modal"
      overlayClassName="profile-modal-overlay"
      labelledBy="profile-modal-title"
    >
      <aside className="profile-modal-sidebar">
        <div className="profile-modal-sidebar-head">
          {profile && (
            <ProfileAvatar
              name={profile.id}
              color={profile.color}
              avatar={profile.avatar}
              size={28}
            />
          )}
          <AppModalTitle
            id="profile-modal-title"
            className="profile-modal-title"
          >
            {agentName}
          </AppModalTitle>
        </div>
        {profile && (
          <nav className="profile-modal-nav" aria-label={t("agents.title")}>
            {PROFILE_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`profile-modal-nav-item ${
                  section === s.id ? "active" : ""
                }`}
                onClick={() => setSection(s.id)}
              >
                <s.Icon size={16} />
                {t(s.labelKey)}
              </button>
            ))}
          </nav>
        )}
      </aside>

      <div className="profile-modal-main">
        <div className="profile-modal-topbar">
          <button
            type="button"
            className="profile-modal-close"
            onClick={onClose}
            aria-label={t("common.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        {profile ? (
          <div className="profile-modal-content">
            {section === "profile" && (
              <DesktopProfileIdentity
                key={profile.id}
                profile={profile}
                api={window.hermesAPI}
                t={t}
                Avatar={ProfileAvatar}
                Pencil={Pencil}
                fileToAvatarDataUrl={fileToAvatarDataUrl}
                onChanged={afterMutation}
                onColorDraft={(color) =>
                  setProfile((cur) => (cur ? { ...cur, color } : cur))
                }
                stats={
                  <div className="profile-modal-stats">
                    {profileChips.map(({ key, value, Icon, state }) => (
                      <span
                        className={`profile-modal-stat-value ${
                          state ? `is-${state}` : ""
                        }`}
                        key={key}
                      >
                        <Icon size={14} className="profile-modal-stat-icon" />
                        {value}
                      </span>
                    ))}
                  </div>
                }
              />
            )}

            {section === "persona" && (
              <div className="profile-modal-pane profile-modal-memory-pane">
                <div className="memory-soul-tab">
                  <Soul profile={profile.id} />
                </div>
              </div>
            )}

            {section === "agentMemory" && (
              <div className="profile-modal-pane profile-modal-memory-pane">
                {memoryLoading && !memoryData ? (
                  <div className="profile-modal-loading">
                    <OrbLoader state="searching" size={64} />
                  </div>
                ) : memoryData ? (
                  <MemoryEntries
                    key={profile.id}
                    entries={memoryData.memory.entries}
                    expected={{
                      memory: memoryData.memory.content,
                      user: memoryData.user.content,
                    }}
                    profile={profile.id}
                    onRefresh={loadMemoryData}
                  />
                ) : memoryError ? (
                  <div className="memory-error">{memoryError}</div>
                ) : null}
              </div>
            )}

            {section === "wallet" && <ProfileWalletPane profile={profile.id} />}

            {section === "sync" && <ProfileSyncPane profile={profile.id} />}

            {section === "advanced" && (
              <div className="profile-modal-pane">
                {profile.isDefault ? (
                  <p className="profile-modal-danger-info">
                    {t("agents.defaultNotDeletable")}
                  </p>
                ) : (
                  <div className="profile-modal-danger">
                    <span className="profile-modal-label profile-modal-danger-label">
                      {t("agents.dangerZone")}
                    </span>
                    <p className="profile-modal-danger-info">
                      {t("agents.deleteProfileInfo")}
                    </p>
                    {confirmDelete ? (
                      <div className="profile-modal-danger-confirm">
                        <span>{t("agents.deleteProfileConfirm")}</span>
                        <div className="profile-modal-image-actions">
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={handleDelete}
                            disabled={deleting}
                          >
                            {t("agents.deleteProfile")}
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setConfirmDelete(false)}
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="btn btn-danger-ghost btn-sm"
                        onClick={() => setConfirmDelete(true)}
                        disabled={deleting}
                      >
                        <Trash size={13} />
                        {t("agents.deleteProfile")}
                      </button>
                    )}
                  </div>
                )}

                {error && <div className="agents-create-error">{error}</div>}
              </div>
            )}
          </div>
        ) : (
          <div className="profile-modal-loading">
            <OrbLoader state="searching" size={64} />
          </div>
        )}

        <div className="profile-modal-footer">
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            {t("common.done")}
          </button>
        </div>
      </div>
    </AppModal>
  );
}
