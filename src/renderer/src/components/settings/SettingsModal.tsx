import { DesktopSettingsModal } from "@mithril/workspace/desktop-settings";
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
export default function SettingsModal({
  profile,
  ...props
}: SettingsModalProps): React.JSX.Element {
  const { t } = useI18n();
  const data = useSettingsData(profile);
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
  return (
    <SettingsDataContext.Provider value={data}>
      <DesktopSettingsModal
        {...props}
        t={t}
        renderPane={(section) => {
          const Pane = panes[section];
          return <Pane />;
        }}
      />
    </SettingsDataContext.Provider>
  );
}
