import { describe, expect, it, vi } from "vitest";
import { mithrilFirstRunState } from "./first-run";
import {
  cloudAccountStorageProtection,
  readCloudAccountToken,
} from "./mithril-token-store";

vi.mock("./mithril-token-store", () => ({
  readCloudAccountToken: vi.fn(),
  cloudAccountStorageProtection: vi.fn(() => "keychain"),
}));

describe("Mithril first-run gate", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#First-run connect]]
  it("is connected only when an mf_ token is stored, without any network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.mocked(readCloudAccountToken).mockReturnValueOnce(null);
    expect(mithrilFirstRunState("default")).toEqual({
      connected: false,
      protection: "keychain",
    });
    vi.mocked(readCloudAccountToken).mockReturnValueOnce("mf_x");
    expect(mithrilFirstRunState("default")).toEqual({
      connected: true,
      protection: "keychain",
    });
    vi.mocked(readCloudAccountToken).mockReturnValueOnce("mf_x");
    vi.mocked(cloudAccountStorageProtection).mockReturnValueOnce("reduced");
    expect(mithrilFirstRunState("default").protection).toBe("reduced");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
