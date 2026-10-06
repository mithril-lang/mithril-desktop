import { useMemo } from "react";
import {
  DesktopDiscover,
  DiscoverPlatform,
  type RegistryKind,
} from "@mithril/workspace/desktop-discover";
import "@mithril/workspace/desktop-discover.css";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { OrbLoader } from "../../components/OrbLoader";
import { useI18n } from "../../components/useI18n";

// @lat: [[discover#Original Discover#Shared marketplace]]
export default function Discover(props: {
  profile?: string;
  visible?: boolean;
  focusKind?: { kind: RegistryKind; nonce: number };
}): React.JSX.Element {
  const { t } = useI18n();
  const platform = useMemo(
    () => ({
      api: window.hermesAPI,
      t,
      Markdown: AgentMarkdown,
      Loader: OrbLoader,
    }),
    [t],
  );
  return (
    <DiscoverPlatform value={platform}>
      <DesktopDiscover {...props} />
    </DiscoverPlatform>
  );
}
