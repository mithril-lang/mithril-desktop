import { useEffect, useState } from "react";
import OriginalSchedules from "@mithril/workspace/desktop-schedules";
import "@mithril/workspace/desktop-styles.css";

/** Original Desktop screen over the main-owned automatically synchronized mirror. */
// @lat: [[cloud-workspace#Original Schedules screen mirror (draft)]]
export default function CloudSchedules({
  profile,
  locale = "en",
}: {
  profile: string;
  locale?: string;
  onOpenSession?: (id: string) => void;
}): React.JSX.Element {
  const [epoch, setEpoch] = useState(0);
  useEffect(
    () =>
      window.hermesAPI.onCloudWorkspaceAccountChanged(() =>
        setEpoch((value) => value + 1),
      ),
    [],
  );
  return (
    <OriginalSchedules
      key={`${profile}:${epoch}`}
      api={window.hermesAPI}
      profile={profile}
      locale={locale}
    />
  );
}
