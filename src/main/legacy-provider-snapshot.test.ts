import { it, expect, vi } from "vitest";
import { legacyProviderSnapshot } from "./legacy-provider-snapshot";
it("captures only metadata and quarantines retained provider settings without reading configuration", () => {
  const stat = vi.fn(() => ({ size: 128, mtimeMs: 100 }));
  const snapshot = legacyProviderSnapshot("owner", 200, stat);
  expect(snapshot).toEqual({
    policyVersion: 1,
    userId: "owner",
    capturedAt: 200,
    inferenceOrigin: "https://api.mithril.fund",
    legacyAutomaticUse: false,
    configuration: {
      retained: true,
      present: true,
      bytes: 128,
      modifiedAt: 100,
    },
  });
  expect(stat).toHaveBeenCalledTimes(1);
  expect(Object.keys(snapshot.configuration)).not.toContain("provider");
});
