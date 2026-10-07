import { useWorkspacePreferences } from "./useWorkspacePreferences";
import * as Dialog from "@radix-ui/react-dialog";
import MithrilAccountSection from "../../components/MithrilAccountSection";
import { saveTaskAttachmentDownload } from "@mithril/workspace/task-attachment-download";
import { useChatPreferences } from "../../components/ChatPreferencesProvider";
import {
  NativeSettingsPane,
  NativeSettingsProvider,
} from "../../components/settings/SettingsModal";
import { portableRepositorySeeds } from "@mithril/workspace/repository-migration";
import type { RuntimeSection } from "@mithril/workspace/runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkspaceApp, type WorkspaceView } from "@mithril/workspace/react";
import "@mithril/workspace/styles.css";
import "@mithril/workspace/desktop-styles.css";

// @lat: [[cloud-workspace#Cloud workspace#Shared screens]]
export default function CloudWorkspace({
  profile,
  initialView,
  settingsInitialSection,
  embedded = false,
  discoverFocus,
  locale = "en",
  active = true,
  onOpenNativeSection,
  onOpenChat,
}: {
  profile: string;
  initialView?: WorkspaceView;
  settingsInitialSection?: string;
  embedded?: boolean;
  discoverFocus?: { kind: "skills" | "mcps"; nonce: number };
  locale?: string;
  active?: boolean;
  onOpenNativeSection?: (section: RuntimeSection) => void;
  onOpenChat?: () => void;
}): React.JSX.Element {
  const taskAttachmentDownloads = useMemo(
    () => ({
      reader: window.hermesAPI.cloudWorkspace.taskAttachments,
      writer: window.hermesAPI.cloudWorkspace.taskAttachments,
      save: saveTaskAttachmentDownload,
    }),
    [],
  );
  const preferences = useWorkspacePreferences();
  const chat = useChatPreferences();
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const [signInOpen, setSignInOpen] = useState(false);
  useEffect(() => setSignInOpen(false), [profile]);
  useEffect(
    () =>
      window.hermesAPI.onCloudWorkspaceAccountChanged(() => {
        setSignInOpen(false);
        setIdentityEpoch((epoch) => epoch + 1);
      }),
    [],
  );
  const repositorySeed = useCallback(async () => {
    const portable = portableRepositorySeeds(
      await window.hermesAPI.cloudWorkspace.getSnapshot(),
    );
    return portable;
  }, []);
  const beforeConnect = useCallback(async () => {
    await window.hermesAPI.cloudWorkspace.enable();
  }, []);
  const beforeReconnect = useCallback(async () => {
    try {
      await window.hermesAPI.cloudWorkspace.enable();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (
        /Cloud connection requires explicit (workspace:read|workspace:write) authorization/.test(
          message,
        ) ||
        message.includes("Sign in to your Mithril account first") ||
        message.includes("Workspace sign-in expired or access refused")
      )
        setSignInOpen(true);
      throw cause;
    }
  }, []);
  return (
    <>
      <WorkspaceApp
        key={profile}
        initialView={initialView}
        settingsInitialSection={settingsInitialSection}
        embedded={embedded}
        discoverFocus={discoverFocus}
        autoConnect
        repositoryTransport={window.hermesAPI.cloudWorkspace.repository}
        repositorySeed={repositorySeed}
        capabilitySeed={window.hermesAPI.cloudWorkspace.capabilitySnapshot}
        capabilityRuntime={window.hermesAPI}
        capabilityResources={
          window.hermesAPI.cloudWorkspace.capabilityResources
        }
        memoryProfile={profile}
        memorySeed={window.hermesAPI.cloudWorkspace.memorySnapshot}
        memoryRuntime={window.hermesAPI}
        transport={window.hermesAPI.cloudWorkspace}
        fileTransport={window.hermesAPI.cloudWorkspace.files}
        taskAttachmentDownloads={taskAttachmentDownloads}
        folderAdapter={window.hermesAPI.projectFolderSync}
        runtimeAdapter={window.hermesAPI.nativeWorkspace}
        settingsRuntime={{
          gpu: window.hermesAPI,
          spellcheck: chat,
          wrapSettings: (children) => (
            <NativeSettingsProvider key={profile} profile={profile}>
              {children}
            </NativeSettingsProvider>
          ),
          renderPane: (section) => <NativeSettingsPane section={section} />,
        }}
        onOpenNativeSection={onOpenNativeSection}
        onOpenChat={onOpenChat}
        beforeConnect={beforeConnect}
        beforeReconnect={beforeReconnect}
        afterDisconnect={() => window.hermesAPI.cloudWorkspace.disable()}
        identityEpoch={`${profile}:${identityEpoch}`}
        discoverDocuments={window.hermesAPI.cloudWorkspace.discoverDocuments}
        loadRegistrySkill={window.hermesAPI.cloudWorkspace.registrySkill}
        onPreferences={preferences}
        locale={locale}
        active={active}
      />
      <Dialog.Root open={signInOpen} onOpenChange={setSignInOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="device-history-backdrop" />
          <Dialog.Content
            className="device-history-dialog"
            aria-describedby={undefined}
          >
            <Dialog.Title>
              {locale.startsWith("ja")
                ? "Mithril に再接続"
                : "Reconnect to Mithril"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="device-history-close">
                {locale.startsWith("ja") ? "閉じる" : "Close"}
              </button>
            </Dialog.Close>
            <MithrilAccountSection key={profile} profile={profile} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
