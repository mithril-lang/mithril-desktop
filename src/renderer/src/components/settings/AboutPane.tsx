import { DesktopAbout } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";
import BrandLogo from "../common/BrandLogo";
import hermesIcon from "@mithril/design-system/mithril-mark.svg";
import pythonLogo from "../../assets/logos/python.svg";
import openaiLogo from "../../assets/logos/openai.svg";
import { ConfigHealth } from "../../screens/Settings/ConfigHealth";
export default function AboutPane(): React.JSX.Element {
  const data = useSettings();
  return (
    <DesktopAbout
      platform={{
        ...data,
        ...useI18n(),
        BrandLogo,
        hermesIcon,
        pythonLogo,
        openaiLogo,
        configHealth: <ConfigHealth profile={data.profile} />,
        runHermesDump: window.hermesAPI.runHermesDump,
      }}
    />
  );
}
