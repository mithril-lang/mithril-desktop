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
  visible = true,
  locale = "en",
}: {
  profile: string;
  initialSessionId?: string;
  sidebarNavigation?: ReactNode;
  onSidebarSelect?: () => void;
  onSidebarProjects?: () => void;
  visible?: boolean;
  locale?: string;
}): React.JSX.Element {
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSidebarTarget(document.getElementById("cloud-session-sidebar"));
  }, []);
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
    void window.hermesAPI.cloudChat
      .status()
      .then((status) => {
        if (!canceled) setAccountId(status.userId);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [profile, epoch]);
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
      <ChatSessions
        sidebarTarget={sidebarTarget}
        sidebarNavigation={sidebarNavigation}
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
