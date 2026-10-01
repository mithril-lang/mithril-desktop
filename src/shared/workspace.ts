import type { LegacyProviderSnapshot } from "./legacy-provider";
import type { WorkspaceTransport } from "@mithril/workspace/sync";
import type { WorkspaceRuntimeAdapter } from "@mithril/workspace/runtime";

export interface CloudWorkspaceStatus {
  userId: string | null;
  enabled: boolean;
}

export interface CloudWorkspaceAPI extends WorkspaceTransport {
  status(): Promise<CloudWorkspaceStatus>;
  enable(): Promise<CloudWorkspaceStatus>;
  disable(): Promise<void>;
}
export type NativeWorkspaceAPI = WorkspaceRuntimeAdapter;

import type { SessionTransport } from "@mithril/workspace/session-sync";
import type {
  ChatModel,
  SessionNativeImportAdapter,
} from "@mithril/workspace/sessions";
export interface CloudChatAPI extends SessionTransport {
  status(): Promise<CloudWorkspaceStatus>;
  enable(): Promise<CloudWorkspaceStatus>;
  disable(): Promise<void>;
  models(): Promise<ChatModel[]>;
  legacySnapshot(): Promise<LegacyProviderSnapshot>;
}
export type NativeSessionImportAPI = SessionNativeImportAdapter;
