import { afterEach, expect, it, vi } from "vitest";
vi.mock("./mithril-token-store", () => ({
  readMithrilToken: vi.fn(() => "private-test-token"),
}));
import { readMithrilToken } from "./mithril-token-store";
import { recordMithrilClientDay } from "./mithril-client-day";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
// @lat: [[mithril-client-days-tests#Mithril usage day tests#Main explicit consent]]
it("does not access credentials or network without explicit consent", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  expect(await recordMithrilClientDay(false, "profile")).toBe(false);
  expect(await recordMithrilClientDay("true", "profile")).toBe(false);
  expect(readMithrilToken).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
// @lat: [[mithril-client-days-tests#Mithril usage day tests#Main fixed endpoint]]
it("uses fixed origin and profile credential only in main with a closed payload", async () => {
  const request = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", request);
  expect(await recordMithrilClientDay(true, "profile")).toBe(true);
  expect(readMithrilToken).toHaveBeenCalledWith("profile");
  const [url, options] = request.mock.calls[0];
  expect(url).toBe("https://api.mithril.fund/v1/measurement/client-day");
  expect(JSON.parse(options.body)).toEqual({
    client: { darwin: "macos", linux: "linux", win32: "windows" }[
      process.platform
    ],
    consented: true,
  });
  expect(options.redirect).toBe("error");
  expect(options.headers.Authorization).toBe("Bearer private-test-token");
});
// @lat: [[mithril-client-days-tests#Mithril usage day tests#Nonblocking failures]]
it("keeps failure nonblocking without exposing the bearer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("private-test-token")),
  );
  expect(await recordMithrilClientDay(true)).toBe(false);
});
