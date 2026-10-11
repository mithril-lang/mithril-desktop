export interface LocalWorkspaceSyncStatus {
  userId: string | null;
  ready: boolean;
  phase: "starting" | "syncing" | "synced" | "offline" | "blocked";
  pending: number;
  conflicts: {
    key: string;
    operationId: string;
    local: unknown;
    cloud: unknown;
  }[];
  lastSyncedAt: number | null;
  message: string;
}
