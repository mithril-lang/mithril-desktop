import * as Dialog from "@radix-ui/react-dialog";
import MithrilAccountSection from "../../components/MithrilAccountSection";
import { saveTaskAttachmentDownload } from "@mithril/workspace/task-attachment-download";
import { useFont } from "../../components/FontProvider";
import { useChatPreferences } from "../../components/ChatPreferencesProvider";
import { THEMES, FONT_OPTIONS } from "../../constants";
import { setAnalyticsConsent } from "../../utils/analytics";
import {
  NativeSettingsPane,
  NativeSettingsProvider,
} from "../../components/settings/SettingsModal";
import { useTheme } from "../../components/ThemeProvider";
import { useI18n } from "../../components/useI18n";
import { APP_LOCALES, type AppLocale } from "../../../../shared/i18n";
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
  const { setTheme, setRounded } = useTheme();
  const { setFont } = useFont();
  const chat = useChatPreferences();
  const { setLocale } = useI18n();
  const preferences = useCallback(
    (data: Record<string, unknown>): void => {
      if (
        typeof data.theme === "string" &&
        (data.theme === "system" ||
          THEMES.some((theme) => theme.id === data.theme))
      )
        setTheme(data.theme);
      if (
        typeof data.font === "string" &&
        FONT_OPTIONS.some((font) => font.value === data.font)
      )
        setFont(data.font);
      if (typeof data.rounded === "boolean") setRounded(data.rounded);
      if (typeof data.completionSoundEnabled === "boolean")
        chat.setCompletionSoundEnabled(data.completionSoundEnabled);
      if (typeof data.spellcheckEnabled === "boolean")
        chat.setSpellcheckEnabled(data.spellcheckEnabled);
      if (typeof data.spellcheckUseSystemLanguages === "boolean")
        chat.setSpellcheckUseSystemLanguages(data.spellcheckUseSystemLanguages);
      if (
        Array.isArray(data.spellcheckLanguages) &&
        data.spellcheckLanguages.every(
          (language) => typeof language === "string",
        )
      )
        chat.setSpellcheckLanguages(data.spellcheckLanguages);
      if (typeof data.analyticsEnabled === "boolean")
        setAnalyticsConsent(data.analyticsEnabled);
      if (
        typeof data.locale === "string" &&
        (APP_LOCALES as readonly string[]).includes(data.locale)
      )
        setLocale(data.locale as AppLocale);
    },
    [setTheme, setLocale, setRounded, setFont, chat],
  );
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
