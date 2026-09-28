import { describe, expect, it, vi } from "vitest";
import { inspectMithrilToken, MITHRIL_API_ORIGIN } from "./mithril-token";

const token = `mf_${"a".repeat(43)}`;
const reply = (status: number, body: unknown) =>
  ({ status, json: async () => body }) as Response;
const me = (scopes: string[]) => ({ user: { id: "user-1" }, via: "api_token", scopes });

describe("Mithril API token inspection", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#Mithril API token contract#Legacy token isolation]]
  it("rejects legacy credentials before any request", async () => {
    const fetcher = vi.fn();
    expect(await inspectMithrilToken("kc_pat_legacy.id.mac", fetcher as typeof fetch))
      .toEqual({ ok: false, error: "invalid_mithril_token" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Mithril API token contract#Identity and balance]]
  it("proves identity and a ledger-consistent balance against fixed Mithril URLs", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(200, me(["billing:read", "sandbox"])))
      .mockResolvedValueOnce(reply(200, { balanceMicroUsd: 1_250_000, ledgerSum: 1_250_000, consistent: true }));
    expect(await inspectMithrilToken(token, fetcher as typeof fetch)).toEqual({
      ok: true, userId: "user-1", scopes: ["billing:read", "sandbox"], balanceMicroUsd: 1_250_000,
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${MITHRIL_API_ORIGIN}/v1/me`, `${MITHRIL_API_ORIGIN}/v1/billing/status`,
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({
        headers: { authorization: `Bearer ${token}` }, credentials: "omit", redirect: "error",
      });
    }
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Mithril API token contract#Missing billing scope]]
  it("keeps a valid token connected when it lacks billing scope", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(200, me(["sandbox"])));
    expect(await inspectMithrilToken(token, fetcher as typeof fetch)).toEqual({
      ok: true, userId: "user-1", scopes: ["sandbox"], balanceMicroUsd: null,
      billingError: "insufficient_scope",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Mithril API token contract#Billing unavailable]]
  it("keeps identity verified when only the billing request fails", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(200, me(["billing:read"])))
      .mockRejectedValueOnce(new Error("network failed"));
    expect(await inspectMithrilToken(token, fetcher as typeof fetch)).toMatchObject({
      ok: true, userId: "user-1", balanceMicroUsd: null, billingError: "billing_unavailable",
    });
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Mithril API token contract#Revocation and mismatch]]
  it("rejects revoked credentials and never presents an inconsistent balance", async () => {
    const revoked = vi.fn().mockResolvedValue(reply(401, { error: { code: "unauthenticated" } }));
    expect(await inspectMithrilToken(token, revoked as typeof fetch))
      .toEqual({ ok: false, error: "unauthenticated" });
    const mismatch = vi.fn()
      .mockResolvedValueOnce(reply(200, me(["billing:read"])))
      .mockResolvedValueOnce(reply(200, { balanceMicroUsd: 2_000_000, ledgerSum: 1_000_000, consistent: false }));
    expect(await inspectMithrilToken(token, mismatch as typeof fetch)).toMatchObject({
      ok: true, balanceMicroUsd: null, billingError: "ledger_mismatch_or_malformed_balance",
    });
  });
});
