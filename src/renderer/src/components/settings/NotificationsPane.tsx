import { DesktopNotifications } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { useChatPreferences } from "../ChatPreferencesProvider";
export default function NotificationsPane(): React.JSX.Element {
  return (
    <DesktopNotifications
      platform={{ ...useI18n(), ...useChatPreferences() }}
    />
  );
}
