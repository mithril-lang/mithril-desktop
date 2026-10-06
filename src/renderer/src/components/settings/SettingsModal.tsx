import { DesktopSettingsModal } from "@mithril/workspace/desktop-settings";
import type { SettingsSection } from "@mithril/workspace/desktop-settings";
import type { ReactNode } from "react";
export type { SettingsSection } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { useSettingsData } from "./useSettingsData";
import { SettingsDataContext } from "./SettingsDataContext";
import AppearancePane from "./AppearancePane";
import LanguagePane from "./LanguagePane";
import PrivacyPane from "./PrivacyPane";
import ConnectionPane from "./ConnectionPane";
import DataPane from "./DataPane";
import AboutPane from "./AboutPane";
import CommunityPane from "./CommunityPane";
import LogsPane from "./LogsPane";
import NotificationsPane from "./NotificationsPane";
interface SettingsModalProps {
  open: boolean;
  profile?: string;
  initialSection?: string;
  onClose: () => void;
  onExited?: () => void;
}
const panes = {
  appearance: AppearancePane,
  language: LanguagePane,
  notifications: NotificationsPane,
  privacy: PrivacyPane,
  connection: ConnectionPane,
  data: DataPane,
  about: AboutPane,
  community: CommunityPane,
  logs: LogsPane,
};
/** Original native effects remain consumer-owned while both routes share the same modal. */
export function NativeSettingsProvider({
  profile,
  children,
}: {
  profile?: string;
  children: ReactNode;
}): React.JSX.Element {
  const data = useSettingsData(profile);
  return (
    <SettingsDataContext.Provider value={data}>
      {children}
    </SettingsDataContext.Provider>
  );
}
export function NativeSettingsPane({
  section,
}: {
  section: SettingsSection;
}): React.JSX.Element {
  const Pane = panes[section];
  return <Pane />;
}
export default function SettingsModal({
  profile,
  ...props
}: SettingsModalProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <NativeSettingsProvider profile={profile}>
      <DesktopSettingsModal
        {...props}
        t={t}
        renderPane={(section) => <NativeSettingsPane section={section} />}
      />
    </NativeSettingsProvider>
  );
}
