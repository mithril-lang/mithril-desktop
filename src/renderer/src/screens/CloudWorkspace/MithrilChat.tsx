import { NativeChildApprovalQueue } from "./native-child-approvals";
import { NativeChildApprovalNotice } from "./NativeChildApprovalNotice";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChatGatewayConnection } from "./ChatGatewayConnection";
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
  const [selectedSessionId, setSelectedSessionId] = useState(initialSessionId);
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSidebarTarget(document.getElementById("cloud-session-sidebar"));
  }, []);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [connectionError, setConnectionError] = useState<ReturnType<
    typeof connectionNotice
  > | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(
    () => setSelectedSessionId(initialSessionId),
    [initialSessionId, profile, epoch],
  );
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
  const [, refreshNativeApprovals] = useState(0);
  const nativeApprovals = useMemo(
    () =>
      new NativeChildApprovalQueue(
        window.hermesAPI.cloudChat,
        () => refreshNativeApprovals((value) => value + 1),
        JSON.stringify([profile, accountId, epoch]),
      ),
    [profile, accountId, epoch],
  );
  const toolRunner = useMemo(
    () =>
      createClientToolTurnRunner(
        async (id, body, signal) => {
          signal.throwIfAborted();
          let result;
          if (
            body.action === "child" &&
            ![
              "tool_catalog",
              "mithril_tool",
              "web_search",
              "web_extract",
            ].includes(String(body.name))
          ) {
            const { action: _action, ...intent } = body;
            result = await nativeApprovals.call(
              { userId: accountId ?? "", profile, sessionId: id },
              intent,
              signal,
            );
          } else
            result = await window.hermesAPI.cloudChat.browserStep(id, body);
          signal.throwIfAborted();
          return result;
        },
        async (call, signal, broker, deadline) => {
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
            return await host.call(call, signal, broker, deadline);
          } finally {
            host.dispose();
          }
        },
      ),
    [profile, accountId, nativeApprovals],
  );
  // Retire both active execution and acknowledged work still awaiting IPC.
  const toolAuthority = useMemo(
    () => ({
      current: false,
      accountId,
      epoch,
      runner: toolRunner,
      visible,
      sessionId: initialSessionId ?? "",
      revision: 0,
    }),
    [toolRunner, accountId, epoch, initialSessionId, visible],
  );
  useEffect(() => {
    toolAuthority.current = toolAuthority.visible && !!toolAuthority.accountId;
    return () => {
      toolAuthority.current = false;
      toolAuthority.runner.stop();
    };
  }, [toolAuthority]);
  const chatTransport = useMemo<SessionTransport>(
    () => ({
      ...window.hermesAPI.cloudChat,
      apply: async (id, operation) => {
        if (!toolAuthority.current)
          throw Error("Chat context retired; operation not dispatched");
        const revision = toolAuthority.revision;
        const response = await window.hermesAPI.cloudChat.apply(id, operation);
        if (toolAuthority.current && toolAuthority.revision === revision)
          toolRunner.start(id, operation, response);
        return response;
      },
    }),
    [toolRunner, toolAuthority],
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
      {visible && accountId && selectedSessionId && (
        <ChatGatewayConnection
          key={JSON.stringify([profile, epoch, accountId, selectedSessionId])}
          userId={accountId}
          profile={profile}
          sessionId={selectedSessionId}
          locale={locale}
        />
      )}
      {visible &&
        nativeApprovals
          .snapshot()
          .filter(
            (item) =>
              item.request.userId === accountId &&
              item.request.profile === profile &&
              item.request.sessionId === selectedSessionId,
          )
          .map((item) => (
            <NativeChildApprovalNotice
              key={item.request.requestId}
              item={item}
              locale={locale}
            />
          ))}
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
        onSessionSelected={(id) => {
          setSelectedSessionId(id);
          if (toolAuthority.sessionId !== id) {
            toolAuthority.sessionId = id;
            toolAuthority.revision++;
            toolRunner.stop();
          }
        }}
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
        nativeImport={window.hermesAPI.nativeSessionImport}
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
