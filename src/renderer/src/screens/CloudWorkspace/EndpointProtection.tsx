import { useCallback, useEffect, useState } from "react";
import { ToolActivity } from "@mithril/design-system/react";
import type { EndpointStatus } from "../../../../shared/endpoint-protection";
const buttonClass =
  "rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-hover)] disabled:opacity-50";

export default function EndpointProtection({
  locale,
}: {
  locale: string;
}): React.JSX.Element {
  const ja = locale.startsWith("ja");
  const [status, setStatus] = useState<EndpointStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setStatus(await window.hermesAPI.endpoint.status());
    } catch {
      setError(
        ja
          ? "端末保護の状態を取得できませんでした。"
          : "Could not read endpoint protection status.",
      );
    }
  }, [ja]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function action(run: () => Promise<EndpointStatus>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setStatus(await run());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Endpoint operation failed");
    } finally {
      setBusy(false);
    }
  }
  const api = window.hermesAPI.endpoint;
  return (
    <section
      className="h-full overflow-auto p-6 text-[var(--text-primary)]"
      aria-label={ja ? "この端末の保護" : "This device protection"}
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-xl font-semibold">
          {ja ? "この端末の保護" : "This device protection"}
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          {ja
            ? "選んだフォルダのファイルと、この端末の接続をローカルで監視します。ファイル内容・通信先はクラウドへ送信しません。警告は調査の手がかりであり、感染の確定や自動遮断ではありません。"
            : "Monitor selected folders and this device's connections locally. File contents and connection destinations stay on this device. Alerts are investigation leads, not confirmed infections or automatic blocking."}
        </p>
        {error && (
          <p role="alert" className="text-sm text-[var(--text-primary)]">
            {error}
          </p>
        )}
        {!status ? (
          <p role="status">{ja ? "状態を読み込み中…" : "Loading status…"}</p>
        ) : (
          <>
            <p role="status">
              {status.running
                ? ja
                  ? "監視中（アプリ終了で停止）"
                  : "Monitoring until app exit"
                : ja
                  ? "監視停止中"
                  : "Monitoring stopped"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() =>
                  void action(() => api.setEnabled(!status.enabled))
                }
              >
                {status.enabled
                  ? ja
                    ? "監視を停止"
                    : "Stop monitoring"
                  : ja
                    ? "監視を開始"
                    : "Start monitoring"}
              </button>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() => void action(api.chooseFolder)}
              >
                {ja ? "監視フォルダを選ぶ" : "Choose monitored folder"}
              </button>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() => void action(api.scanFile)}
              >
                {ja ? "ファイルを検査" : "Scan a file"}
              </button>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() => void action(api.updateDefinitions)}
              >
                {ja ? "定義を更新" : "Update definitions"}
              </button>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              {ja
                ? "監視の設定はこの端末に保存され、有効な場合は次回起動時に再開します。"
                : "Monitoring preferences are saved on this device and resume on the next launch when enabled."}
            </p>
            <ul className="space-y-2">
              {status.folders.map((folder) => (
                <li key={folder} className="flex items-center gap-2 text-sm">
                  <span className="break-all">{folder}</span>
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => void action(() => api.removeFolder(folder))}
                  >
                    {ja ? "解除" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-sm">
              {ja ? "定義" : "Definitions"}: v{status.definitions.version} ·{" "}
              {status.definitions.source === "bundled"
                ? ja
                  ? "アプリ同梱"
                  : "Bundled"
                : ja
                  ? "署名検証済み"
                  : "Signature verified"}{" "}
              · {ja ? "検査ファイル数" : "Files scanned"}: {status.scannedFiles}
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              {ja ? "最終接続観測" : "Last connection observation"}:{" "}
              {status.lastPoll
                ? new Date(status.lastPoll).toLocaleString(locale)
                : "—"}{" "}
              · {ja ? "最終定義更新" : "Last definition update"}:{" "}
              {status.lastUpdate
                ? new Date(status.lastUpdate).toLocaleString(locale)
                : "—"}
            </p>
            {status.definitions.expires && (
              <p className="text-sm">
                {ja ? "定義の有効期限" : "Definition expiry"}:{" "}
                {new Date(status.definitions.expires).toLocaleString(locale)}
              </p>
            )}
            {status.updateError && (
              <p role="alert" className="text-sm">
                {ja
                  ? "定義の取得または検証に失敗しました。前の定義で検知を続けます。"
                  : status.updateError}
              </p>
            )}
            <ToolActivity
              title={ja ? "監視の範囲と制約" : "Coverage and limitations"}
              detail={`${status.gaps.length}`}
            >
              <p className="text-sm">
                {ja
                  ? "標準定義は限定的です。2 MiB を超えるファイル、暗号化・圧縮された内容は検査できません。最初のフォルダ検査は500項目まで、接続観測は5秒間隔です。警告がないことは安全の証明になりません。"
                  : "Bundled rules have limited coverage. Files over 2 MiB and encrypted or compressed contents are not inspected. Initial scans stop at 500 entries; connections are sampled every five seconds. No alerts does not establish safety."}
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {status.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </ToolActivity>
            <h2 className="font-semibold">
              {ja ? "警告" : "Alerts"} ({status.alerts.length})
            </h2>
            {!status.alerts.length && (
              <p className="text-sm text-[var(--text-secondary)]">
                {ja
                  ? "この起動中の警告はありません。未観測・未検査の範囲は上記で確認できます。"
                  : "No alerts in this app session. Review coverage above for unobserved activity."}
              </p>
            )}
            <ul className="space-y-2">
              {status.alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="rounded-lg border border-[var(--border)] p-3 text-sm"
                >
                  <strong>{alert.rule}</strong> · {alert.severity}
                  <p className="break-all">{alert.subject}</p>
                  <time dateTime={alert.time}>
                    {new Date(alert.time).toLocaleString(locale)}
                  </time>
                </li>
              ))}
            </ul>
            <ToolActivity
              title={
                ja
                  ? "観測した接続（最大100件）"
                  : "Observed connections (up to 100)"
              }
              detail={`${status.connections.length}`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th>PID</th>
                      <th>{ja ? "プロセス" : "Process"}</th>
                      <th>{ja ? "接続先" : "Remote"}</th>
                      <th>{ja ? "状態" : "State"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.connections.map((r, i) => (
                      <tr key={`${r.pid}:${r.local}:${r.remote}:${i}`}>
                        <td>{r.pid ?? "—"}</td>
                        <td>{r.process || "—"}</td>
                        <td>{r.remote || "—"}</td>
                        <td>{r.state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ToolActivity>
          </>
        )}
      </div>
    </section>
  );
}
