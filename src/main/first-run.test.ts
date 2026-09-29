import { describe, expect, it, vi } from "vitest";
import { mithrilFirstRunState } from "./first-run";
import { readMithrilToken } from "./mithril-token-store";

vi.mock("./mithril-token-store", () => ({ readMithrilToken: vi.fn() }));

describe("Mithril first-run gate", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#First-run connect]]
  it("is connected only when an mf_ token is stored, without any network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.mocked(readMithrilToken).mockReturnValueOnce(null);
    expect(mithrilFirstRunState("default")).toEqual({ connected: false });
    vi.mocked(readMithrilToken).mockReturnValueOnce("mf_x");
    expect(mithrilFirstRunState("default")).toEqual({ connected: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
