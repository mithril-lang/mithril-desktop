export type VaultAction =
  | "status"
  | "create"
  | "unlock"
  | "lock"
  | "save"
  | "sync"
  | "retry"
  | "request-device"
  | "approve-device"
  | "complete-device"
  | "export-recovery"
  | "recover"
  | "grant"
  | "revoke";
export interface VaultInput {
  itemId?: string;
  title?: string;
  key?: string;
}
export interface VaultView {
  realm?: "vault-training-v1";
  status: "locked" | "unlocked" | "absent";
  vaultId?: string;
  pendingWrites: number;
  items: {
    id: string;
    title: string;
    key: string;
    revision: number;
    pending: boolean;
    granted: boolean;
  }[];
}
export type VaultResult =
  | { ok: true; view: VaultView }
  | { ok: false; error: string };
