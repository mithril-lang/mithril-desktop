import { useCallback, useEffect, useState } from "react";
import { WorkspaceApp, type DiscoverItem } from "@mithril/workspace/react";
import "@mithril/workspace/styles.css";

// @lat: [[cloud-workspace#Cloud workspace#Shared screens]]
export default function CloudWorkspace({
  profile,
  locale = "en",
  active = true,
}: {
  profile: string;
  locale?: string;
  active?: boolean;
}): React.JSX.Element {
  const [identityEpoch, setIdentityEpoch] = useState(0);
  useEffect(
    () =>
      window.hermesAPI.onCloudWorkspaceAccountChanged(() =>
        setIdentityEpoch((epoch) => epoch + 1),
      ),
    [],
  );
  const loadCatalog = useCallback(async (): Promise<DiscoverItem[]> => {
    const catalog = await window.hermesAPI.fetchRegistry();
    if (
      catalog.error &&
      Object.values(catalog).every(
        (value) => !Array.isArray(value) || value.length === 0,
      )
    )
      throw new Error("Registry unavailable");
    return [
      catalog.skills,
      catalog.mcps,
      catalog.agents,
      catalog.workflows,
      catalog.plugins,
    ]
      .flat()
      .filter(
        (item) =>
          item.registry === "mithril" &&
          item.path &&
          /^[a-zA-Z0-9/_\-.]+$/.test(item.path) &&
          !item.path.includes(".."),
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        href: `https://github.com/mithril-lang/mithril-registry/tree/main/${item.path}`,
      }));
  }, []);
  return (
    <WorkspaceApp
      key={profile}
      transport={window.hermesAPI.cloudWorkspace}
      beforeConnect={async () => {
        await window.hermesAPI.cloudWorkspace.enable();
      }}
      afterDisconnect={() => window.hermesAPI.cloudWorkspace.disable()}
      identityEpoch={`${profile}:${identityEpoch}`}
      loadCatalog={loadCatalog}
      locale={locale}
      active={active}
    />
  );
}
