// @lat: [[mithril-migration#Mithril desktop migration#Mithril API token contract]]
/** Verify a manually issued Mithril API token before the desktop stores it. */

export const MITHRIL_API_ORIGIN = "https://api.mithril.fund";
export const MITHRIL_ACCOUNT_URL = "https://console.mithril.fund/account";

// packages/server creates `mf_` followed by 32 random bytes in base64url.
const MITHRIL_TOKEN = /^mf_[A-Za-z0-9_-]{43}$/;

export type MithrilTokenInspection =
  | { ok: false; error: string }
  | {
      ok: true;
      userId: string;
      scopes: string[];
      balanceMicroUsd: number | null;
      billingError?: string;
    };

function errorCode(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return fallback;
}

async function getJson(path: string, token: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${MITHRIL_API_ORIGIN}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

export async function inspectMithrilToken(
  rawToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MithrilTokenInspection> {
  const token = rawToken.trim();
  // In particular, never send a legacy credential to Mithril.
  if (!MITHRIL_TOKEN.test(token)) return { ok: false, error: "invalid_mithril_token" };
  try {
    const identity = await getJson("/v1/me", token, fetchImpl);
    if (identity.status !== 200) {
      return { ok: false, error: errorCode(identity.body, `HTTP ${identity.status}`) };
    }
    const me = identity.body as {
      user?: { id?: unknown } | null;
      via?: unknown;
      scopes?: unknown;
    } | null;
    if (me?.via !== "api_token" || typeof me.user?.id !== "string" ||
        !Array.isArray(me.scopes) || !me.scopes.every((scope) => typeof scope === "string")) {
      return { ok: false, error: "malformed_identity" };
    }
    const result: Extract<MithrilTokenInspection, { ok: true }> = {
      ok: true,
      userId: me.user.id,
      scopes: me.scopes,
      balanceMicroUsd: null,
    };
    if (!result.scopes.includes("billing:read")) {
      result.billingError = "insufficient_scope";
      return result;
    }
    let billing: Awaited<ReturnType<typeof getJson>>;
    try {
      billing = await getJson("/v1/billing/status", token, fetchImpl);
    } catch {
      result.billingError = "billing_unavailable";
      return result;
    }
    if (billing.status === 401) {
      return { ok: false, error: errorCode(billing.body, "unauthenticated") };
    }
    if (billing.status !== 200) {
      result.billingError = errorCode(billing.body, `HTTP ${billing.status}`);
      return result;
    }
    const balance = billing.body as {
      balanceMicroUsd?: unknown;
      ledgerSum?: unknown;
      consistent?: unknown;
    } | null;
    if (typeof balance?.balanceMicroUsd !== "number" ||
        !Number.isSafeInteger(balance.balanceMicroUsd) ||
        balance.consistent !== true ||
        balance.ledgerSum !== balance.balanceMicroUsd) {
      result.billingError = "ledger_mismatch_or_malformed_balance";
      return result;
    }
    result.balanceMicroUsd = balance.balanceMicroUsd;
    return result;
  } catch {
    // No exception text is exposed: a network library might embed request headers.
    return { ok: false, error: "mithril_api_unavailable" };
  }
}
