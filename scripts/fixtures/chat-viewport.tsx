import { createRoot } from "react-dom/client";
import MithrilChat from "../../src/renderer/src/screens/CloudWorkspace/MithrilChat";

// Render the production adapter and shared Chat with synthetic, read-only data.
const count = Number(new URLSearchParams(location.search).get("count") ?? 80);
const session = {
  id: "viewport-qa",
  title: "Viewport QA",
  model: "qa-model",
  revision: 1,
  eventSeq: count,
  deleted: false,
  activeTurn: null,
};
Object.defineProperty(window, "hermesAPI", {
  value: {
    onCloudChatAccountChanged: () => () => {},
    cloudChat: {
      status: async () => ({ userId: "qa-owner", enabled: true }),
      enable: async () => ({ userId: "qa-owner", enabled: true }),
      disable: async () => {},
      models: async () => [{ id: "qa-model", available: true }],
      list: async () => ({
        schemaVersion: 1,
        userId: "qa-owner",
        sessions: [session],
      }),
      events: async (_id: string, after = 0) => ({
        schemaVersion: 1,
        userId: "qa-owner",
        session,
        events: Array.from({ length: count }, (_, i) => ({
          seq: i + 1,
          type: "imported_message",
          turnId: null,
          createdAt: 1,
          data: {
            role: i % 2 ? "assistant" : "user",
            content: `Viewport message ${i + 1}. ${"Long conversation content. ".repeat(12)}`,
          },
        })).filter((e) => e.seq > after),
        hasMore: false,
        nextAfter: null,
      }),
      apply: async () => {
        throw Error("Viewport QA must never submit work");
      },
      receipt: async () => null,
    },
    cloudWorkspace: {
      enable: async () => ({ userId: "qa-owner" }),
      getSnapshot: async () => ({
        schemaVersion: 1,
        userId: "qa-owner",
        cursor: 0,
        records: [],
      }),
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <div className="layout-shell">
    <div className="layout">
      <main className="content">
        <div
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <MithrilChat profile="default" initialSessionId="viewport-qa" />
        </div>
      </main>
    </div>
    <footer className="status-bar">Workspace · QA</footer>
  </div>,
);
