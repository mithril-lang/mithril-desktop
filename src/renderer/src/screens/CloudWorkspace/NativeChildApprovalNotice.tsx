import { useState } from "react";
import type { PendingNativeChild } from "./native-child-approvals";
export function NativeChildApprovalNotice({
  item,
  locale,
}: {
  item: PendingNativeChild;
  locale: string;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const ja = locale.startsWith("ja");
  return (
    <div className="session-notice" role="status">
      <span>
        {ja
          ? `${item.name} の承認待ちです。`
          : `Waiting for approval of ${item.name}.`}
      </span>{" "}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            await item.review();
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {ja ? "ブラウザで呼出しを確認" : "Review call in browser"}
      </button>{" "}
      <button type="button" onClick={item.cancel}>
        {ja ? "要求を取り消す" : "Cancel request"}
      </button>
      {error && (
        <span role="alert">
          {ja
            ? "承認ページを開けません。要求の状態を確認してください。"
            : "Approval page could not be opened. Check the request state."}
        </span>
      )}
    </div>
  );
}
