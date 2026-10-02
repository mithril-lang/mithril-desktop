// @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account]]
/**
 * Mithril device sign-in (RFC 8628). The desktop asks api.mithril.fund for a
 * code, the person approves it in the console (passkey session), and the
 * desktop receives an `mf_` inference token — no copy/paste.
 */
import { hostname } from "os";
import { MITHRIL_API_ORIGIN } from "./mithril-token";
import { connectMithrilAccount } from "./mithril-account";
import type {
  MithrilAccountConnectResult,
  MithrilDeviceCode,
} from "../shared/account";

export type MithrilPollAction =
  | { kind: "success"; accessToken: string }
  | { kind: "pending" }
  | { kind: "slow_down" }
  | { kind: "error"; error: string };

export function interpretMithrilTokenResponse(
  ok: boolean,
  status: number,
  data: { access_token?: unknown; error?: unknown },
): MithrilPollAction {
  if (ok && typeof data.access_token === "string" && data.access_token) {
    return { kind: "success", accessToken: data.access_token };
  }
  const code = typeof data.error === "string" ? data.error : "";
  switch (code) {
    case "authorization_pending":
      return { kind: "pending" };
    case "slow_down":
      return { kind: "slow_down" };
    case "access_denied":
      return { kind: "error", error: "device_denied" };
    case "expired_token":
      return { kind: "error", error: "device_expired" };
    default:
      return { kind: "error", error: code || `HTTP ${status}` };
  }
}

let active: { cancelled: boolean } | null = null;

export function cancelMithrilDeviceLogin(): boolean {
  if (!active) return false;
  active.cancelled = true;
  return true;
}

function sleep(ms: number, state: { cancelled: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      ms -= 200;
      if (state.cancelled || ms <= 0) {
        clearInterval(timer);
        resolve();
      }
    }, 200);
  });
}

async function post(
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetchImpl(`${MITHRIL_API_ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export async function startMithrilDeviceLogin(
  profile: string | undefined,
  onCode: (info: MithrilDeviceCode) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<MithrilAccountConnectResult> {
  if (active) return { status: "refused", error: "device_in_progress" };
  const state = { cancelled: false };
  active = state;
  try {
    let name = "Mithril Desktop";
    try {
      name = hostname() || name;
    } catch {
      /* keep the default label */
    }
    // Only ask for what the desktop uses: inference and the balance readout.
    const start = await post(
      "/v1/device/code",
      { device_name: name, scope: "inference billing:read" },
      fetchImpl,
    );
    const d = start.data as Record<string, string | number>;
    if (!start.ok || typeof d.device_code !== "string") {
      return {
        status: "refused",
        error:
          start.status === 404 ? "device_unavailable" : "device_start_failed",
      };
    }
    if (state.cancelled)
      return { status: "refused", error: "device_cancelled" };
    // The browser destination is a credential approval surface, never arbitrary.
    const verification = new URL(
      String(d.verification_uri_complete ?? d.verification_uri),
    );
    if (
      verification.origin !== "https://console.mithril.fund" ||
      verification.pathname !== "/account/device"
    ) {
      return { status: "refused", error: "device_start_failed" };
    }
    onCode({
      userCode: String(d.user_code),
      verificationUri: String(d.verification_uri),
      verificationUriComplete: String(
        d.verification_uri_complete ?? d.verification_uri,
      ),
      expiresIn: Number(d.expires_in) || 600,
      interval: Number(d.interval) || 5,
    });
    let intervalMs = Math.max(1, Number(d.interval) || 5) * 1000;
    const deadline = Date.now() + (Number(d.expires_in) || 600) * 1000;
    while (!state.cancelled) {
      await sleep(intervalMs, state);
      if (state.cancelled) break;
      if (Date.now() > deadline)
        return { status: "refused", error: "device_expired" };
      let action: MithrilPollAction;
      try {
        const res = await post(
          "/v1/device/token",
          { device_code: d.device_code },
          fetchImpl,
        );
        action = interpretMithrilTokenResponse(res.ok, res.status, res.data);
      } catch {
        continue; // transient network error: keep polling until the deadline
      }
      if (state.cancelled) break;
      if (action.kind === "success") {
        // Verified against /v1/me, stored encrypted, mirrored into the agent env.
        return connectMithrilAccount(action.accessToken, profile, fetchImpl);
      }
      if (action.kind === "slow_down") intervalMs += 5000;
      else if (action.kind === "error")
        return { status: "refused", error: action.error };
    }
    return { status: "refused", error: "device_cancelled" };
  } catch {
    return { status: "refused", error: "device_start_failed" };
  } finally {
    active = null;
  }
}
