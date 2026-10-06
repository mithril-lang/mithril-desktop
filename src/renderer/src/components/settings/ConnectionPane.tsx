import { DesktopConnection } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";
import SshDockerTargetSection from "./SshDockerTargetSection";
const generateApiServerKey = (profile?: string): Promise<unknown> =>
  window.hermesAPI.generateApiServerKey(profile);
const saveForceIpv4 = (enabled: boolean, profile?: string): Promise<boolean> =>
  window.hermesAPI.setConfig(
    "network.force_ipv4",
    enabled ? "true" : "false",
    profile,
  );
export default function ConnectionPane(): React.JSX.Element {
  return (
    <DesktopConnection
      platform={{
        ...useSettings(),
        ...useI18n(),
        generateApiServerKey,
        saveForceIpv4,
        SshDockerTargetSection,
      }}
    />
  );
}
