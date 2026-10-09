import { usePresentation } from "@mithril/workspace/react";
import { useWorkspacePreferences } from "./useWorkspacePreferences";
import { connectionNotice as describeConnectionFailure } from "./connection-notice";
import { useEffect, useRef, useState } from "react";
import { useRepositoryReplication } from "@mithril/workspace/repository-react";

/** One background reconciler for the application, independent of the active screen. */
export default function RepositoryReplication({
  profile,
  locale,
  enabled,
}: {
  profile: string;
  locale: string;
  enabled: boolean;
}): React.JSX.Element | null {
  const identityGeneration = useRef(0);
  const [owner, setOwner] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [historyNotice, setHistoryNotice] = useState("");
  const [titleConflicts, setTitleConflicts] = useState<
    NonNullable<
      Awaited<
        ReturnType<typeof window.hermesAPI.cloudChat.syncNativeHistory>
      >["titleConflicts"]
    >
  >([]);
  const [modelConflicts, setModelConflicts] = useState<typeof titleConflicts>(
    [],
  );
  const [visibilityConflicts, setVisibilityConflicts] = useState<
    typeof titleConflicts
  >([]);
  const [resolvingMetadata, setResolvingMetadata] = useState(false);
  useEffect(
    () =>
      window.hermesAPI.onCloudWorkspaceAccountChanged(() => {
        identityGeneration.current++;
        setTitleConflicts([]);
        setModelConflicts([]);
        setVisibilityConflicts([]);
        setHistoryNotice("");
        setOwner(null);
        setEpoch((value) => value + 1);
      }),
    [],
  );
  useEffect(() => {
    let active = true;
    const generation = identityGeneration;
    generation.current++;
    setOwner(null);
    setConnectionNotice("");
    setHistoryNotice("");
    setTitleConflicts([]);
    setModelConflicts([]);
    setVisibilityConflicts([]);
    const capturedGeneration = generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let retryable = true;
    let retryDelay = 5000;
    const current = (): boolean =>
      active && generation.current === capturedGeneration;
    const connect = async (): Promise<void> => {
      if (!enabled || !current() || busy || !retryable) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      busy = true;
      try {
        const status = await window.hermesAPI.cloudWorkspace.status();
        if (!current()) return;
        const connected = status.userId
          ? await window.hermesAPI.cloudWorkspace.enable()
          : status;
        if (!current()) return;
        if (connected.userId !== status.userId)
          throw Error("Workspace owner changed during connection");
        setOwner(connected.userId);
        setConnectionNotice("");
        retryable = false;
      } catch (error) {
        if (!current()) return;
        const failure = describeConnectionFailure(error, locale);
        setConnectionNotice(failure.message);
        retryable = failure.retry;
        if (retryable) {
          timer = setTimeout(() => void connect(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      } finally {
        busy = false;
      }
    };
    void connect();
    const online = (): void => {
      void connect();
    };
    window.addEventListener("online", online);
    return () => {
      active = false;
      generation.current++;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", online);
    };
  }, [profile, epoch, enabled, locale]);
  useEffect(() => {
    if (!enabled || !owner) return;
    let active = true,
      busy = false;
    const run = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const result = await window.hermesAPI.cloudChat.syncNativeHistory();
        if (result.userId !== owner) throw Error("History owner changed");
        if (active) {
          setTitleConflicts(result.titleConflicts ?? []);
          setModelConflicts(result.modelConflicts ?? []);
          setVisibilityConflicts(result.visibilityConflicts ?? []);
          setHistoryNotice(
            result.conflicts.length || result.deferred.length
              ? locale.startsWith("ja")
                ? `${result.conflicts.length + result.deferred.length} 件のチャットが同期の確認待ちです。元の履歴は保持されています。`
                : `${result.conflicts.length + result.deferred.length} chats need synchronization review. Original history is retained.`
              : "",
          );
        }
      } catch (error) {
        if (active)
          setHistoryNotice(describeConnectionFailure(error, locale).message);
      } finally {
        busy = false;
      }
    };
    void run();
    const timer = setInterval(() => void run(), 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, owner, profile, epoch, locale]);
  const applyPreferences = useWorkspacePreferences();
  const presentation = usePresentation({
    owner: enabled ? owner : null,
    transport: window.hermesAPI.cloudWorkspace.repository,
    identityEpoch: `${profile}:${epoch}`,
    legacy: [],
    onApply: applyPreferences,
  });
  const replication = useRepositoryReplication(
    owner,
    window.hermesAPI.cloudWorkspace.repository,
    enabled ? window.hermesAPI.cloudWorkspace.replica : undefined,
    `${profile}:${epoch}`,
    window.hermesAPI.cloudWorkspace.capabilityResources,
  );
  const resolveMetadata = async (
    conflict: (typeof titleConflicts)[number],
    choice: "native" | "cloud",
    field: "title" | "model" | "visibility",
  ): Promise<void> => {
    if (!owner || resolvingMetadata) return;
    const capturedOwner = owner;
    const generation = identityGeneration.current;
    setResolvingMetadata(true);
    try {
      const resolver =
        field === "title"
          ? window.hermesAPI.cloudChat.resolveNativeHistoryTitle
          : field === "model"
            ? window.hermesAPI.cloudChat.resolveNativeHistoryModel
            : window.hermesAPI.cloudChat.resolveNativeHistoryVisibility;
      const result = await resolver({
        ...conflict,
        userId: capturedOwner,
        profile: conflict.profile ?? profile,
        choice,
      });
      if (generation !== identityGeneration.current) return;
      if (result.userId !== capturedOwner) throw Error("History owner changed");
      // A status refresh uses the current owner effect; avoid applying old-account results.
      setEpoch((value) => value + 1);
    } catch (error) {
      if (generation === identityGeneration.current)
        setHistoryNotice(
          error instanceof Error ? error.message : String(error),
        );
    } finally {
      setResolvingMetadata(false);
    }
  };
  const ja = locale.startsWith("ja");
  const metadataLabels = {
    title: {
      summary: ja ? "チャット名の変更を確認" : "Review chat title changes",
      native: ja ? "この端末で編集した名前を使用" : "Use the name edited here",
      cloud: ja ? "同期された名前を使用" : "Use the synchronized name",
    },
    model: {
      summary: ja ? "モデル情報の変更を確認" : "Review model metadata changes",
      native: ja
        ? "この端末で編集したモデル情報を使用"
        : "Use model metadata edited here",
      cloud: ja
        ? "同期されたモデル情報を使用"
        : "Use synchronized model metadata",
    },
    visibility: {
      summary: ja ? "チャットの表示状態を確認" : "Review chat visibility",
      native: ja ? "この端末の表示状態を使用" : "Use visibility edited here",
      cloud: ja ? "同期された表示状態を使用" : "Use synchronized visibility",
    },
  };
  const displayMetadata = (field: string, value: string): string =>
    field === "visibility"
      ? value === "archived"
        ? ja
          ? "非表示"
          : "Hidden"
        : ja
          ? "表示"
          : "Visible"
      : value;
  const rawNotice =
    connectionNotice ||
    replication.notice ||
    presentation.notice ||
    historyNotice;
  const notice = /Error invoking remote method|Workspace request failed/.test(
    rawNotice,
  )
    ? describeConnectionFailure(new Error(rawNotice), locale).message
    : rawNotice;
  if (
    !enabled ||
    (!notice &&
      !titleConflicts.length &&
      !modelConflicts.length &&
      !visibilityConflicts.length &&
      !replication.conflicts.length &&
      !replication.deferred)
  )
    return null;
  const resolve = (key: string, choice: "local" | "cloud"): void => {
    void replication
      .resolve(key, choice)
      .catch((error) =>
        setConnectionNotice(
          error instanceof Error ? error.message : String(error),
        ),
      );
  };
  return (
    <aside
      className="repository-sync-notice"
      aria-label={ja ? "同期の状態" : "Synchronization status"}
    >
      {notice && <p role="status">{notice}</p>}
      {!!replication.deferred && (
        <details>
          <summary>
            {ja
              ? `${replication.deferred} 件の変更が反映待ちです`
              : `${replication.deferred} changes are awaiting application`}
          </summary>
          <p>
            {ja
              ? "実行中の作業や、まだ対応していないデータ形式への反映を保留しています。データは保持されています。"
              : "Busy work or unsupported native data formats are deferred. Data is retained."}
          </p>
        </details>
      )}
      {(
        [
          { field: "title", conflicts: titleConflicts },
          { field: "model", conflicts: modelConflicts },
          { field: "visibility", conflicts: visibilityConflicts },
        ] as const
      ).flatMap(({ field, conflicts }) =>
        conflicts.map((conflict) => (
          <details
            key={`${field}:${conflict.profile ?? profile}:${conflict.sessionId}`}
          >
            <summary>
              {metadataLabels[field].summary}
              {conflict.profile ? ` · ${conflict.profile}` : ""}
            </summary>
            <p>{displayMetadata(field, conflict.native)}</p>
            <p>{displayMetadata(field, conflict.cloud)}</p>
            <button
              disabled={resolvingMetadata}
              onClick={() => void resolveMetadata(conflict, "native", field)}
            >
              {metadataLabels[field].native}
            </button>
            <button
              disabled={resolvingMetadata}
              onClick={() => void resolveMetadata(conflict, "cloud", field)}
            >
              {metadataLabels[field].cloud}
            </button>
          </details>
        )),
      )}
      {replication.conflicts.map((conflict) => (
        <details key={conflict.key}>
          <summary>
            {ja ? "変更の確認が必要です" : "Changes need review"}
          </summary>
          <pre>{JSON.stringify(conflict.local?.body, null, 2)}</pre>
          <pre>{JSON.stringify(conflict.cloud?.body, null, 2)}</pre>
          <button onClick={() => resolve(conflict.key, "local")}>
            {ja ? "この変更を保存" : "Keep this change"}
          </button>
          <button onClick={() => resolve(conflict.key, "cloud")}>
            {ja ? "同期された変更を使用" : "Use synchronized change"}
          </button>
        </details>
      ))}
    </aside>
  );
}
