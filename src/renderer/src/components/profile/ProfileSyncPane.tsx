import { DesktopProfileSync } from "@mithril/workspace/desktop-profile-sync";
import { RepositoryProfileSync } from "@mithril/workspace/repository-profile-sync";
import { useI18n } from "../useI18n";
import { useWorkspaceIdentity } from "../useWorkspaceIdentity";

function CanonicalProfileSync({
  profile,
}: {
  profile: string;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const state = useWorkspaceIdentity(profile);
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
      onSync={state.refresh}
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
