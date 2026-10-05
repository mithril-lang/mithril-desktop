import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelMithrilDeviceLogin,
  startMithrilDeviceLogin,
  interpretMithrilTokenResponse,
} from "./mithril-device-login";

describe("interpretMithrilTokenResponse", () => {
  it("returns the token on success", () => {
    expect(
      interpretMithrilTokenResponse(true, 200, { access_token: "mf_x" }),
    ).toEqual({ kind: "success", accessToken: "mf_x" });
  });
  it("maps RFC 8628 errors", () => {
    const err = (
      error: string,
    ): ReturnType<typeof interpretMithrilTokenResponse> =>
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

vi.mock("./mithril-account", () => ({
  connectMithrilAccount: vi.fn().mockResolvedValue({ status: "connected" }),
}));
import { connectMithrilAccount } from "./mithril-account";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
const grant = {
  device_code: "fixture-device",
  user_code: "ABCD-EFGH",
  verification_uri: "https://console.mithril.fund/account/device",
  expires_in: 600,
  interval: 1,
};
const reply = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });
// @lat: [[mithril-migration#Mithril desktop migration#First-run connect]]
describe("device flow lifecycle", () => {
  it("polls and connects the selected profile after approval", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(grant))
      .mockResolvedValueOnce(
        reply({
          access_token: "mf_fixture",
          scope:
            "inference billing:read workspace:read workspace:write chat:read chat:write",
        }),
      );
    const code = vi.fn();
    const result = startMithrilDeviceLogin("fixture-profile", code, fetcher);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await result).toEqual({ status: "connected" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      scope:
        "inference billing:read workspace:read workspace:write chat:read chat:write",
    });
    expect(code).toHaveBeenCalledWith(
      expect.objectContaining({ userCode: grant.user_code }),
    );
    expect(connectMithrilAccount).toHaveBeenCalledWith(
      "mf_fixture",
      "fixture-profile",
      fetcher,
    );
  });
  it("does not persist an approval arriving after cancellation", async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(grant))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const result = startMithrilDeviceLogin("fixture-profile", vi.fn(), fetcher);
    await vi.advanceTimersByTimeAsync(1100);
    cancelMithrilDeviceLogin();
    finish(reply({ access_token: "mf_fixture" }));
    expect(await result).toEqual({
      status: "refused",
      error: "device_cancelled",
    });
    expect(connectMithrilAccount).not.toHaveBeenCalled();
  });
  it("refuses an unexpected browser approval origin", async () => {
    const onCode = vi.fn();
    const result = await startMithrilDeviceLogin(
      undefined,
      onCode,
      vi.fn().mockResolvedValue(
        reply({
          ...grant,
          verification_uri: "https://example.com/account/device",
        }),
      ),
    );
    expect(result).toEqual({ status: "refused", error: "device_start_failed" });
    expect(onCode).not.toHaveBeenCalled();
  });
});

it("keeps the existing credential when browser approval lacks workspace scopes", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(grant))
    .mockResolvedValueOnce(
      reply({ access_token: "mf_fixture", scope: "inference billing:read" }),
    );
  const result = startMithrilDeviceLogin("fixture-profile", vi.fn(), fetcher);
  await vi.advanceTimersByTimeAsync(1100);
  expect(await result).toEqual({
    status: "refused",
    error: "device_workspace_authorization_required",
  });
  expect(connectMithrilAccount).not.toHaveBeenCalled();
});
