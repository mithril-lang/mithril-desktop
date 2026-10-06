import { DesktopPrivacy } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { setAnalyticsConsent } from "../../utils/analytics";
import { useSettings } from "./SettingsDataContext";
export default function PrivacyPane(): React.JSX.Element {
  const { analyticsEnabled, setAnalyticsEnabled } = useSettings();
  return (
    <DesktopPrivacy
      platform={{
        ...useI18n(),
        analyticsEnabled,
        setAnalyticsEnabled,
        setAnalyticsConsent,
      }}
    />
  );
}
