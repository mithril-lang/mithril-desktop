import "@mithril/workspace/desktop-sidebar.css";
import { useMemo, type ComponentProps } from "react";
import toast from "react-hot-toast";
import {
  DesktopSidebarSessionMenu,
  SidebarPlatform,
} from "@mithril/workspace/desktop-sidebar";
import { useI18n } from "../../components/useI18n";

export type {
  SidebarMenuProject,
  SidebarMenuTarget,
} from "@mithril/workspace/desktop-sidebar";

export default function SidebarSessionMenu(
  props: ComponentProps<typeof DesktopSidebarSessionMenu>,
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
      <DesktopSidebarSessionMenu {...props} />
    </SidebarPlatform>
  );
}
