import { useEffect, useState } from "react";
import { CloudSecurity as SharedSecurity } from "@mithril/workspace/security-react";
import { WorkspaceNavigation } from "@mithril/design-system/react";
import { Shield, Cloud } from "lucide-react";
import EndpointProtection from "./EndpointProtection";
// @lat: [[cloud-workspace#Cloud workspace#Security diagnostics]]
export default function CloudSecurity({
  profile,
  locale,
}: {
  profile: string;
  locale: string;
}): React.JSX.Element {
  const [epoch, setEpoch] = useState(0);
  const [tab, setTab] = useState("endpoint");
  useEffect(
    () =>
      window.hermesAPI.onCloudWorkspaceAccountChanged(() =>
        setEpoch((v) => v + 1),
      ),
    [],
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceNavigation
        label={locale.startsWith("ja") ? "セキュリティ" : "Security"}
        items={[
          {
            id: "endpoint",
            label: locale.startsWith("ja") ? "この端末の保護" : "This device",
            icon: <Shield size={16} />,
            active: tab === "endpoint",
            onSelect: () => setTab("endpoint"),
          },
          {
            id: "cloud",
            label: locale.startsWith("ja")
              ? "クラウド診断"
              : "Cloud diagnostics",
            icon: <Cloud size={16} />,
            active: tab === "cloud",
            onSelect: () => setTab("cloud"),
          },
        ]}
      />
      <div className="min-h-0 flex-1">
        {tab === "endpoint" ? (
          <EndpointProtection locale={locale} />
        ) : (
          <SharedSecurity
            key={`${profile}:${epoch}`}
            transport={window.hermesAPI.cloudWorkspace.security}
            locale={locale}
            beforeConnect={() =>
              window.hermesAPI.cloudWorkspace.enable().then(() => undefined)
            }
          />
        )}
      </div>
    </div>
  );
}
