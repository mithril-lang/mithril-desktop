import { DesktopLogs } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";
export default function LogsPane(): React.JSX.Element {
  const data = useSettings();
  return (
    <DesktopLogs
      platform={{
        ...data,
        ...useI18n(),
        scope: data.profile,
        readLogs: window.hermesAPI.readLogs,
      }}
    />
  );
}
