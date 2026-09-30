import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectMithrilAccount,
  disconnectMithrilAccount,
  mithrilAccount,
} from "./mithril-account";
import {
  clearMithrilToken,
  readMithrilToken,
  writeMithrilToken,
} from "./mithril-token-store";

vi.mock("./mithril-token-store", () => ({
  clearMithrilToken: vi.fn(),
  mithrilStorageProtection: vi.fn(() => "reduced"),
  readMithrilToken: vi.fn(),
  writeMithrilToken: vi.fn(),
}));

const token = `mf_${"a".repeat(43)}`;
const reply = (status: number, body: unknown): Response =>
  ({ status, json: async () => body }) as Response;

beforeEach(() => vi.clearAllMocks());

describe("native Mithril account", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account#Connect and storage]]
  it("stores only a token proven by the Mithril API", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply(200, {
          user: { id: "u1" },
          via: "api_token",
          scopes: ["billing:read"],
        }),
      )
      .mockResolvedValueOnce(
        reply(200, {
          balanceMicroUsd: 100_000,
          ledgerSum: 100_000,
          consistent: true,
        }),
      );
    expect(
      await connectMithrilAccount(token, "profile-a", fetcher as typeof fetch),
    ).toMatchObject({
      status: "connected",
      protection: "reduced",
      account: { userId: "u1", balanceMicroUsd: 100_000 },
    });
    expect(writeMithrilToken).toHaveBeenCalledWith("profile-a", token);
    expect(
      await connectMithrilAccount(
        "kc_pat_legacy",
        "profile-a",
        fetcher as typeof fetch,
      ),
    ).toEqual({ status: "refused", error: "invalid_mithril_token" });
    expect(writeMithrilToken).toHaveBeenCalledTimes(1);
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account#Unavailable keychain]]
  it("fails closed when the OS cannot store the token securely", async () => {
    vi.mocked(writeMithrilToken).mockImplementation(() => {
      throw new Error("keychain unavailable");
    });
    const fetcher = vi.fn().mockResolvedValue(
      reply(200, {
        user: { id: "u1" },
        via: "api_token",
        scopes: ["sandbox"],
      }),
    );
    expect(
      await connectMithrilAccount(token, undefined, fetcher as typeof fetch),
    ).toEqual({ status: "refused", error: "secure_storage_unavailable" });
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account#Revocation on read]]
  it("rechecks a stored token and does not call a revoked token live", async () => {
    vi.mocked(readMithrilToken).mockReturnValue(token);
    const fetcher = vi
      .fn()
      .mockResolvedValue(reply(401, { error: { code: "unauthenticated" } }));
    expect(
      await mithrilAccount("profile-a", fetcher as typeof fetch),
    ).toMatchObject({
      live: false,
      balanceMicroUsd: null,
      error: "unauthenticated",
    });
    expect(disconnectMithrilAccount("profile-a")).toEqual({ success: true });
    expect(clearMithrilToken).toHaveBeenCalledWith("profile-a");
  });
});
