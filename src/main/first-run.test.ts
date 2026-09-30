import { describe, expect, it, vi } from "vitest";
import { mithrilFirstRunState } from "./first-run";
import {
  mithrilStorageProtection,
  readMithrilToken,
} from "./mithril-token-store";

vi.mock("./mithril-token-store", () => ({
  readMithrilToken: vi.fn(),
  mithrilStorageProtection: vi.fn(() => "keychain"),
}));

describe("Mithril first-run gate", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#First-run connect]]
  it("is connected only when an mf_ token is stored, without any network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.mocked(readMithrilToken).mockReturnValueOnce(null);
    expect(mithrilFirstRunState("default")).toEqual({
      connected: false,
      protection: "keychain",
    });
    vi.mocked(readMithrilToken).mockReturnValueOnce("mf_x");
    expect(mithrilFirstRunState("default")).toEqual({
      connected: true,
      protection: "keychain",
    });
    vi.mocked(readMithrilToken).mockReturnValueOnce("mf_x");
    vi.mocked(mithrilStorageProtection).mockReturnValueOnce("reduced");
    expect(mithrilFirstRunState("default").protection).toBe("reduced");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
