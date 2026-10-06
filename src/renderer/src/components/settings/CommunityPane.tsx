import { DesktopCommunity } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import BrandLogo from "../common/BrandLogo";
import xLogo from "../../assets/logos/twitter.svg";
import {
  DISCORD_COMMUNITY_URL,
  HERMES_TELEGRAM_URL,
  HERMES_WEBSITE_URL,
  HERMES_X_URL,
  KOFI_SUPPORT_URL,
} from "./settingsHelpers";
export default function CommunityPane(): React.JSX.Element {
  return (
    <DesktopCommunity
      platform={{
        ...useI18n(),
        BrandLogo,
        xLogo,
        openExternal: window.hermesAPI.openExternal,
        links: {
          discord: DISCORD_COMMUNITY_URL,
          website: HERMES_WEBSITE_URL,
          x: HERMES_X_URL,
          telegram: HERMES_TELEGRAM_URL,
          support: KOFI_SUPPORT_URL,
        },
      }}
    />
  );
}
