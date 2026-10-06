import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChatSessions } from "@mithril/workspace/session-react";
import "@mithril/workspace/styles.css";

/** New default Chat uses only the canonical Mithril model inventory and D1 sessions. */
export default function MithrilChat({
  profile,
  initialSessionId,
  sidebarNavigation,
  onSidebarSelect,
  onSidebarProjects,
  onSourceHistorySelect,
  onConnectAccount,
  visible = true,
  locale = "en",
}: {
  profile: string;
  initialSessionId?: string;
  sidebarNavigation?: ReactNode;
  onSidebarSelect?: () => void;
  onSidebarProjects?: () => void;
  onSourceHistorySelect?: (sourceId: string) => void;
  onConnectAccount?: () => void;
  visible?: boolean;
  locale?: string;
}): React.JSX.Element {
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSidebarTarget(document.getElementById("cloud-session-sidebar"));
  }, []);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(null);
  useEffect(
    () =>
      window.hermesAPI.onCloudChatAccountChanged(() => {
        setEpoch((value) => value + 1);
      }),
    [],
  );
  useEffect(() => {
    let canceled = false;
    setAccountId(null);
    setConnectionError("");
    setIdentityChecked(false);
    void window.hermesAPI.cloudChat
      .status()
      .then((status) => {
        if (!canceled) setAccountId(status.userId);
      })
      .catch((error) => {
        if (!canceled)
          setConnectionError(
            error instanceof Error ? error.message : "Sign-in unavailable",
          );
      })
      .finally(() => {
        if (!canceled) setIdentityChecked(true);
      });
    return () => {
      canceled = true;
    };
  }, [profile, epoch]);
  const [sourceInventory, setSourceInventory] = useState<{
    userId: string;
    profile: string;
    rows: Array<{ id: string; sourceId: string; title: string }>;
  }>();
  useEffect(() => {
    setSourceInventory(undefined);
    if (!accountId || !onSourceHistorySelect) return;
    let current = true,
      busy = false;
    const read = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const result =
          await window.hermesAPI.cloudChat.nativeHistoryInventory();
        if (
          current &&
          result.userId === accountId &&
          result.profile === profile
        )
          setSourceInventory(result);
      } catch {
        // Source access remains in the existing history dialog during migration.
        if (current) setSourceInventory(undefined);
      } finally {
        busy = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 20_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [accountId, profile, epoch, onSourceHistorySelect]);
  const workspaceTransport = useMemo(
    () => ({
      ...window.hermesAPI.cloudWorkspace,
      getSnapshot: async () => {
        await window.hermesAPI.cloudWorkspace.enable();
        return window.hermesAPI.cloudWorkspace.getSnapshot();
      },
    }),
    [],
  );
  return (
    <div>
      {identityChecked && !accountId && onConnectAccount && (
        <div className="session-notice">
          <button type="button" onClick={onConnectAccount}>
            {locale.startsWith("ja")
              ? "Mithril アカウントに接続"
              : "Connect Mithril account"}
          </button>
        </div>
      )}
      {connectionError && (
        <div className="session-notice" role="alert">
          <p>{connectionError}</p>
          <button type="button" onClick={() => setEpoch((value) => value + 1)}>
            {locale.startsWith("ja") ? "再接続" : "Reconnect"}
          </button>
        </div>
      )}
      <ChatSessions
        sidebarTarget={sidebarTarget}
        sidebarNavigation={sidebarNavigation}
        sidebarSourceInventory={sourceInventory}
        onSidebarSourceSelect={onSourceHistorySelect}
        onSidebarSelect={onSidebarSelect}
        onSidebarProjects={onSidebarProjects}
        key={`${profile}:${initialSessionId ?? ""}`}
        initialSessionId={initialSessionId}
        autoConnect
        accountId={accountId}
        visible={visible}
        locale={locale}
        transport={window.hermesAPI.cloudChat}
        workspaceTransport={workspaceTransport}
        beforeWorkspaceConnect={async () => {
          await window.hermesAPI.cloudWorkspace.enable();
        }}
        identityEpoch={`${profile}:${epoch}`}
        nativeImport={window.hermesAPI.nativeSessionImport}
        historyFiles={window.hermesAPI.cloudChat.historyFiles}
        loadModels={() => window.hermesAPI.cloudChat.models()}
        loadRuntime={() => window.hermesAPI.cloudChat.runtime()}
        beforeConnect={async () => {
          await window.hermesAPI.cloudChat.enable();
        }}
        afterDisconnect={() => window.hermesAPI.cloudChat.disable()}
      />
    </div>
  );
}
