import { useEffect, useMemo, useState, type ReactNode } from "react";
import { connectionNotice } from "./connection-notice";
import { ChatSessions } from "@mithril/workspace/session-react";
import "@mithril/workspace/styles.css";
import {
  createClientToolTurnRunner,
  createKuroToolHost,
} from "@mithril/workspace/client-tool-turn";
import type { SessionTransport } from "@mithril/workspace/session-sync";
import { createCodeProject, type CodeFile } from "@mithril/workspace/code";

/** New default Chat uses only the canonical Mithril model inventory and D1 sessions. */
export default function MithrilChat({
  profile,
  initialSessionId,
  sidebarNavigation,
  onSidebarSelect,
  onSidebarProjects,
  onSourceHistorySelect,
  onConnectAccount,
  onOpenCodeProject,
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
  onOpenCodeProject?: (project: { title: string; files: CodeFile[] }) => void;
  visible?: boolean;
  locale?: string;
}): React.JSX.Element {
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSidebarTarget(document.getElementById("cloud-session-sidebar"));
  }, []);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [connectionError, setConnectionError] = useState<ReturnType<
    typeof connectionNotice
  > | null>(null);
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
    setConnectionError(null);
    setIdentityChecked(false);
    void window.hermesAPI.cloudChat
      .status()
      .then((status) => {
        if (!canceled) setAccountId(status.userId);
      })
      .catch((error) => {
        if (!canceled) setConnectionError(connectionNotice(error, locale));
      })
      .finally(() => {
        if (!canceled) setIdentityChecked(true);
      });
    return () => {
      canceled = true;
    };
  }, [profile, epoch, locale]);
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
        // Automatic archival can retry; original source rows remain in this same sidebar.
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
  const toolRunner = useMemo(
    () =>
      createClientToolTurnRunner(
        async (id, body, signal) => {
          signal.throwIfAborted();
          const result = await window.hermesAPI.cloudChat.browserStep(id, body);
          signal.throwIfAborted();
          return result;
        },
        async (call, signal) => {
          if (call.function.name === "mithril_code") {
            const args = JSON.parse(call.function.arguments);
            if (
              !args ||
              Object.keys(args).length !== 1 ||
              typeof args.goal !== "string" ||
              !args.goal.trim() ||
              args.goal.length > 2000
            )
              throw Error("Invalid Mithril request");
            signal.throwIfAborted();
            const response = await window.hermesAPI.codeHarness(
              "run",
              args.goal,
              profile,
            );
            signal.throwIfAborted();
            if (!response.ok || !("result" in response))
              throw Error(
                response.ok ? "Missing Mithril result" : response.error,
              );
            const value = response.result;
            if (value.format !== "mithril.language-project/v1")
              throw Error(
                "Update the Mithril Code plugin before coding in Mithril",
              );
            const files = await createCodeProject(value, "Mithril application");
            return {
              id: call.id,
              receipt: value.receipt!,
              result: {
                format: value.format,
                verified: true,
                metrics: value.metrics,
              },
              files: Object.fromEntries(files.map((f) => [f.path, f.content])),
            };
          }
          const host = createKuroToolHost();
          try {
            return await host.call(call, signal);
          } finally {
            host.dispose();
          }
        },
      ),
    [profile],
  );
  // Account changes revoke active work while keeping consumed operation IDs claimed.
  useEffect(() => () => toolRunner.stop(), [toolRunner, accountId, epoch]);
  const chatTransport = useMemo<SessionTransport>(
    () => ({
      ...window.hermesAPI.cloudChat,
      apply: async (id, operation) => {
        const response = await window.hermesAPI.cloudChat.apply(id, operation);
        toolRunner.start(id, operation, response);
        return response;
      },
    }),
    [toolRunner],
  );
  return (
    <div>
      {identityChecked &&
        !accountId &&
        !connectionError &&
        onConnectAccount && (
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
          <p>{connectionError.message}</p>
        </div>
      )}
      <ChatSessions
        sidebarTarget={sidebarTarget}
        sidebarNavigation={sidebarNavigation}
        sidebarSourceInventory={sourceInventory}
        onSidebarSourceSelect={onSourceHistorySelect}
        onSidebarSelect={onSidebarSelect}
        onConnectionRequired={
          connectionError?.retry
            ? () => setEpoch((value) => value + 1)
            : onConnectAccount
        }
        connectionRequiredLabel={connectionError?.action}
        onSidebarProjects={onSidebarProjects}
        key={`${profile}:${initialSessionId ?? ""}`}
        initialSessionId={initialSessionId}
        autoConnect
        browserTools
        onOpenCodeProject={onOpenCodeProject}
        accountId={accountId}
        visible={visible}
        locale={locale}
        transport={chatTransport}
        workspaceTransport={workspaceTransport}
        beforeWorkspaceConnect={async () => {
          await window.hermesAPI.cloudWorkspace.enable();
        }}
        identityEpoch={`${profile}:${epoch}`}
        historyFiles={window.hermesAPI.cloudChat.historyFiles}
        loadModels={() => window.hermesAPI.cloudChat.models()}
        loadRuntime={() => window.hermesAPI.cloudChat.runtime()}
        beforeConnect={async () => {
          await window.hermesAPI.cloudChat.enable();
        }}
        afterDisconnect={async () => {
          toolRunner.stop();
          await window.hermesAPI.cloudChat.disable();
        }}
      />
    </div>
  );
}
