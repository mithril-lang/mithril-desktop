// @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account]]
import { MITHRIL_ACCOUNT_URL, inspectMithrilToken } from "./mithril-token";
import { clearMithrilToken, readMithrilToken, writeMithrilToken } from "./mithril-token-store";
import type { MithrilAccount, MithrilAccountConnectResult } from "../shared/account";

export async function connectMithrilAccount(
  rawToken: string,
  profile?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MithrilAccountConnectResult> {
  const inspection = await inspectMithrilToken(rawToken, fetchImpl);
  if (!inspection.ok) return { status: "refused", error: inspection.error };
  try {
    writeMithrilToken(profile, rawToken.trim());
  } catch {
    return { status: "refused", error: "secure_storage_unavailable" };
  }
  return {
    status: "connected",
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
  const token = readMithrilToken(profile);
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

export function disconnectMithrilAccount(profile?: string): { success: boolean } {
  clearMithrilToken(profile);
  return { success: true };
}
