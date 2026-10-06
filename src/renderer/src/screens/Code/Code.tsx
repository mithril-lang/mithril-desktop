// @lat: [[mithril-code#Mithril Code#Review and measurements]]
import { useEffect, useState } from "react";
import type {
  CodeHarnessResponse,
  CodeHarnessResult,
} from "../../../../shared/code-harness";

export default function Code({
  profile,
  locale,
}: {
  profile: string;
  locale: string;
}): React.JSX.Element {
  const ja = locale.startsWith("ja");
  const [goal, setGoal] = useState(
    ja
      ? "完了を切り替え、未完了の件数を正しく数える"
      : "Toggle completion and count unfinished tasks",
  );
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const [result, setResult] = useState<CodeHarnessResult | null>(null);
  useEffect(() => {
    setResult(null);
    setStatus("");
  }, [profile]);
  const errors: Record<string, string> = {
    runner_not_configured: ja
      ? "このプロフィールで mithril-code プラグインと実行先を設定してください。"
      : "Configure the mithril-code plugin and runner for this profile.",
    code_plugin_unavailable: ja
      ? "Agent を更新し、mithril-code プラグインを有効にしてください。"
      : "Update Agent and enable the mithril-code plugin.",
    run_outcome_unknown: ja
      ? "結果を確認できません。再実行すると別の推論費用が発生する可能性があります。実行記録を確認してください。"
      : "Outcome unknown. Check the runner receipt before another paid run.",
    runner_busy: ja
      ? "実行中です。完了を待ってください。"
      : "Runner busy. Wait for completion.",
  };
  async function invoke(action: "status" | "run"): Promise<void> {
    if (busy) return;
    setBusy(true);
    setStatus(ja ? "確認中…" : "Working…");
    if (action === "run") setResult(null);
    let response: CodeHarnessResponse;
    try {
      response = await window.hermesAPI.codeHarness(action, goal, profile);
    } catch {
      response = { ok: false, error: "code_plugin_unavailable" };
    }
    if (!response.ok)
      setStatus(
        errors[response.error] ??
          (ja
            ? `実行できません: ${response.error}`
            : `Cannot run: ${response.error}`),
      );
    else if ("result" in response) {
      setResult(response.result);
      setStatus(
        ja
          ? "固定検証を通過しました。ソースを確認できます。"
          : "Fixed checks passed. Review the source below.",
      );
    } else
      setStatus(
        response.busy
          ? errors.runner_busy
          : ja
            ? "実行先に接続できました。"
            : "Runner ready.",
      );
    setBusy(false);
  }
  const style = { padding: "24px", overflow: "auto", height: "100%" } as const;
  return (
    <section style={style} aria-label="Mithril Code">
      <h1>Mithril Code</h1>
      <p>
        {ja
          ? "System One Coding · Jev が型付き部品を選び、固定検証で完了切替と残件数を確かめます。"
          : "System One Coding · Jev selects typed pieces; fixed checks verify toggle and unfinished count."}
      </p>
      <p>
        {ja
          ? "今回は2つの関数が対象です。画面・保存・任意リポジトリの実行は対象外です。"
          : "This task covers two functions. UI, persistence and arbitrary repository execution are outside its proof."}
      </p>
      <label style={{ display: "block" }}>
        {ja ? "作りたいもの" : "Project brief"}
        <textarea
          style={{ display: "block", width: "100%", minHeight: 90 }}
          value={goal}
          maxLength={2000}
          onChange={(event) => setGoal(event.target.value)}
          disabled={busy}
        />
      </label>
      <p>
        {ja
          ? "実行すると、設定した runner のモデル料金が発生します。登録無料枠とは別の、プロフィールごとの実行先を使います。"
          : "Run uses the configured runner's paid model. This profile's runner is separate from the registered free pilot."}
      </p>
      <button disabled={busy} onClick={() => void invoke("status")}>
        {ja ? "接続を確認" : "Check runner"}
      </button>{" "}
      <button
        disabled={busy || !goal.trim()}
        onClick={() => void invoke("run")}
      >
        {ja ? "組み立てて検証" : "Assemble and verify"}
      </button>
      <p role="status">{status}</p>
      {result && (
        <>
          {Object.entries(result.files).map(([path, source]) => (
            <div key={path}>
              <h2>{path}</h2>
              <pre style={{ whiteSpace: "pre-wrap", userSelect: "text" }}>
                {source}
              </pre>
            </div>
          ))}
          <details>
            <summary>
              {ja
                ? "型付きロジックと実行記録"
                : "Typed logic and execution receipt"}
            </summary>
            <pre style={{ whiteSpace: "pre-wrap", userSelect: "text" }}>
              {JSON.stringify(
                { logic: result.logic, metrics: result.metrics },
                null,
                2,
              )}
            </pre>
          </details>
        </>
      )}
      <p>
        <a href="https://code.mithril.fund/" target="_blank" rel="noreferrer">
          {ja
            ? "Code でプロジェクトを保存・公開"
            : "Save and publish a project in Code"}
        </a>
      </p>
    </section>
  );
}
