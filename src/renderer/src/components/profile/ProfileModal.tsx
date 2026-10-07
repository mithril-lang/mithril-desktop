import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
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
import {
  DesktopProfileIdentity,
  DesktopProfileModal,
} from "@mithril/workspace/desktop-profile";
import { fileToAvatarDataUrl } from "../../utils/imageResize";
import { useI18n } from "../useI18n";
import Soul from "../../screens/Soul/Soul";
import { DesktopProfileMemory } from "@mithril/workspace/desktop-memory";
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
  const { t, locale } = useI18n();
  const [loadedProfile, setProfile] = useState<ProfileInfo | null>(null);
  const profile = loadedProfile?.id === id ? loadedProfile : null;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const scope = useRef({ id, open });
  const reads = useRef(0);
  useLayoutEffect(() => {
    scope.current = { id, open };
    setLoadError("");
    setError("");
    setConfirmDelete(false);
    setDeleting(false);
    return () => {
      scope.current = { id, open: false };
    };
  }, [id, open]);
  const [section, setSection] = useState<ProfileSection>(
    initialSection ?? "profile",
  );
  // Re-apply on every open so a reused modal instance honours the opener's
  // requested section (e.g. the bank ATM deep-links to "wallet").
  useEffect(() => {
    if (open) setSection(initialSection ?? "profile");
  }, [open, initialSection]);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const captured = scope.current;
    if (!captured.open || captured.id !== id) return;
    const generation = ++reads.current;
    const current = (): boolean =>
      scope.current === captured && reads.current === generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setLoadError("");
    try {
      const list = await Promise.race([
        window.hermesAPI.listProfiles(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Profile read timed out")),
            12000,
          );
        }),
      ]);
      if (!current()) return;
      const found = list.find((p) => p.id === id) ?? null;
      setProfile(found);
      if (!found) setLoadError("unavailable");
    } catch {
      if (current()) setLoadError("failed");
    } finally {
      if (timer) clearTimeout(timer);
      if (current()) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const afterMutation = useCallback(async (): Promise<void> => {
    const captured = scope.current;
    if (!captured.open || captured.id !== id) return;
    await load();
    if (scope.current === captured) onChanged?.();
  }, [id, load, onChanged]);

  async function handleDelete(): Promise<void> {
    if (deleting) return;
    const captured = scope.current;
    if (!captured.open || captured.id !== id) return;
    setDeleting(true);
    setConfirmDelete(false);
    setError("");
    try {
      const result = await window.hermesAPI.deleteProfile(id);
      if (scope.current !== captured) return;
      if (result.success) {
        onDeleted?.(id);
        onChanged?.();
        onClose();
      } else {
        setError(result.error || t("agents.deleteFailed"));
      }
    } catch {
      if (scope.current === captured) setError(t("agents.deleteFailed"));
    } finally {
      if (scope.current === captured) setDeleting(false);
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
    <DesktopProfileModal<ProfileSection>
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={agentName}
      avatar={
        profile ? (
          <ProfileAvatar
            name={profile.id}
            color={profile.color}
            avatar={profile.avatar}
            size={28}
          />
        ) : undefined
      }
      label={t("agents.title")}
      sections={
        profile
          ? PROFILE_SECTIONS.map((s) => ({
              id: s.id,
              label: t(s.labelKey),
              Icon: s.Icon,
            }))
          : []
      }
      selected={section}
      onSelect={setSection}
      closeLabel={t("common.cancel")}
      doneLabel={t("common.done")}
      ready={Boolean(profile)}
      loading={
        loadError ? (
          <div role="alert">
            <p>
              {t(
                loadError === "unavailable"
                  ? "agents.profileUnavailable"
                  : "agents.profileLoadFailed",
              )}
            </p>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void load()}
              disabled={loading}
            >
              {t("common.retry")}
            </button>
          </div>
        ) : (
          <OrbLoader state="searching" size={64} />
        )
      }
      X={X}
    >
      {profile && (
        <>
          {loadError && (
            <div role="alert">
              <p>
                {t(
                  loadError === "unavailable"
                    ? "agents.profileUnavailable"
                    : "agents.profileLoadFailed",
                )}
              </p>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => void load()}
                disabled={loading}
              >
                {t("common.retry")}
              </button>
            </div>
          )}
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
            <DesktopProfileMemory
              api={window.hermesAPI}
              profile={profile.id}
              t={t}
              locale={locale}
            />
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
        </>
      )}
    </DesktopProfileModal>
  );
}
