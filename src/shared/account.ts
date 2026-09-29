// Shared shapes for the Mithril account surface (main, preload, renderer).

export interface MithrilAccount {
  userId: string;
  accountUrl: string;
  live: boolean;
  scopes: string[];
  balanceMicroUsd: number | null;
  error?: string;
}

export type MithrilAccountConnectResult =
  | { status: "connected"; account: MithrilAccount }
  | { status: "refused"; error: string };

/** Local-only first-run gate: is an mf_ token stored for this profile? */
export interface MithrilFirstRunState {
  connected: boolean;
}

export type MithrilChatResult =
  | { ok: true; text: string; model: string; reasoning?: string }
  | { ok: false; error: string };
