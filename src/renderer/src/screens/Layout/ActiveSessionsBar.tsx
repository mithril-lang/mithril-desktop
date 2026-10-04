import { ChatTabs } from "@mithril/design-system/react";
import { memo } from "react";
import { OrbLoader } from "../../components/OrbLoader";
import { useI18n } from "../../components/useI18n";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import type { ChatRun } from "./chatRuns";

export interface ProfileAppearance {
  color?: string | null;
  avatar?: string | null;
}

/**
 * The window's top strip. Doubles as the title-bar drag region (browser-style):
 * the strip itself is draggable, while the conversation chips on top of it stay
 * clickable. When several sessions are open (background sessions / multi-agent)
 * it shows a chip per session to switch between them and watch each stream live.
 * With only a blank scratch conversation it renders empty — just a drag area —
 * so no vertical space is wasted before there is a real session to show.
 */
export const ActiveSessionsBar = memo(function ActiveSessionsBar({
  runs,
  activeRunId,
  onSelect,
  onClose,
  onNew,
  getAppearance,
}: {
  runs: ChatRun[];
  activeRunId: string;
  onSelect: (runId: string) => void;
  /** Close (and stop, if running) a conversation tab. */
  onClose: (runId: string) => void;
  /** Open a fresh conversation tab (browser-style new-tab button). */
  onNew: () => void;
  /** Resolve a profile's avatar/colour for its chip. */
  getAppearance?: (profile: string) => ProfileAppearance;
}): React.JSX.Element {
  const { t } = useI18n();

  const anyLoading = runs.some((r) => r.loading);
  const hasRealSession = runs.some((r) => r.sessionId || r.title);
  // Nothing real to switch to yet → leave the strip empty (pure drag area).
  const showChips = runs.length > 1 || anyLoading || hasRealSession;

  return (
    <ChatTabs
      showTabs={showChips}
      activeId={activeRunId}
      tabs={runs.map((run) => {
        const appearance = getAppearance?.(run.profile);
        return {
          id: run.runId,
          title: run.title || t("sessions.newConversation"),
          description: `${run.profile} — ${run.title || t("sessions.newConversation")}`,
          busy: run.loading,
          avatar: run.loading ? (
            <OrbLoader state="composing" size={20} />
          ) : (
            <ProfileAvatar
              name={run.profile}
              color={appearance?.color}
              avatar={appearance?.avatar}
              size={18}
            />
          ),
        };
      })}
      onSelect={onSelect}
      onClose={onClose}
      onNew={onNew}
      newLabel={t("sessions.newConversation")}
      closeLabel={t("sessions.closeTab")}
    />
  );
});
