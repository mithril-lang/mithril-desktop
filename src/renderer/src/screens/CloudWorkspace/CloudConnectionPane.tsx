import { useCallback } from "react";
import {
  DesktopConnection,
  settingsTranslator,
} from "@mithril/workspace/desktop-settings";
import { NativeSettingsPane } from "../../components/settings/SettingsModal";

/** The canonical connection stays cloud-based; original executor settings remain available. */
export default function CloudConnectionPane({
  scope,
  locale,
  onManageAccount,
}: {
  scope: string;
  locale: string;
  onManageAccount: () => void;
}): React.JSX.Element {
  const readAccount = useCallback(
    async () => window.hermesAPI.cloudWorkspace.status(),
    [],
  );
  return (
    <DesktopConnection
      platform={{
        kind: "cloud",
        scope,
        t: settingsTranslator(locale),
        readAccount,
        manageAccount: async () => onManageAccount(),
        runtimeSettings: <NativeSettingsPane section="connection" />,
      }}
    />
  );
}
