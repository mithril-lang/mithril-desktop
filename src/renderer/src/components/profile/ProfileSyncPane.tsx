import { useCallback, useEffect, useRef, useState } from "react";
import { DesktopProfileSync } from "@mithril/workspace/desktop-profile-sync";
import { RepositoryProfileSync } from "@mithril/workspace/repository-profile-sync";
import { useI18n } from "../useI18n";

function CanonicalProfileSync({
  profile,
}: {
  profile: string;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const [state, setState] = useState({
    owner: null as string | null,
    error: "",
    signedOut: false,
    checking: true,
  });
  const generation = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    const captured = ++generation.current;
    setState({ owner: null, error: "", signedOut: false, checking: true });
    try {
      let status = await window.hermesAPI.cloudWorkspace.status();
      if (captured !== generation.current) return;
      if (status.userId && !status.enabled) {
        status = await window.hermesAPI.cloudWorkspace.enable();
        if (captured !== generation.current) return;
      }
      if (status.userId && !status.enabled)
        throw Error("Workspace connection unavailable");
      setState({
        owner: status.userId,
        error: "",
        signedOut: !status.userId,
        checking: false,
      });
    } catch (error) {
      if (captured === generation.current)
        setState({
          owner: null,
          error:
            error instanceof Error
              ? error.message
              : "Workspace connection unavailable",
          signedOut: false,
          checking: false,
        });
    }
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    void refresh();
    const unsubscribe = window.hermesAPI.onCloudWorkspaceAccountChanged?.(
      () => {
        void refresh();
      },
    );
    return () => {
      invalidate();
      unsubscribe?.();
    };
  }, [refresh, invalidate]);
  if (state.owner)
    return (
      <RepositoryProfileSync
        key={state.owner}
        owner={state.owner}
        profile={profile}
        transport={window.hermesAPI.cloudWorkspace.repository}
        locale={locale}
      />
    );
  return (
    <DesktopProfileSync
      profile={profile}
      linkedAgentId={null}
      onSync={refresh}
      t={t}
      status={{
        signedIn: !state.signedOut,
        accountLabel: "api.mithril.fund",
        running: state.checking,
        lastResult: state.error
          ? { status: "error", error: state.error, outcomes: [], finishedAt: 0 }
          : null,
      }}
    />
  );
}

/** Original Sync presentation, authenticated through the canonical workspace API. */
export default function ProfileSyncPane({
  profile,
}: {
  profile: string;
}): React.JSX.Element {
  return <CanonicalProfileSync key={profile} profile={profile} />;
}
