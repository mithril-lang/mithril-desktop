import * as Dialog from "@radix-ui/react-dialog";
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
      <Dialog.Root open={legacyOpen} onOpenChange={setLegacyOpen}>
        <Dialog.Trigger asChild>
          <button type="button" className="device-history-button">
            {locale.startsWith("ja")
              ? "端末のスケジュールを開く"
              : "Schedules on this device"}
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="device-history-backdrop" />
          <Dialog.Content
            className="device-history-dialog device-schedules-dialog"
            aria-describedby={undefined}
          >
            <Dialog.Close asChild>
              <button type="button" className="device-history-close">
                {locale.startsWith("ja") ? "閉じる" : "Close"}
              </button>
            </Dialog.Close>
            <Dialog.Title>
              {locale.startsWith("ja")
                ? "端末のスケジュール"
                : "Schedules on this device"}
            </Dialog.Title>
            <LegacySchedules profile={profile} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
