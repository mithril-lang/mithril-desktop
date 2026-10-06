import { useTheme } from "../../components/ThemeProvider";
import { useI18n } from "../../components/useI18n";
import { APP_LOCALES, type AppLocale } from "../../../../shared/i18n";
import { portableRepositorySeeds } from "@mithril/workspace/repository-migration";
import type { RuntimeSection } from "@mithril/workspace/runtime";
import { useCallback, useEffect, useState } from "react";
import {
  WorkspaceApp,
  type DiscoverItem,
  type WorkspaceView,
} from "@mithril/workspace/react";
import "@mithril/workspace/styles.css";
import "@mithril/workspace/desktop-styles.css";

// @lat: [[cloud-workspace#Cloud workspace#Shared screens]]
export default function CloudWorkspace({
  profile,
  initialView,
  embedded = false,
  discoverFocus,
  locale = "en",
  active = true,
  onOpenNativeSection,
  onOpenChat,
}: {
  profile: string;
  initialView?: WorkspaceView;
  embedded?: boolean;
  discoverFocus?: { kind: "skills" | "mcps"; nonce: number };
  locale?: string;
  active?: boolean;
  onOpenNativeSection?: (section: RuntimeSection) => void;
  onOpenChat?: () => void;
}): React.JSX.Element {
  const { setTheme } = useTheme();
  const { setLocale } = useI18n();
  const preferences = useCallback(
    (data: Record<string, unknown>): void => {
      if (
        data.theme === "dark" ||
        data.theme === "light" ||
        data.theme === "system"
      )
        setTheme(data.theme);
      if (
        typeof data.locale === "string" &&
        (APP_LOCALES as readonly string[]).includes(data.locale)
      )
        setLocale(data.locale as AppLocale);
    },
    [setTheme, setLocale],
  );
  const [identityEpoch, setIdentityEpoch] = useState(0);
  useEffect(
    () =>
      window.hermesAPI.onCloudWorkspaceAccountChanged(() =>
        setIdentityEpoch((epoch) => epoch + 1),
      ),
    [],
  );
  const loadCatalog = useCallback(
    (): Promise<DiscoverItem[]> => window.hermesAPI.cloudWorkspace.catalog(),
    [],
  );
  const repositorySeed = useCallback(async () => {
    const portable = portableRepositorySeeds(
      await window.hermesAPI.cloudWorkspace.getSnapshot(),
    );
    return portable;
  }, []);
  const beforeConnect = useCallback(async () => {
    await window.hermesAPI.cloudWorkspace.enable();
  }, []);
  return (
    <WorkspaceApp
      key={profile}
      initialView={initialView}
      embedded={embedded}
      discoverFocus={discoverFocus}
      autoConnect
      repositoryTransport={window.hermesAPI.cloudWorkspace.repository}
      repositorySeed={repositorySeed}
      capabilitySeed={window.hermesAPI.cloudWorkspace.capabilitySnapshot}
      capabilityRuntime={window.hermesAPI}
      memoryProfile={profile}
      memorySeed={window.hermesAPI.cloudWorkspace.memorySnapshot}
      memoryRuntime={window.hermesAPI}
      transport={window.hermesAPI.cloudWorkspace}
      fileTransport={window.hermesAPI.cloudWorkspace.files}
      folderAdapter={window.hermesAPI.projectFolderSync}
      runtimeAdapter={window.hermesAPI.nativeWorkspace}
      onOpenNativeSection={onOpenNativeSection}
      onOpenChat={onOpenChat}
      beforeConnect={beforeConnect}
      afterDisconnect={() => window.hermesAPI.cloudWorkspace.disable()}
      identityEpoch={`${profile}:${identityEpoch}`}
      loadCatalog={loadCatalog}
      onPreferences={preferences}
      locale={locale}
      active={active}
    />
  );
}
