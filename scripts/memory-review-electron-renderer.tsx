import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { MemoryReviewPanel } from "@mithril/workspace/memory-review-react";
import "@mithril/workspace/memory-review.css";
import { useDashboardChatTransport } from "../src/renderer/src/screens/Chat/hooks/useDashboardChatTransport";
import { useTranscriptState } from "../src/renderer/src/screens/Chat/hooks/useTranscriptState";
import type {
  ActiveTurn,
  UsageState,
} from "../src/renderer/src/screens/Chat/types";

// Only the surrounding screen and launch/profile choices are fixtures.
function Qualification(): React.JSX.Element {
  const [profile, setProfile] = useState("a");
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [, setUsage] = useState<UsageState | null>(null);
  const activeTurnRef = useRef<ActiveTurn | null>(null);
  const { messagesRef, setMessages } = useTranscriptState();
  const transport = useDashboardChatTransport({
    activeTurnRef,
    connectionId: "qualifier",
    connectionRevision: revision,
    connectionMode: "local",
    contextFolder: null,
    enabled: true,
    fallbackOnUnavailable: false,
    hermesSessionId: "same-durable-owner",
    profile,
    messagesRef,
    setMessages,
    setUsage,
    setIsLoading: setLoading,
    setHermesSessionId: () => {},
    setToolProgress: () => {},
  });
  return (
    <>
      <label>
        Profile{" "}
        <select
          aria-label="Profile"
          value={profile}
          onChange={(event) => {
            setProfile(event.target.value);
            setRevision((value) => value + 1);
            setNotice("");
          }}
        >
          <option value="a">a</option>
          <option value="b">b</option>
        </select>
      </label>
      <button
        type="button"
        onClick={() =>
          void transport
            .execSlash("/memory review", () => {})
            .then((result) => {
              setNotice(
                result.kind === "done"
                  ? "Conversation attached"
                  : "Conversation attach failed",
              );
            })
        }
      >
        Attach selected conversation
      </button>
      <p>{notice}</p>
      {transport.memoryReview && (
        <MemoryReviewPanel
          {...transport.memoryReview}
          ja={false}
          disabled={loading}
          buttonStyle=""
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Qualification />);
