import "@mithril/workspace/desktop-sidebar.css";
import { useMemo, type ComponentProps } from "react";
import toast from "react-hot-toast";
import {
  DesktopSidebarRecentSessions,
  SidebarPlatform,
} from "@mithril/workspace/desktop-sidebar";
import { useI18n } from "../../components/useI18n";

export { RECENT_SESSIONS_PAGE_SIZE } from "@mithril/workspace/desktop-sidebar";

/** Original shared list; IPC and translations stay in the Desktop consumer. */
export default function SidebarRecentSessions(
  props: ComponentProps<typeof DesktopSidebarRecentSessions>,
): React.JSX.Element {
  const { t } = useI18n();
  const value = useMemo(
    () => ({
      api: window.hermesAPI,
      t,
      reportError: (message: string) => {
        toast.error(message);
      },
    }),
    [t],
  );
  return (
    <SidebarPlatform value={value}>
      <DesktopSidebarRecentSessions {...props} />
    </SidebarPlatform>
  );
}
