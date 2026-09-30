// Shared shapes for the Mithril account surface (main, preload, renderer).

export interface MithrilAccount {
  userId: string;
  accountUrl: string;
  live: boolean;
  scopes: string[];
  balanceMicroUsd: number | null;
  error?: string;
}

export interface MithrilDeviceCode {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

/**
 * "keychain": the OS keyring holds the key. "reduced": no system keyring was
 * found, so the token sits in an app-encrypted file (weaker; see the store).
 */
export type MithrilStorageProtection = "keychain" | "reduced";

export type MithrilAccountConnectResult =
  | {
      status: "connected";
      account: MithrilAccount;
      protection: MithrilStorageProtection;
    }
  | { status: "refused"; error: string };

/** Local-only first-run gate: is an mf_ token stored for this profile? */
export interface MithrilFirstRunState {
  connected: boolean;
  protection: MithrilStorageProtection;
}

export type MithrilChatResult =
  | { ok: true; text: string; model: string; reasoning?: string }
  | { ok: false; error: string };
