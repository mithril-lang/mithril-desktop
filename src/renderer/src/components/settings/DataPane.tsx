import type { RestoreIntent } from "@mithril/workspace/archive-client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { storageExecutionReviewJournal } from "@mithril/workspace/execution-review";
import { DesktopData } from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";
export default function DataPane(): React.JSX.Element {
  const settings = useSettings(),
    i18n = useI18n();
  const [pending, setPending] = useState<RestoreIntent | null>(null);
  const current = useRef<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setOwner(null);
    setPending(null);
    void (async () => {
      try {
        const value = await window.hermesAPI.cloudWorkspace.status();
        if (active) {
          setOwner(value.userId);
          if (value.userId) {
            const pending =
              await window.hermesAPI.cloudWorkspace.archive.pending(
                value.userId,
              );
            if (active) setPending(pending);
          }
        }
      } catch {
        /* Remain signed out when IPC is unavailable. */
      }
    })();
    return () => {
      active = false;
    };
  }, [settings.profile]);
  useLayoutEffect(() => {
    current.current = owner;
    return () => {
      current.current = null;
    };
  }, [owner]);
  const archive = useMemo(() => {
    const checkedOwner = (): string => {
      if (!owner || current.current !== owner) throw Error("Account changed");
      return owner;
    };
    return {
      locale: i18n.locale,
      client: {
        owner: owner ?? "",
        pendingRestore: () => pending,
        commitRestore: async (confirmed: boolean) => {
          await window.hermesAPI.cloudWorkspace.archive.commit(
            checkedOwner(),
            confirmed,
          );
          checkedOwner();
          setPending(null);
        },
      },
      exportAndSave: async () => {
        await window.hermesAPI.cloudWorkspace.archive.exportAndSave(
          checkedOwner(),
        );
        checkedOwner();
      },
      chooseAndPrepare: async () => {
        const intent =
          await window.hermesAPI.cloudWorkspace.archive.chooseAndPrepare(
            checkedOwner(),
          );
        checkedOwner();
        setPending(intent);
        return intent;
      },
      restored: () => {
        checkedOwner();
        window.location.reload();
      },
    };
  }, [owner, pending, i18n.locale]);
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
  return (
    <DesktopData
      platform={{ ...settings, ...i18n, archive, executionReview }}
    />
  );
}
