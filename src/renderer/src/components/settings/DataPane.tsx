import { DesktopData } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";
export default function DataPane(): React.JSX.Element {
  return <DesktopData platform={{ ...useSettings(), ...useI18n() }} />;
}
