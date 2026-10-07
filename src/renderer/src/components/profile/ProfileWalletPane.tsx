import { DesktopProfileWalletPane } from "@mithril/workspace/desktop-profile-wallet";
import { Check, Copy, Refresh, Trash, Wallet, X } from "../../assets/icons";
import etheriumIcon from "../../assets/icons/etherium.webp";
import hdTokenIcon from "../../assets/icons/hdtoken.webp";
import { useI18n } from "../useI18n";
import { OrbLoader } from "../OrbLoader";

const tokenIcons = { eth: etheriumIcon, hd: hdTokenIcon };
const icons = { Check, Copy, Refresh, Trash, Wallet, X };
export default function ProfileWalletPane({
  profile,
}: {
  profile: string;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <DesktopProfileWalletPane
      key={profile}
      profile={profile}
      api={window.hermesAPI}
      t={t}
      tokenIcons={tokenIcons}
      icons={icons}
      loading={<OrbLoader state="searching" size={64} />}
    />
  );
}
