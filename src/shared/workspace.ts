import type { WorkspaceTransport } from "@mithril/workspace/sync";

export interface CloudWorkspaceStatus {
  userId: string | null;
  enabled: boolean;
}

export interface CloudWorkspaceAPI extends WorkspaceTransport {
  status(): Promise<CloudWorkspaceStatus>;
  enable(): Promise<CloudWorkspaceStatus>;
  disable(): Promise<void>;
}
