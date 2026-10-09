import { useEffect, useRef, useState } from "react";
import type { ChatGatewaySelection } from "../../../../shared/workspace";

/** Native metadata and explicit Web review; no human grant is inferred from a selection. */
type Props = {
  userId: string;
  profile: string;
  sessionId: string;
  locale: string;
};
export function ChatGatewayConnection(props: Props): React.JSX.Element {
  return (
    <ChatGatewayConnectionForScope
      key={JSON.stringify([props.userId, props.profile, props.sessionId])}
      {...props}
    />
  );
}
function ChatGatewayConnectionForScope({
  userId,
  profile,
  sessionId,
  locale,
}: Props): React.JSX.Element {
  const [selection, setSelection] = useState<ChatGatewaySelection | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = useRef(false);
  const opening = useRef(false);
  const ja = locale.startsWith("ja");
  useEffect(() => {
    current.current = true;
    let active = true;
    const read = async (): Promise<void> => {
      try {
        const result = await window.hermesAPI.cloudChat.gatewaySelection({
          userId,
          profile,
          sessionId,
        });
        if (result.userId !== userId || result.sessionId !== sessionId)
          throw Error("Tool connection owner changed");
        if (active) setSelection(result);
      } catch {
        if (active) setError(true);
      }
    };
    void read();
    return () => {
      active = false;
      current.current = false;
    };
  }, [userId, profile, sessionId]);
  return (
    <div className="session-notice">
      <span>
        {error
          ? ja
            ? "ツール接続を確認できません。"
            : "Tool connection could not be checked."
          : !selection
            ? ja
              ? "ツール接続を確認中…"
              : "Checking tool connection…"
            : selection.binding?.active
              ? ja
                ? "Hermes会話が選択されています。"
                : "A Hermes conversation is selected."
              : ja
                ? "Hermes会話は選択されていません。"
                : "No Hermes conversation is selected."}
      </span>{" "}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!current.current || opening.current) return;
          opening.current = true;
          setBusy(true);
          setError(false);
          try {
            await window.hermesAPI.cloudChat.reviewGateway({
              userId,
              profile,
              sessionId,
            });
          } catch {
            if (current.current) setError(true);
          } finally {
            opening.current = false;
            if (current.current) setBusy(false);
          }
        }}
      >
        {ja
          ? "ブラウザでツール接続を確認"
          : "Review tool connection in browser"}
      </button>
    </div>
  );
}
