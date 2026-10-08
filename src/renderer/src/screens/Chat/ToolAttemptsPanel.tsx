import { useSyncExternalStore } from "react";
import { useI18n } from "../../components/useI18n";
import type { ToolAttemptReader } from "./toolAttemptReader";

const labels = {
  pending: ["未実行・確認中", "Not dispatched; pending"],
  running: ["実行開始・結果未確定", "Started; outcome unknown"],
  blocked: ["権限処理で拒否", "Blocked by policy"],
  rejected: ["実行直前に拒否", "Rejected before dispatch"],
  "not-dispatched": ["handlerは実行されず", "Handler not dispatched"],
  returned: [
    "handlerが返却・到達と停止は未確認",
    "Handler returned; delivery and stop unverified",
  ],
  "returned-error": [
    "エラー返却・副作用は未確定",
    "Handler returned error; effects unconfirmed",
  ],
};

export function ToolAttemptsPanel({
  reader,
}: {
  reader: ToolAttemptReader;
}): React.JSX.Element {
  const { locale } = useI18n();
  const ja = locale === "ja";
  const state = useSyncExternalStore(reader.subscribe, reader.snapshot);
  return (
    <details className="px-3 text-sm">
      <summary>{ja ? "ツールの試行状態" : "Tool attempt states"}</summary>
      <button
        type="button"
        disabled={state.status === "reading"}
        onClick={() => void reader.read()}
      >
        {ja ? "状態を読む" : "Read attempt states"}
      </button>
      <div role="status" aria-live="polite">
        {state.status === "reading" && (ja ? "確認中…" : "Reading…")}
        {state.status === "unknown" &&
          (ja
            ? "試行状態を確認できません。結果は不明です。"
            : "Attempt states unavailable. Outcomes remain unknown.")}
      </div>
      {state.page && (
        <>
          <ul>
            {state.page.attempts.map((row) => (
              <li key={row.attempt_id}>
                <code>{row.tool_name}</code> · {labels[row.state][ja ? 0 : 1]}
              </li>
            ))}
          </ul>
          {!state.page.attempts.length && (
            <p>
              {ja
                ? "このページに試行記録はありません。"
                : "No attempt records on this page."}
            </p>
          )}
          {state.page.next_cursor && (
            <button
              type="button"
              onClick={() => void reader.read(state.page!.next_cursor!)}
            >
              {ja ? "以前の記録を読む" : "Read older records"}
            </button>
          )}
        </>
      )}
    </details>
  );
}
