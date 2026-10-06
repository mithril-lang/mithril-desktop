import { DesktopLanguage } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { useChatPreferences } from "../ChatPreferencesProvider";
export default function LanguagePane(): React.JSX.Element {
  return (
    <DesktopLanguage platform={{ ...useI18n(), ...useChatPreferences() }} />
  );
}
