import { lockKagiVault } from "./kagi-vault-runtime";
// @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account]]
import { MITHRIL_ACCOUNT_URL, inspectMithrilToken } from "./mithril-token";
import {
  clearCloudAccountToken,
  clearMithrilToken,
  cloudAccountStorageProtection,
  readCloudAccountToken,
  writeMithrilAccountCredentials,
} from "./mithril-token-store";
import { onMithrilConnected, onMithrilDisconnected } from "./mithril-sync";
import type {
  MithrilAccount,
  MithrilAccountConnectResult,
} from "../shared/account";

export async function connectMithrilAccount(
  rawToken: string,
  profile?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MithrilAccountConnectResult> {
  const inspection = await inspectMithrilToken(rawToken, fetchImpl);
  if (!inspection.ok) return { status: "refused", error: inspection.error };
  lockKagiVault();
  try {
    writeMithrilAccountCredentials(profile, rawToken.trim());
  } catch {
    return { status: "refused", error: "secure_storage_unavailable" };
  }
  try {
    onMithrilConnected(profile);
  } catch {
    /* the token is stored; the agent reads it from the secure store */
  }
  return {
    status: "connected",
    protection: cloudAccountStorageProtection(),
    account: {
      userId: inspection.userId,
      accountUrl: MITHRIL_ACCOUNT_URL,
      live: true,
      scopes: inspection.scopes,
      balanceMicroUsd: inspection.balanceMicroUsd,
      ...(inspection.billingError ? { error: inspection.billingError } : {}),
    },
  };
}

export async function mithrilAccount(
  profile?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MithrilAccount | null> {
  const token = readCloudAccountToken(profile);
  if (!token) return null;
  const inspection = await inspectMithrilToken(token, fetchImpl);
  if (!inspection.ok) {
    return {
      userId: "",
      accountUrl: MITHRIL_ACCOUNT_URL,
      live: false,
      scopes: [],
      balanceMicroUsd: null,
      error: inspection.error,
    };
  }
  return {
    userId: inspection.userId,
    accountUrl: MITHRIL_ACCOUNT_URL,
    live: true,
    scopes: inspection.scopes,
    balanceMicroUsd: inspection.balanceMicroUsd,
    ...(inspection.billingError ? { error: inspection.billingError } : {}),
  };
}

export function disconnectMithrilAccount(profile?: string): {
  success: boolean;
} {
  lockKagiVault();
  clearCloudAccountToken();
  clearMithrilToken(profile);
  try {
    onMithrilDisconnected();
  } catch {
    /* nothing cached */
  }
  return { success: true };
}
