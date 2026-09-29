import { beforeEach, describe, expect, it, vi } from "vitest";
import { repairMithrilKey } from "./mithril-sync";
import { readEnvFile, setEnvValue } from "./config";
import { readMithrilToken } from "./mithril-token-store";

vi.mock("./config", () => ({
  readEnvFile: vi.fn(),
  setEnvValue: vi.fn(),
}));
vi.mock("./mithril-token-store", () => ({ readMithrilToken: vi.fn() }));
vi.mock("./agent-config-providers", () => ({
  mirrorFirstPartyAgentProviders: vi.fn(),
}));

const token = `mf_${"a".repeat(43)}`;

beforeEach(() => vi.clearAllMocks());

describe("repairMithrilKey", () => {
  it("restores the stored token over a non-mf_ key", () => {
    vi.mocked(readEnvFile).mockReturnValue({ MITHRIL_API_KEY: "sk-pasted" });
    vi.mocked(readMithrilToken).mockReturnValue(token);
    expect(repairMithrilKey()).toBe("repaired");
    expect(setEnvValue).toHaveBeenCalledWith(
      "MITHRIL_API_KEY",
      token,
      undefined,
    );
  });

  it("does not touch the keychain when the environment already has an mf_ token", () => {
    vi.mocked(readEnvFile).mockReturnValue({ MITHRIL_API_KEY: token });
    expect(repairMithrilKey()).toBe("unchanged");
    expect(readMithrilToken).not.toHaveBeenCalled();
    expect(setEnvValue).not.toHaveBeenCalled();
  });

  it("leaves the environment alone without a usable stored token", () => {
    vi.mocked(readEnvFile).mockReturnValue({});
    vi.mocked(readMithrilToken).mockReturnValue(null);
    expect(repairMithrilKey()).toBe("no-token");
    vi.mocked(readMithrilToken).mockReturnValue("sk-not-mithril");
    expect(repairMithrilKey()).toBe("no-token");
    expect(setEnvValue).not.toHaveBeenCalled();
  });
});
