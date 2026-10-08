import { useEffect, useMemo, useState } from "react";
import { storageExecutionReviewJournal } from "@mithril/workspace/execution-review";
import { DesktopData } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";
export default function DataPane(): React.JSX.Element {
  const settings = useSettings(),
    i18n = useI18n();
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setOwner(null);
    void (async () => {
      try {
        const value = await window.hermesAPI.cloudWorkspace.status();
        if (active) setOwner(value.userId);
      } catch {
        /* Remain signed out when IPC is unavailable. */
      }
    })();
    return () => {
      active = false;
    };
  }, [settings.profile]);
  const executionReview = useMemo(
    () => ({
      owner,
      scope: JSON.stringify([owner, settings.profile]),
      locale: i18n.locale,
      transport: window.hermesAPI.cloudWorkspace.executionReview,
      journal: storageExecutionReviewJournal(localStorage),
    }),
    [owner, settings.profile, i18n.locale],
  );
  return <DesktopData platform={{ ...settings, ...i18n, executionReview }} />;
}
