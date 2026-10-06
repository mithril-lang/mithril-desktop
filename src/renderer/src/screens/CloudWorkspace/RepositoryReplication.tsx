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
  const replication = useRepositoryReplication(
    owner,
    window.hermesAPI.cloudWorkspace.repository,
    enabled ? window.hermesAPI.cloudWorkspace.replica : undefined,
    `${profile}:${epoch}`,
  );
  const ja = locale.startsWith("ja");
  const notice = connectionNotice || replication.notice;
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
