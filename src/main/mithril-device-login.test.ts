import { describe, expect, it } from "vitest";
import { interpretMithrilTokenResponse } from "./mithril-device-login";

describe("interpretMithrilTokenResponse", () => {
  it("returns the token on success", () => {
    expect(
      interpretMithrilTokenResponse(true, 200, { access_token: "mf_x" }),
    ).toEqual({ kind: "success", accessToken: "mf_x" });
  });
  it("maps RFC 8628 errors", () => {
    const err = (error: string) =>
      interpretMithrilTokenResponse(false, 400, { error });
    expect(err("authorization_pending")).toEqual({ kind: "pending" });
    expect(err("slow_down")).toEqual({ kind: "slow_down" });
    expect(err("access_denied")).toEqual({
      kind: "error",
      error: "device_denied",
    });
    expect(err("expired_token")).toEqual({
      kind: "error",
      error: "device_expired",
    });
  });
});
