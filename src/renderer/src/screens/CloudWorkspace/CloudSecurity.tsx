import { useEffect, useState } from "react";
import { CloudSecurity as SharedSecurity } from "@mithril/workspace/security-react";
// @lat: [[cloud-workspace#Cloud workspace#Security diagnostics]]
export default function CloudSecurity({
  profile,
  locale,
}: {
  profile: string;
  locale: string;
}): React.JSX.Element {
  const [epoch, setEpoch] = useState(0);
  useEffect(
    () =>
      window.hermesAPI.onCloudWorkspaceAccountChanged(() =>
        setEpoch((v) => v + 1),
      ),
    [],
  );
  return (
    <SharedSecurity
      key={`${profile}:${epoch}`}
      transport={window.hermesAPI.cloudWorkspace.security}
      locale={locale}
      beforeConnect={() =>
        window.hermesAPI.cloudWorkspace.enable().then(() => undefined)
      }
    />
  );
}
