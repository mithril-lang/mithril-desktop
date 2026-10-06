import type { LegacyProviderSnapshot } from "./legacy-provider";
import type { WorkspaceTransport } from "@mithril/workspace/sync";
import type { WorkspaceRuntimeAdapter } from "@mithril/workspace/runtime";

export interface CloudWorkspaceStatus {
  userId: string | null;
  enabled: boolean;
}

export interface CloudWorkspaceAPI extends WorkspaceTransport {
  replica: import("@mithril/workspace/replica-sync").ReplicaTransport;
  capabilitySnapshot: import("@mithril/workspace/capability-data").CapabilitySeed;
  memorySnapshot: import("@mithril/workspace/memory-files").MemorySeed;
  repositorySeed(): Promise<{
    userId: string;
    documents: import("@mithril/workspace/repository-react").RepositorySeed[];
  }>;
  repository: import("@mithril/workspace/repository").RepositoryTransport;
  security: import("@mithril/workspace/security").SecurityTransport;
  schedules: import("@mithril/workspace/schedules").ScheduleTransport;
  previewSchedules(): Promise<{
    userId: string;
    drafts: import("@mithril/workspace/schedules").NativeScheduleDraft[];
  }>;
  files: import("@mithril/workspace/files").ProjectFileTransport;
  capabilityResources: import("@mithril/workspace/capability-resources").CapabilityResourceTransport;
  catalog(): Promise<import("@mithril/workspace/react").DiscoverItem[]>;
  registrySkill(
    item: import("@mithril/workspace/desktop-discover").RegistryItem,
  ): Promise<import("@mithril/workspace/registry-bundle").RegistrySkillBundle>;
  discoverDocuments: Pick<
    import("@mithril/workspace/desktop-discover").DiscoverAPI,
    "fetchRegistry" | "fetchRegistryDetail"
  >;
  status(): Promise<CloudWorkspaceStatus>;
  enable(): Promise<CloudWorkspaceStatus>;
  disable(): Promise<void>;
}
export type NativeWorkspaceAPI = WorkspaceRuntimeAdapter;

import type { SessionTransport } from "@mithril/workspace/session-sync";
import type {
  ChatModel,
  ChatRuntimeAvailability,
  SessionNativeImportAdapter,
} from "@mithril/workspace/sessions";
export interface CloudChatAPI extends SessionTransport {
  syncNativeHistory(): Promise<{
    userId: string;
    synced: number;
    conflicts: string[];
    deferred: string[];
  }>;
  historyFiles: import("@mithril/workspace/history").HistoryFileTransport;
  status(): Promise<CloudWorkspaceStatus>;
  enable(): Promise<CloudWorkspaceStatus>;
  disable(): Promise<void>;
  models(): Promise<ChatModel[]>;
  runtime(): Promise<ChatRuntimeAvailability>;
  legacySnapshot(): Promise<LegacyProviderSnapshot>;
}
export type NativeSessionImportAPI = SessionNativeImportAdapter;
