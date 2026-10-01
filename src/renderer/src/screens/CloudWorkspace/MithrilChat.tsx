import type { LegacyProviderSnapshot } from "../../../../shared/legacy-provider";
import { useEffect, useRef, useState } from "react";
import { ChatSessions } from "@mithril/workspace/session-react";
import "@mithril/workspace/styles.css";

/** New default Chat uses only the canonical Mithril model inventory and D1 sessions. */
export default function MithrilChat({
  profile,
}: {
  profile: string;
}): React.JSX.Element {
  const [epoch, setEpoch] = useState(0);
  const [legacy, setLegacy] = useState<LegacyProviderSnapshot | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setLegacy(null);
  }, [profile]);
  useEffect(
    () =>
      window.hermesAPI.onCloudChatAccountChanged(() => {
        generation.current++;
        setEpoch((value) => value + 1);
        setLegacy(null);
      }),
    [],
  );
  return (
    <div>
      <p>
        Models and inference use api.mithril.fund. Local provider configurations
        and history are retained for explicit legacy access; they are never used
        by this Chat.
      </p>
      {legacy && (
        <p>
          Local provider configuration{" "}
          {legacy.configuration.present
            ? "is retained"
            : "has not been configured"}
          . Automatic use is disabled for this Mithril Chat.
        </p>
      )}
      <ChatSessions
        key={profile}
        transport={window.hermesAPI.cloudChat}
        identityEpoch={`${profile}:${epoch}`}
        nativeImport={window.hermesAPI.nativeSessionImport}
        loadModels={() => window.hermesAPI.cloudChat.models()}
        beforeConnect={async () => {
          const current = generation.current;
          await window.hermesAPI.cloudChat.enable();
          const snapshot = await window.hermesAPI.cloudChat.legacySnapshot();
          if (current === generation.current) setLegacy(snapshot);
        }}
        afterDisconnect={() => window.hermesAPI.cloudChat.disable()}
      />
    </div>
  );
}
