import { useEffect, useState } from "react";
import OriginalSchedules from "@mithril/workspace/desktop-schedules";
import { UnifiedSchedulesAPI } from "@mithril/workspace/unified-schedules-api";
import "@mithril/workspace/desktop-styles.css";

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
    <ScheduleConnection
      key={`${profile}:${epoch}`}
      profile={profile}
      locale={locale}
    />
  );
}

function ScheduleConnection({
  profile,
  locale,
}: {
  profile: string;
  locale: string;
}): React.JSX.Element {
  const [api, setAPI] = useState<UnifiedSchedulesAPI | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    // Invalidate immediately, before React commits the replacement screen.
    const unsubscribe = window.hermesAPI.onCloudWorkspaceAccountChanged(() => {
      active = false;
    });
    const cloud = window.hermesAPI.cloudWorkspace;
    void cloud
      .status()
      .then((status) => {
        if (!active) return;
        if (!status.userId) throw Error("Schedule connection unavailable");
        const owner = status.userId;
        setAPI(
          new UnifiedSchedulesAPI({
            owner,
            profile,
            original: window.hermesAPI,
            cloud: cloud.schedules,
            operationId: () => crypto.randomUUID(),
            check: async () => {
              if (!active) throw Error("Schedule connection changed");
              const current = await cloud.status();
              if (!active || current.userId !== owner)
                throw Error("Schedule connection changed");
            },
          }),
        );
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [profile, attempt]);
  if (api)
    return <OriginalSchedules api={api} profile={profile} locale={locale} />;
  return (
    <div role="status">
      {failed ? (
        <button onClick={() => setAttempt((value) => value + 1)}>
          {locale === "ja" ? "再接続" : "Reconnect"}
        </button>
      ) : locale === "ja" ? (
        "接続中…"
      ) : (
        "Connecting…"
      )}
    </div>
  );
}
