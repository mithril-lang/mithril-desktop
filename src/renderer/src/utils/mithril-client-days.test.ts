import { afterEach, expect, it, vi } from "vitest";
import {
  getMithrilMeasurementConsent,
  setMithrilMeasurementConsent,
  startMithrilClientDays,
} from "./mithril-client-days";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
// @lat: [[mithril-client-days-tests#Mithril usage day tests#Renderer consent and UTC days]]
it("reports only opted-in foreground days and stops after revocation or cleanup", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
  const report = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("hermesAPI", { recordMithrilClientDay: report });
  // Preload is exposed on window by Electron; the browser test global models it.
  expect(getMithrilMeasurementConsent()).toBe(false);
  const stop = startMithrilClientDays("active");
  expect(report).not.toHaveBeenCalled();
  setMithrilMeasurementConsent(true);
  await Promise.resolve();
  expect(report).toHaveBeenCalledWith(true, "active");
  expect(report).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(report).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  document.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
  expect(report).toHaveBeenCalledTimes(2);
  setMithrilMeasurementConsent(false);
  vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(report).toHaveBeenCalledTimes(2);
  stop();
  setMithrilMeasurementConsent(true);
  await Promise.resolve();
  expect(report).toHaveBeenCalledTimes(2);
});
