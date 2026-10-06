import * as Dialog from "@radix-ui/react-dialog";
import Code from "../Code/Code";
import { Code2 } from "lucide-react";
import CloudSecurity from "../CloudWorkspace/CloudSecurity";
import Agents from "../Agents/Agents";
import Tools from "../Tools/Tools";
import Memory from "../Memory/Memory";
import { WorkspaceNavigation } from "@mithril/design-system/react";
import MithrilChat from "../CloudWorkspace/MithrilChat";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Chat from "../Chat/Chat";
import {
  dbItemsToChatMessages,
  type DbHistoryItem,
} from "../Chat/sessionHistory";
import {
  type ChatRun,
  mintRun,
  patchRun,
  isScratchRun,
  openSessionRunTransition,
  selectProfileRunTransition,
  findRunByLocation,
  cycleRunId,
  runIdAtOrdinal,
  loadingSessionIds as deriveLoadingSessionIds,
} from "./chatRuns";
import { ActiveSessionsBar } from "./ActiveSessionsBar";
import { StatusBar } from "./StatusBar";
import Sessions from "../Sessions/Sessions";
import ProfileSwitcher from "./ProfileSwitcher";
import SidebarRecentSessions from "./SidebarRecentSessions";
import Skills from "../Skills/Skills";
import Gateway from "../Gateway/Gateway";
import Providers from "../Providers/Providers";
import Schedules from "../CloudWorkspace/CloudSchedules";
import CloudWorkspace from "../CloudWorkspace/CloudWorkspace";
import RemoteNotice from "../../components/RemoteNotice";
import VerifyWarningBanner from "../../components/VerifyWarningBanner";
import { useSettingsModal } from "../../components/settings/SettingsModalContext";
import {
  Compass,
  Folder,
  Settings as SettingsIcon,
  Brain,
  Workflow,
  Signal,
  Building,
  KeyRound,
  Timer,
  Kanban as KanbanIcon,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../../components/useI18n";

type View =
  | "code"
  | "mithril-chat"
  | "workspace"
  | "projects"
  | "cloud-settings"
  | "device-agents"
  | "device-tools"
  | "device-memory"
  | "chat"
  | "discover"
  | "agents"
  | "office"
  | "providers"
  | "skills"
  | "memory"
  | "tools"
  | "security"
  | "schedules"
  | "kanban"
  | "gateway";

const PINNED_NAV_ITEMS: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "discover", icon: Compass, labelKey: "navigation.discover" },
  // "agents" (Profiles) is reached from the sidebar-footer ProfileSwitcher's
  // "Manage profiles" action rather than a top-level nav item.
  { view: "office", icon: Building, labelKey: "navigation.office" },
  { view: "kanban", icon: KanbanIcon, labelKey: "navigation.kanban" },
  { view: "projects", icon: Folder, labelKey: "navigation.projects" },
  // "skills" lives under the Discover tab (installed + community), so it's no
  // longer a top-level nav item.
  { view: "security", icon: KeyRound, labelKey: "navigation.security" },
  { view: "schedules", icon: Timer, labelKey: "navigation.schedules" },
];

const FOOTER_NAV_ITEMS: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "providers", icon: KeyRound, labelKey: "navigation.providers" },
  { view: "gateway", icon: Signal, labelKey: "navigation.gateway" },
  { view: "tools", icon: Workflow, labelKey: "navigation.tools" },
  { view: "memory", icon: Brain, labelKey: "navigation.memory" },
];

const SIDEBAR_COLLAPSED_KEY = "hermes.sidebar.collapsed";
const SIDEBAR_SCROLLBAR_HIDE_MS = 700;

interface LayoutProps {
  onOpenDeviceRuntime?: () => void;
  connectionId: string;
  verifyWarning?: boolean;
  onReinstall?: () => void;
  onDismissVerifyWarning?: () => void;
}

function Layout({
  connectionId,
  onOpenDeviceRuntime,
  verifyWarning,
  onReinstall,
  onDismissVerifyWarning,
}: LayoutProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const { openSettings } = useSettingsModal();
  const [view, setView] = useState<View>("mithril-chat");
  const [cloudResultSession, setCloudResultSession] = useState<
    string | undefined
  >();
  // Multiple conversations coexist (background sessions + multi-agent). Each is
  // a ChatRun; all are mounted, only the active one is shown. Profile switches
  // preserve existing conversations and activate a scratch run for the selected
  // agent so `activeProfile` stays aligned with the visible chat transport.
  const [activeProfile, setActiveProfile] = useState("default");
  const [runs, setRuns] = useState<ChatRun[]>(() => [
    mintRun(connectionId, "default"),
  ]);
  const [activeRunId, setActiveRunId] = useState<string>(() => runs[0].runId);
  // While a resume's history is loading, show its spinner immediately.
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(
    null,
  );
  // Sessions whose resume is in flight — dedupes rapid double-clicks that would
  // otherwise mount two tabs for the same session (the live check straddles an
  // await, so it can't rely on `runs` state alone).
  const resumingRef = useRef<Set<string>>(new Set());
  const sidebarChatScrollRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollbarHideRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [sidebarScrollbar, setSidebarScrollbar] = useState({
    visible: false,
    scrollable: false,
    top: 0,
    height: 0,
  });

  const currentSessionId =
    runs.find((r) => r.runId === activeRunId)?.sessionId ?? null;

  const loadingSessionIds = useMemo(
    () => deriveLoadingSessionIds(runs),
    [runs],
  );

  const updateSidebarScrollbar = useCallback((visible: boolean) => {
    const root = sidebarChatScrollRef.current;
    if (!root) {
      setSidebarScrollbar((prev) =>
        prev.scrollable || prev.visible
          ? { visible: false, scrollable: false, top: 0, height: 0 }
          : prev,
      );
      return;
    }

    const scrollable = root.scrollHeight > root.clientHeight + 1;
    if (!scrollable) {
      setSidebarScrollbar((prev) =>
        prev.scrollable || prev.visible
          ? { visible: false, scrollable: false, top: 0, height: 0 }
          : prev,
      );
      return;
    }

    const trackHeight = root.clientHeight;
    const thumbHeight = Math.max(
      32,
      Math.round((root.clientHeight / root.scrollHeight) * trackHeight),
    );
    const maxTop = Math.max(0, trackHeight - thumbHeight);
    const maxScroll = Math.max(1, root.scrollHeight - root.clientHeight);
    const top = Math.round((root.scrollTop / maxScroll) * maxTop);

    setSidebarScrollbar((prev) => {
      const next = { visible, scrollable, top, height: thumbHeight };
      return prev.visible === next.visible &&
        prev.scrollable === next.scrollable &&
        prev.top === next.top &&
        prev.height === next.height
        ? prev
        : next;
    });
  }, []);

  useEffect(() => {
    const root = sidebarChatScrollRef.current;
    if (!root) return;

    const showThenHide = (): void => {
      updateSidebarScrollbar(true);
      if (sidebarScrollbarHideRef.current) {
        clearTimeout(sidebarScrollbarHideRef.current);
      }
      sidebarScrollbarHideRef.current = setTimeout(() => {
        updateSidebarScrollbar(false);
      }, SIDEBAR_SCROLLBAR_HIDE_MS);
    };

    const updateHidden = (): void => updateSidebarScrollbar(false);
    root.addEventListener("scroll", showThenHide, { passive: true });
    window.addEventListener("resize", updateHidden);
    const observer = new ResizeObserver(updateHidden);
    observer.observe(root);

    updateHidden();
    return () => {
      root.removeEventListener("scroll", showThenHide);
      window.removeEventListener("resize", updateHidden);
      observer.disconnect();
      if (sidebarScrollbarHideRef.current) {
        clearTimeout(sidebarScrollbarHideRef.current);
      }
    };
  }, [updateSidebarScrollbar]);

  // Per-profile avatar/colour, so the active-sessions bar (which only knows a
  // run's profile name) can render real avatars. Refreshed when the selected
  // profile or the current view changes — e.g. after editing on the Agents page.
  const [profileAppearance, setProfileAppearance] = useState<
    Record<string, { color?: string | null; avatar?: string | null }>
  >({});
  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .listProfiles()
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, { color?: string; avatar?: string | null }> =
          {};
        for (const p of list) map[p.id] = { color: p.color, avatar: p.avatar };
        setProfileAppearance(map);
      })
      .catch(() => {
        /* keep last-known appearance */
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfile, view]);
  const getAppearance = useCallback(
    (profile: string) => profileAppearance[profile] ?? {},
    [profileAppearance],
  );

  // Per-run reporters wired into each <Chat>.
  const handleRunLoading = useCallback((runId: string, loading: boolean) => {
    setRuns((prev) => patchRun(prev, runId, { loading }));
  }, []);
  const handleRunSessionId = useCallback(
    (runId: string, sessionId: string | null) => {
      setRuns((prev) => patchRun(prev, runId, { sessionId }));
    },
    [],
  );
  const handleRunTitle = useCallback((runId: string, title: string) => {
    setRuns((prev) => patchRun(prev, runId, { title }));
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  // Full-list sessions modal (opened from the sidebar "Show more" affordance or
  // the Cmd/Ctrl+K menu action). Reuses the Sessions screen inside a modal —
  // there is no longer a top-level Sessions view.
  const [sessionsModalOpen, setSessionsModalOpen] = useState(false);
  const [legacyHistoryOpen, setLegacyHistoryOpen] = useState(false);
  // Tabs lazy-mount on first visit, then stay mounted (display:none toggle).
  // Keeps IPC refetch / DOM rebuild off the tab-switch hot path.
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["mithril-chat"]),
  );
  // Remote-only mode — SSH tunnel has full access; only pure HTTP remote mode restricts screens
  const [remoteMode, setRemoteMode] = useState(false);
  // Set by the Capabilities screen's "Browse" actions to focus a Discover tab
  // (Skills → Community, or MCPs). The nonce re-fires Discover's effect.
  const [discoverFocus, setDiscoverFocus] = useState<{
    kind: "skills" | "mcps";
    nonce: number;
  } | null>(null);

  const paneStyle = (target: View): React.CSSProperties => ({
    display: view === target ? "flex" : "none",
    flex: 1,
    flexDirection: "column",
    overflow: "hidden",
  });

  const goTo = useCallback((v: View) => {
    setVisitedViews((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
    setView(v);
  }, []);

  useEffect(() => {
    const handleNavigation = (e: Event): void => {
      const targetView = (e as CustomEvent<View>).detail;
      if (targetView) goTo(targetView);
    };
    window.addEventListener("navigation:goto", handleNavigation);
    return () =>
      window.removeEventListener("navigation:goto", handleNavigation);
  }, [goTo]);

  // Cmd/Ctrl+, opens the settings modal from anywhere (the conventional
  // "preferences" shortcut).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettings(undefined, { profile: activeProfile });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [openSettings, activeProfile]);

  const focusDiscover = useCallback(
    (kind: "skills" | "mcps") => {
      setDiscoverFocus((prev) => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }));
      goTo("discover");
    },
    [goTo],
  );

  // Re-check remote mode on tab switch (picks up Settings changes)
  useEffect(() => {
    window.hermesAPI.isRemoteOnlyMode().then(setRemoteMode);
  }, [view]);

  // Restore the last-activated profile on launch. The main process persists it
  // in ~/.hermes/active_profile (via `hermes profile use`), so the desktop
  // should reopen on that profile rather than always resetting to "default".
  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .listProfiles()
      .then((profiles) => {
        if (cancelled) return;
        const active = profiles.find((p) => p.isActive);
        if (active && active.id !== "default") {
          setActiveProfile(active.id);
          // Re-home the initial pristine run onto the restored profile so the
          // first chat runs under the right agent (no session/turn yet).
          setRuns((prev) =>
            prev.length === 1 && !prev[0].sessionId && !prev[0].loading
              ? [{ ...prev[0], profile: active.id }]
              : prev,
          );
        }
      })
      .catch(() => {
        /* fall back to the default profile */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-update state
  const [updateState, setUpdateState] = useState<
    "available" | "downloading" | "ready" | "error" | null
  >(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    // Surface a startup upgrade button as soon as GitHub reports a newer
    // release. If auto-upgrade is enabled, electron-updater also downloads in
    // the background and this state advances to downloading/ready.
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setUpdateState("available");
      setUpdateVersion(info.version);
      setUpdateError(null);
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress(
      (info) => {
        setUpdateState("downloading");
        setUpdatePercent(info.percent);
        setUpdateError(null);
      },
    );
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setUpdateState("ready");
      setUpdatePercent(null);
      setUpdateError(null);
    });
    const cleanupError = window.hermesAPI.onUpdateError((message) => {
      setUpdateState("error");
      setUpdateError(message);
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  async function handleUpdate(): Promise<void> {
    if (updateState === "ready") {
      // The only user action: restart into the already-downloaded update.
      await window.hermesAPI.installUpdate();
    } else if (updateState === "available" || updateState === "error") {
      // Download the available update (or retry a failed auto-download).
      // Set downloading state immediately to prevent re-entrancy.
      setUpdateState("downloading");
      setUpdatePercent(null);
      setUpdateError(null);
      try {
        const ok = await window.hermesAPI.downloadUpdate();
        if (!ok) setUpdateState("error");
        // On success, we wait for the onUpdateDownloaded callback to set "ready"
      } catch (err) {
        setUpdateError(err instanceof Error ? err.message : String(err));
        setUpdateState("error");
      }
    }
  }

  const updateButtonTitle =
    updateError ??
    (updateState === "available" && updateVersion
      ? t("common.updateAvailable", { version: updateVersion })
      : updateState === "downloading"
        ? updatePercent === null
          ? t("common.downloading", { percent: 0 })
          : t("common.downloading", { percent: updatePercent })
        : updateState === "ready"
          ? t("common.restartToUpdate")
          : updateState === "error"
            ? t("common.updateFailed")
            : undefined);

  const handleNewChat = useCallback(() => {
    // Open a fresh run WITHOUT aborting others — any in-flight session keeps
    // streaming in the background and stays reachable via the active bar. If the
    // current chat is already a blank scratch, reuse it instead of stacking
    // another empty tab.
    const active = runs.find((r) => r.runId === activeRunId);
    if (
      active?.connectionId === connectionId &&
      !active.sessionId &&
      !active.loading &&
      !active.title
    ) {
      goTo("chat");
      return;
    }
    const run = mintRun(connectionId, activeProfile);
    setRuns((prev) => [...prev, run]);
    setActiveRunId(run.runId);
    goTo("chat");
  }, [runs, activeRunId, connectionId, activeProfile, goTo]);

  // Listen for menu IPC events (Cmd+N, Cmd+K from app menu)
  useEffect(() => {
    const cleanupNewChat = window.hermesAPI.onMenuNewChat(() => {
      handleNewChat();
    });
    const cleanupSearch = window.hermesAPI.onMenuSearchSessions(() => {
      setSessionsModalOpen(true);
    });
    return () => {
      cleanupNewChat();
      cleanupSearch();
    };
  }, [handleNewChat]);

  // Esc closes the full-list sessions modal.
  useEffect(() => {
    if (!sessionsModalOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSessionsModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionsModalOpen]);

  const handleSelectProfile = useCallback(
    (name: string) => {
      // Selecting an agent is administrative: switch the active profile (the
      // component already started its gateway via setActiveProfile). Existing
      // chats remain on their original profile, but the visible chat must move
      // to a scratch run for the selected profile so the footer and transport
      // never point at different agents.
      setActiveProfile(name);
      const next = selectProfileRunTransition(
        runs,
        activeRunId,
        connectionId,
        name,
      );
      setRuns(next.runs);
      setActiveRunId(next.activeRunId);
    },
    [runs, activeRunId, connectionId],
  );

  // The "Chat" affordance: start (or reuse a blank) conversation with an agent
  // and show it. This is the only path from the profile list that opens a chat.
  const handleChatWithProfile = useCallback(
    (name: string) => {
      setActiveProfile(name);
      const active = runs.find((r) => r.runId === activeRunId);
      if (active?.connectionId === connectionId && isScratchRun(active)) {
        setRuns((prev) =>
          prev.map((r) =>
            r.runId === active.runId ? { ...r, profile: name } : r,
          ),
        );
      } else {
        const run = mintRun(connectionId, name);
        setRuns((prev) => [...prev, run]);
        setActiveRunId(run.runId);
      }
      goTo("chat");
    },
    [runs, activeRunId, connectionId, goTo],
  );

  // Jump to an already-open run (e.g. from the active-sessions bar), switching
  // the selected profile so the rest of the app follows the agent.
  const handleActivateRun = useCallback(
    (runId: string) => {
      const run = runs.find((r) => r.runId === runId);
      if (!run) return;
      setActiveRunId(runId);
      setActiveProfile(run.profile);
      goTo("chat");
    },
    [runs, goTo],
  );

  // Close a conversation tab: stop it if it's running, drop it from the list,
  // and (if it was active) move to a neighbour. Always keep at least one chat
  // open so the chat view is never empty.
  const handleCloseRun = useCallback(
    (runId: string) => {
      const idx = runs.findIndex((r) => r.runId === runId);
      window.hermesAPI.abortChat(runId, runs[idx]?.connectionId);
      const remaining = runs.filter((r) => r.runId !== runId);
      if (remaining.length === 0) {
        const fresh = mintRun(connectionId, activeProfile);
        setRuns([fresh]);
        setActiveRunId(fresh.runId);
        return;
      }
      setRuns(remaining);
      if (runId === activeRunId) {
        const neighbour = remaining[Math.min(idx, remaining.length - 1)];
        setActiveRunId(neighbour.runId);
        setActiveProfile(neighbour.profile);
      }
    },
    [runs, activeRunId, connectionId, activeProfile],
  );

  // Chrome/iTerm-style tab shortcuts for the conversation tabs: Ctrl+Tab /
  // Ctrl+Shift+Tab, Cmd/Ctrl+Shift+[ / ], Cmd/Ctrl+Option+←/→ and
  // Cmd/Ctrl+Shift+←/→ cycle; Cmd/Ctrl+1..8 jump to the Nth tab and 9 to the
  // last; Cmd/Ctrl+W closes the active tab. Matches on e.code so the
  // shortcuts keep working while a CJK IME is active. Cmd+Shift+arrow is
  // skipped inside editable fields where it means "select to line start/end".
  useEffect(() => {
    const isEditable = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      return (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t.isContentEditable
      );
    };
    const handleKey = (e: KeyboardEvent): void => {
      const primary = e.metaKey || e.ctrlKey;
      let target: string | null = null;
      let matched = false;
      if (primary && !e.shiftKey && !e.altKey && e.code === "KeyW") {
        // Close the active conversation tab (iTerm/Chrome). handleCloseRun
        // keeps at least one chat open, so the window itself never closes.
        e.preventDefault();
        handleCloseRun(activeRunId);
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === "Tab") {
        matched = true;
        target = cycleRunId(runs, activeRunId, e.shiftKey ? -1 : 1);
      } else if (
        primary &&
        e.shiftKey &&
        !e.altKey &&
        (e.code === "BracketRight" || e.code === "BracketLeft")
      ) {
        matched = true;
        target = cycleRunId(
          runs,
          activeRunId,
          e.code === "BracketRight" ? 1 : -1,
        );
      } else if (
        primary &&
        (e.code === "ArrowRight" || e.code === "ArrowLeft") &&
        // Cmd+Option+arrow (Chrome macOS) or Cmd+Shift+arrow — the latter
        // only outside editable fields, where it selects text instead.
        ((e.altKey && !e.shiftKey) ||
          (e.shiftKey && !e.altKey && !isEditable(e.target)))
      ) {
        matched = true;
        target = cycleRunId(
          runs,
          activeRunId,
          e.code === "ArrowRight" ? 1 : -1,
        );
      } else if (primary && !e.shiftKey && !e.altKey) {
        const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (digit) {
          matched = true;
          target = runIdAtOrdinal(runs, Number(digit[1]));
        }
      }
      if (!matched) return;
      e.preventDefault();
      if (target) handleActivateRun(target);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [runs, activeRunId, handleActivateRun, handleCloseRun]);

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      // Already open as a live run? Re-attach to it (keeps live streaming).
      const live = findRunByLocation(runs, {
        connectionId,
        profile: activeProfile,
        sessionId,
      });
      if (live) {
        handleActivateRun(live.runId);
        return;
      }
      // Guard against a double-click resuming the same session twice: the live
      // check above and the setRuns below straddle an await, so without this a
      // second click would pass the stale guard and mount a duplicate tab.
      if (resumingRef.current.has(sessionId)) return;
      resumingRef.current.add(sessionId);
      setResumingSessionId(sessionId);
      try {
        const items = (await window.hermesAPI.getSessionMessages(
          sessionId,
          connectionId,
          activeProfile,
        )) as DbHistoryItem[];
        const run = mintRun(
          connectionId,
          activeProfile,
          dbItemsToChatMessages(items),
        );
        run.sessionId = sessionId;
        setRuns(
          (prev) => openSessionRunTransition(prev, activeRunId, run).runs,
        );
        setActiveRunId(run.runId);
        goTo("chat");
      } finally {
        resumingRef.current.delete(sessionId);
        setResumingSessionId(null);
      }
    },
    [runs, activeRunId, handleActivateRun, connectionId, activeProfile, goTo],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  }, []);

  const sidebarToggleLabel = sidebarCollapsed
    ? t("navigation.expandSidebar")
    : t("navigation.collapseSidebar");

  const cloudSidebarNavigation = (
    <WorkspaceNavigation
      className="sidebar-nav-pinned"
      items={[
        ...PINNED_NAV_ITEMS.map(({ view: v, icon: Icon, labelKey }) => ({
          id: v,
          label: t(labelKey),
          icon: <Icon size={16} />,
          active: view === v,
          onSelect: () => goTo(v),
        })),
      ]}
    />
  );
  return (
    <div className="layout-shell">
      <div className={`layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <aside className="sidebar">
          <div className="sidebar-brand">
            <button
              className="sidebar-collapse-toggle"
              type="button"
              onClick={toggleSidebar}
              title={sidebarToggleLabel}
              aria-label={sidebarToggleLabel}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? (
                // Collapsed: show the circular brand mark by default and swap to
                // the expand icon on hover/focus. Both sit in a fixed-size box so
                // the swap never changes the button's footprint.
                <span className="sidebar-collapse-swap">
                  <span className="sidebar-collapse-mark" aria-hidden="true" />
                  <PanelLeftOpen
                    size={16}
                    className="sidebar-collapse-expand-icon"
                  />
                </span>
              ) : (
                <PanelLeftClose size={16} />
              )}
            </button>
          </div>

          <div id="cloud-session-sidebar" className="sidebar-cloud-history" />

          <div className="sidebar-chat-section">
            <Dialog.Root
              open={legacyHistoryOpen}
              onOpenChange={setLegacyHistoryOpen}
            >
              <Dialog.Trigger asChild>
                <button className="device-history-button" type="button">
                  {locale.startsWith("ja")
                    ? "端末の履歴・移行"
                    : "Device history and migration"}
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="device-history-backdrop" />
                <Dialog.Content
                  className="device-history-dialog"
                  aria-describedby={undefined}
                >
                  <Dialog.Close asChild>
                    <button type="button" className="device-history-close">
                      {locale.startsWith("ja") ? "閉じる" : "Close"}
                    </button>
                  </Dialog.Close>
                  <div className="sidebar-nav-sessions">
                    <div
                      className="sidebar-chat-scroll"
                      ref={sidebarChatScrollRef}
                    >
                      <div>
                        <Dialog.Title>
                          {locale.startsWith("ja")
                            ? "端末の履歴・移行"
                            : "Device history and migration"}
                        </Dialog.Title>
                        {onOpenDeviceRuntime && (
                          <button
                            onClick={() => {
                              setLegacyHistoryOpen(false);
                              onOpenDeviceRuntime();
                            }}
                          >
                            Set up device runtime
                          </button>
                        )}
                        {legacyHistoryOpen && (
                          <SidebarRecentSessions
                            open={!sidebarCollapsed}
                            connectionId={connectionId}
                            activeProfile={activeProfile}
                            currentSessionId={currentSessionId}
                            loadingSessionIds={loadingSessionIds}
                            resumingSessionId={resumingSessionId}
                            onSelect={(id) => {
                              handleResumeSession(id);
                              setLegacyHistoryOpen(false);
                            }}
                            onSessionDeleted={(id) => {
                              // If the open chat was the one deleted, drop to a fresh chat
                              // so the user isn't left viewing a now-gone conversation.
                              if (id === currentSessionId) handleNewChat();
                            }}
                            scrollRootRef={sidebarChatScrollRef}
                          />
                        )}
                      </div>
                    </div>
                    {sidebarScrollbar.scrollable && (
                      <div
                        className={`sidebar-chat-scrollbar ${
                          sidebarScrollbar.visible ? "visible" : ""
                        }`}
                        aria-hidden="true"
                      >
                        <div
                          className="sidebar-chat-scrollbar-thumb"
                          style={{
                            height: sidebarScrollbar.height,
                            transform: `translateY(${sidebarScrollbar.top}px)`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>

          <div className="sidebar-footer">
            {/* Show an upgrade affordance at startup when GitHub has a newer
              release; it becomes a restart action once downloaded. */}
            {updateState && (
              <button
                className={`sidebar-update-btn ${
                  updateState === "error" ? "error" : ""
                }`}
                onClick={handleUpdate}
                disabled={updateState === "downloading"}
                title={updateButtonTitle}
                aria-label={updateButtonTitle}
              >
                <Download size={13} />
                {updateState === "available" && (
                  <span>
                    {updateVersion
                      ? t("common.updateAvailable", { version: updateVersion })
                      : t("common.updateAvailable", { version: "" })}
                  </span>
                )}
                {updateState === "downloading" && (
                  <span>
                    {t("common.downloading", { percent: updatePercent ?? 0 })}
                  </span>
                )}
                {updateState === "ready" && (
                  <span>{t("common.restartToUpdate")}</span>
                )}
                {updateState === "error" && (
                  <span>{t("common.updateFailed")}</span>
                )}
              </button>
            )}
            <div
              className="sidebar-footer-actions"
              aria-label="Workspace tools"
            >
              {FOOTER_NAV_ITEMS.map(({ view: v, icon: Icon, labelKey }) => (
                <button
                  key={v}
                  className={`sidebar-footer-action ${view === v ? "active" : ""}`}
                  onClick={() => goTo(v)}
                  aria-label={t(labelKey)}
                  data-tooltip={t(labelKey)}
                >
                  <Icon size={16} />
                </button>
              ))}
              <button
                className={`sidebar-footer-action ${view === "code" ? "active" : ""}`}
                onClick={() => goTo("code")}
                aria-label="Code"
                data-tooltip="Code"
              >
                <Code2 size={16} />
              </button>
              <button
                className="sidebar-footer-action"
                onClick={() => goTo("cloud-settings")}
                aria-label={t("navigation.settings")}
                data-tooltip={t("navigation.settings")}
              >
                <SettingsIcon size={16} />
              </button>
            </div>
            <ProfileSwitcher
              activeProfile={activeProfile}
              onSwitch={handleSelectProfile}
              onManage={() => goTo("agents")}
              compact={sidebarCollapsed}
            />
          </div>
        </aside>

        <main className="content">
          {/* Doubles as the window drag strip — keep it first so it owns the top
            band; the warning banner (if any) sits just below it. */}
          {view === "chat" && (
            <ActiveSessionsBar
              runs={runs}
              activeRunId={activeRunId}
              onSelect={handleActivateRun}
              onClose={handleCloseRun}
              onNew={handleNewChat}
              getAppearance={getAppearance}
            />
          )}
          {verifyWarning && onReinstall && onDismissVerifyWarning && (
            <VerifyWarningBanner
              onReinstall={onReinstall}
              onDismiss={onDismissVerifyWarning}
            />
          )}
          <div style={paneStyle("chat")}>
            {visitedViews.has("chat") &&
              runs.map((run) => (
                <div
                  key={run.runId}
                  style={{
                    display:
                      view === "chat" && run.runId === activeRunId
                        ? "flex"
                        : "none",
                    flex: 1,
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  <Chat
                    runId={run.runId}
                    connectionId={run.connectionId}
                    initialMessages={run.seed}
                    initialSessionId={run.sessionId}
                    active={run.runId === activeRunId}
                    profile={run.profile}
                    onNewChat={handleNewChat}
                    onOpenDiagnose={(section?: string) =>
                      openSettings(section, { profile: run.profile })
                    }
                    onLoadingChange={handleRunLoading}
                    onSessionIdChange={handleRunSessionId}
                    onTitleChange={handleRunTitle}
                    agentAppearance={getAppearance(run.profile)}
                  />
                </div>
              ))}
          </div>

          {sessionsModalOpen && (
            <div
              className="models-modal-overlay"
              onClick={() => setSessionsModalOpen(false)}
            >
              <div
                className="sessions-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <Sessions
                  connectionId={connectionId}
                  profile={activeProfile}
                  onResumeSession={(id) => {
                    setSessionsModalOpen(false);
                    void handleResumeSession(id);
                  }}
                  onNewChat={() => {
                    setSessionsModalOpen(false);
                    handleNewChat();
                  }}
                  currentSessionId={currentSessionId}
                  visible={sessionsModalOpen}
                />
              </div>
            </div>
          )}

          {visitedViews.has("code") && (
            <div style={paneStyle("code")}>
              <Code
                key={activeProfile}
                profile={activeProfile}
                locale={locale}
              />
            </div>
          )}
          {visitedViews.has("mithril-chat") && (
            <div style={paneStyle("mithril-chat")}>
              <MithrilChat
                locale={locale}
                profile={activeProfile}
                initialSessionId={cloudResultSession}
                sidebarNavigation={cloudSidebarNavigation}
                onSidebarSelect={() => goTo("mithril-chat")}
                onSidebarProjects={() => goTo("projects")}
                onConnectAccount={() => goTo("providers")}
                visible={view === "mithril-chat"}
              />
            </div>
          )}
          {visitedViews.has("workspace") && (
            <div style={paneStyle("workspace")}>
              <CloudWorkspace
                profile={activeProfile}
                locale={locale}
                embedded
                active={view === "workspace"}
                onOpenChat={() => goTo("mithril-chat")}
                onOpenNativeSection={(section) => {
                  if (section === "settings") {
                    openSettings();
                    return;
                  }
                  const nativeViews = {
                    office: "office",
                    capability: "device-tools",
                    memory: "device-memory",
                    kanban: "kanban",
                    projects: "projects",
                    profile: "device-agents",
                    discover: "discover",
                  } as const;
                  goTo(nativeViews[section]);
                }}
              />
            </div>
          )}
          {visitedViews.has("device-agents") && (
            <div style={paneStyle("device-agents")}>
              <Agents
                activeProfile={activeProfile}
                onSelectProfile={handleSelectProfile}
                onChatWith={handleChatWithProfile}
                onCloudWorkspace={() => goTo("workspace")}
              />
            </div>
          )}
          {visitedViews.has("device-tools") && (
            <div style={paneStyle("device-tools")}>
              <Tools
                profile={activeProfile}
                showPlatformToolsets={!remoteMode}
                remoteMode={remoteMode}
                visible={view === "device-tools"}
                onBrowseSkills={() => focusDiscover("skills")}
                onBrowseMcps={() => focusDiscover("mcps")}
              />
            </div>
          )}
          {visitedViews.has("device-memory") && (
            <div style={paneStyle("device-memory")}>
              <Memory profile={activeProfile} />
            </div>
          )}
          {visitedViews.has("discover") && (
            <div style={paneStyle("discover")}>
              <CloudWorkspace
                profile={activeProfile}
                locale={locale}
                initialView="discover"
                discoverFocus={discoverFocus ?? undefined}
                embedded
                active={view === "discover"}
                onOpenChat={() => goTo("mithril-chat")}
              />
            </div>
          )}

          {visitedViews.has("agents") && (
            <div style={paneStyle("agents")}>
              <CloudWorkspace
                profile={activeProfile}
                locale={locale}
                initialView="bots"
                embedded
                active={view === "agents"}
              />
            </div>
          )}
          {visitedViews.has("projects") && (
            <div style={paneStyle("projects")}>
              <CloudWorkspace
                profile={activeProfile}
                locale={locale}
                initialView="projects"
                embedded
                active={view === "projects"}
              />
            </div>
          )}
          {visitedViews.has("cloud-settings") && (
            <div style={paneStyle("cloud-settings")}>
              <CloudWorkspace
                profile={activeProfile}
                locale={locale}
                initialView="settings"
                embedded
                active={view === "cloud-settings"}
              />
            </div>
          )}
          {visitedViews.has("office") && (
            <div style={paneStyle("office")}>
              <CloudWorkspace
                profile={activeProfile}
                locale={locale}
                initialView="office"
                embedded
                active={view === "office"}
                onOpenChat={() => goTo("mithril-chat")}
              />
            </div>
          )}

          {visitedViews.has("providers") && (
            <div style={paneStyle("providers")}>
              {remoteMode ? (
                <RemoteNotice feature="Providers" />
              ) : (
                <Providers
                  profile={activeProfile}
                  visible={view === "providers"}
                />
              )}
            </div>
          )}

          {visitedViews.has("skills") && (
            <div style={paneStyle("skills")}>
              {remoteMode ? (
                <RemoteNotice feature="Skills" />
              ) : (
                <Skills profile={activeProfile} />
              )}
            </div>
          )}

          {visitedViews.has("memory") && (
            <div style={paneStyle("memory")}>
              <CloudWorkspace
                profile={activeProfile}
                locale={locale}
                initialView="memory"
                embedded
                active={view === "memory"}
              />
            </div>
          )}
          {visitedViews.has("tools") && (
            <div style={paneStyle("tools")}>
              <CloudWorkspace
                profile={activeProfile}
                locale={locale}
                initialView="capability"
                embedded
                active={view === "tools"}
              />
            </div>
          )}
          {visitedViews.has("security") && (
            <div style={paneStyle("security")}>
              <CloudSecurity profile={activeProfile} locale={locale} />
            </div>
          )}
          {visitedViews.has("schedules") && (
            <div style={paneStyle("schedules")}>
              <Schedules
                profile={activeProfile}
                locale={locale}
                onOpenSession={(id) => {
                  setCloudResultSession(id);
                  goTo("mithril-chat");
                }}
              />
            </div>
          )}

          {visitedViews.has("kanban") && (
            <div style={paneStyle("kanban")}>
              <CloudWorkspace
                profile={activeProfile}
                locale={locale}
                initialView="kanban"
                embedded
                active={view === "kanban"}
                onOpenChat={() => goTo("mithril-chat")}
              />
            </div>
          )}

          {visitedViews.has("gateway") && (
            <div style={paneStyle("gateway")}>
              {remoteMode ? (
                <RemoteNotice feature="Gateway" />
              ) : (
                <Gateway profile={activeProfile} />
              )}
            </div>
          )}
        </main>
      </div>
      <StatusBar
        activeProfile={activeProfile}
        cloud={
          ![
            "chat",
            "sessions",
            "runs",
            "providers",
            "gateway",
            "settings",
          ].includes(view)
        }
      />
    </div>
  );
}

export default Layout;
