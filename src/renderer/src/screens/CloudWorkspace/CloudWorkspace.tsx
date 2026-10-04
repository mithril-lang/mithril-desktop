import type { RuntimeSection } from "@mithril/workspace/runtime";
import { useCallback, useEffect, useState } from "react";
import {
  WorkspaceApp,
  type DiscoverItem,
  type WorkspaceView,
} from "@mithril/workspace/react";
import "@mithril/workspace/styles.css";

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
      locale={locale}
      active={active}
    />
  );
}
