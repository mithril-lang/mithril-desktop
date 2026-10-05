import { useCallback, useEffect, useState } from "react";
import { CloudSchedules as SharedSchedules } from "@mithril/workspace/schedules-react";
import "@mithril/workspace/styles.css";
import LegacySchedules from "../Schedules/Schedules";
// @lat: [[cloud-workspace#Cloud workspace#Cloud schedules]]
export default function CloudSchedules({
  profile,
  locale = "en",
  onOpenSession,
}: {
  profile: string;
  locale?: string;
  onOpenSession?: (id: string) => void;
}): React.JSX.Element {
  const [epoch, setEpoch] = useState(0);
  const [legacyOpen, setLegacyOpen] = useState(false);
  useEffect(
    () =>
      window.hermesAPI.onCloudWorkspaceAccountChanged(() =>
        setEpoch((v) => v + 1),
      ),
    [],
  );
  const beforeConnect = useCallback(async () => {
    await window.hermesAPI.cloudWorkspace.enable();
  }, []);
  const models = useCallback(async () => {
    await window.hermesAPI.cloudChat.enable();
    return window.hermesAPI.cloudChat.models();
  }, []);
  return (
    <>
      <SharedSchedules
        key={`${profile}:${epoch}`}
        transport={window.hermesAPI.cloudWorkspace.schedules}
        beforeConnect={beforeConnect}
        locale={locale}
        loadModels={models}
        previewNative={() => window.hermesAPI.cloudWorkspace.previewSchedules()}
        onOpenSession={onOpenSession}
      />
      <details onToggle={(event) => setLegacyOpen(event.currentTarget.open)}>
        <summary>
          {locale.startsWith("ja")
            ? "この端末の旧スケジュールを管理"
            : "Manage legacy schedules on this device"}
        </summary>
        {legacyOpen && <LegacySchedules profile={profile} />}
      </details>
    </>
  );
}
