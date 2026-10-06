import { useEffect, useState } from "react";
import { useRepositoryReplication } from "@mithril/workspace/repository-react";

/** One background reconciler for the application, independent of the active screen. */
export default function RepositoryReplication({
  profile,
  locale,
  enabled,
}: {
  profile: string;
  locale: string;
  enabled: boolean;
}): React.JSX.Element | null {
  const [owner, setOwner] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [historyNotice, setHistoryNotice] = useState("");
  useEffect(
    () =>
      window.hermesAPI.onCloudWorkspaceAccountChanged(() => {
        setOwner(null);
        setEpoch((value) => value + 1);
      }),
    [],
  );
  useEffect(() => {
    let active = true;
    setOwner(null);
    setHistoryNotice("");
    if (enabled)
      void window.hermesAPI.cloudWorkspace
        .status()
        .then((status) =>
          status.userId ? window.hermesAPI.cloudWorkspace.enable() : status,
        )
        .then((status) => {
          if (active) {
            setOwner(status.userId);
            setConnectionNotice("");
          }
        })
        .catch((error) => {
          if (active)
            setConnectionNotice(
              error instanceof Error ? error.message : String(error),
            );
        });
    return () => {
      active = false;
    };
  }, [profile, epoch, enabled]);
  useEffect(() => {
    if (!enabled || !owner) return;
    let active = true,
      busy = false;
    const run = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const result = await window.hermesAPI.cloudChat.syncNativeHistory();
        if (result.userId !== owner) throw Error("History owner changed");
        if (active)
          setHistoryNotice(
            result.conflicts.length || result.deferred.length
              ? locale.startsWith("ja")
                ? `${result.conflicts.length + result.deferred.length} 件のチャットが同期の確認待ちです。元の履歴は保持されています。`
                : `${result.conflicts.length + result.deferred.length} chats need synchronization review. Original history is retained.`
              : "",
          );
      } catch (error) {
        if (active)
          setHistoryNotice(
            error instanceof Error
              ? error.message
              : "History synchronization unavailable",
          );
      } finally {
        busy = false;
      }
    };
    void run();
    const timer = setInterval(() => void run(), 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, owner, profile, epoch, locale]);
  const replication = useRepositoryReplication(
    owner,
    window.hermesAPI.cloudWorkspace.repository,
    enabled ? window.hermesAPI.cloudWorkspace.replica : undefined,
    `${profile}:${epoch}`,
  );
  const ja = locale.startsWith("ja");
  const notice = connectionNotice || replication.notice || historyNotice;
  if (
    !enabled ||
    (!notice && !replication.conflicts.length && !replication.deferred)
  )
    return null;
  const resolve = (key: string, choice: "local" | "cloud"): void => {
    void replication
      .resolve(key, choice)
      .catch((error) =>
        setConnectionNotice(
          error instanceof Error ? error.message : String(error),
        ),
      );
  };
  return (
    <aside
      className="repository-sync-notice"
      aria-label={ja ? "同期の状態" : "Synchronization status"}
    >
      {notice && <p role="status">{notice}</p>}
      {!!replication.deferred && (
        <details>
          <summary>
            {ja
              ? `${replication.deferred} 件の変更が反映待ちです`
              : `${replication.deferred} changes are awaiting application`}
          </summary>
          <p>
            {ja
              ? "実行中の作業や、まだ対応していないデータ形式への反映を保留しています。データは保持されています。"
              : "Busy work or unsupported native data formats are deferred. Data is retained."}
          </p>
        </details>
      )}
      {replication.conflicts.map((conflict) => (
        <details key={conflict.key}>
          <summary>
            {ja ? "変更の確認が必要です" : "Changes need review"}
          </summary>
          <pre>{JSON.stringify(conflict.local?.body, null, 2)}</pre>
          <pre>{JSON.stringify(conflict.cloud?.body, null, 2)}</pre>
          <button onClick={() => resolve(conflict.key, "local")}>
            {ja ? "この変更を保存" : "Keep this change"}
          </button>
          <button onClick={() => resolve(conflict.key, "cloud")}>
            {ja ? "同期された変更を使用" : "Use synchronized change"}
          </button>
        </details>
      ))}
    </aside>
  );
}
