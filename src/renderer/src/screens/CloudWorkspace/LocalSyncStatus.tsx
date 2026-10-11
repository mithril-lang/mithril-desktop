import { useEffect, useState } from "react";
import type { LocalWorkspaceSyncStatus } from "../../../../shared/local-workspace";
import "./local-sync.css";

export default function LocalSyncStatus({
  profile,
  locale,
  onReady,
  onReconnect,
}: {
  profile: string;
  locale: string;
  onReady: (ready: boolean) => void;
  onReconnect: () => Promise<void>;
}): React.JSX.Element | null {
  const [status, setStatus] = useState<LocalWorkspaceSyncStatus | null>(null);
  const [error, setError] = useState("");
  const api = window.hermesAPI.cloudWorkspace.localSync;
  const ja = locale.startsWith("ja");
  useEffect(() => {
    if (!api) return;
    let active = true,
      request = 0;
    setStatus(null);
    const refresh = (): void => {
      const current = ++request;
      void api
        .status()
        .then((value) => {
          if (active && request === current) {
            setStatus(value);
            setError("");
            onReady(value.ready && !!value.userId);
          }
        })
        .catch((cause) => {
          if (active) setError(String(cause));
        });
    };
    onReady(false);
    refresh();
    void window.hermesAPI.cloudWorkspace
      .enable()
      .then(refresh)
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    const stop = api.onChanged(refresh);
    return () => {
      active = false;
      stop();
    };
  }, [api, profile, onReady]);
  if (!api) return null;
  const text = !status?.ready
    ? ja
      ? "初回データを読み込んでいます…"
      : "Loading initial workspace data…"
    : status.conflicts.length
      ? ja
        ? "別端末の変更と競合しています。両方の内容を保持しています。"
        : "Changes conflict with another device. Both versions are retained."
      : status.phase === "blocked"
        ? ja
          ? "同期を停止しています。保存した変更は保持されています。"
          : "Sync stopped. Saved changes are retained."
        : status.phase === "offline"
          ? ja
            ? `オフライン・この端末に保存済み（未同期 ${status.pending} 件）`
            : `Offline · saved on this device (${status.pending} pending)`
          : status.pending
            ? ja
              ? `この端末に保存済み・同期を待っています（${status.pending} 件）`
              : `Saved on this device · ${status.pending} changes waiting to sync`
            : status.lastSyncedAt
              ? ja
                ? "ローカルから表示・クラウドと同期済み"
                : "Displaying local data · cloud synced"
              : ja
                ? "ローカルから表示・クラウドを確認中"
                : "Displaying local data · checking cloud";
  const notice = error || (status?.phase === "blocked" ? status.message : "");
  return (
    <aside
      className="desktop-local-sync"
      aria-label={ja ? "同期状態" : "Sync status"}
    >
      <span role="status">{text}</span>
      <button
        type="button"
        onClick={() =>
          void api
            .synchronize()
            .then(setStatus)
            .catch((cause) => {
              setError(String(cause));
              void onReconnect().catch(() => undefined);
            })
        }
      >
        {ja ? "同期を再試行" : "Retry sync"}
      </button>
      {notice && <p role="alert">{notice}</p>}
      {status?.conflicts.map((conflict) => (
        <details key={conflict.operationId}>
          <summary>{conflict.key}</summary>
          <p>{ja ? "この端末" : "This device"}</p>
          <pre>{JSON.stringify(conflict.local, null, 2)}</pre>
          <p>{ja ? "クラウド" : "Cloud"}</p>
          <pre>{JSON.stringify(conflict.cloud, null, 2)}</pre>
          <button
            onClick={() =>
              void api
                .resolve(conflict.operationId, "local")
                .catch((cause) => setError(String(cause)))
            }
          >
            {ja ? "この端末の変更を保存" : "Keep this change"}
          </button>
          <button
            onClick={() =>
              void api
                .resolve(conflict.operationId, "cloud")
                .catch((cause) => setError(String(cause)))
            }
          >
            {ja ? "クラウドの変更を使用" : "Use cloud change"}
          </button>
        </details>
      ))}
    </aside>
  );
}
