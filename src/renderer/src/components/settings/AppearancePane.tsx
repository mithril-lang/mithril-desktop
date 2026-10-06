import { DesktopAppearance } from "@mithril/workspace/desktop-settings";
import { useTheme } from "../ThemeProvider";
import { useFont } from "../FontProvider";
import { useI18n } from "../useI18n";
export default function AppearancePane(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const font = useFont();
  return (
    <DesktopAppearance
      platform={{ t, ...theme, ...font, gpu: window.hermesAPI }}
    />
  );
}
