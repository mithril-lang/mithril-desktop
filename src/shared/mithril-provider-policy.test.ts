import { describe, expect, it } from "vitest";
import {
  isMithrilProvider,
  requireMithrilProvider,
  mithrilModelConfig,
  MITHRIL_PROVIDER_URL,
} from "./mithril-provider-policy";
describe("Desktop Mithril provider boundary", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#Mithril Agent only#Provider routing boundary]]
  it("accepts the canonical provider and exact legacy Mithril alias, refusing redirects and third-party endpoints", () => {
    expect(isMithrilProvider("mithril")).toBe(true);
    expect(isMithrilProvider("custom", MITHRIL_PROVIDER_URL + "/")).toBe(true);
    for (const [provider, url] of [
      ["auto", ""],
      ["openai", ""],
      ["custom", "https://api.openai.com/v1"],
      ["mithril", "https://api.mithril.fund.evil.test/v1"],
      ["mithril", MITHRIL_PROVIDER_URL + "?redirect=1"],
    ])
      expect(() => requireMithrilProvider(provider, url)).toThrow(
        "only Mithril Agent",
      );
  });
  it("projects legacy config into Mithril without mutating stored settings", () => {
    const old = {
      provider: "openrouter",
      model: "legacy/model",
      baseUrl: "https://openrouter.ai/api/v1",
    };
    const before = { ...old };
    expect(mithrilModelConfig(old)).toEqual({
      provider: "mithril",
      model: "qwen/qwen3.8-27b",
      baseUrl: MITHRIL_PROVIDER_URL,
    });
    expect(old).toEqual(before);
    expect(
      mithrilModelConfig({
        provider: "custom",
        model: "mithril/model",
        baseUrl: MITHRIL_PROVIDER_URL,
      }).model,
    ).toBe("mithril/model");
  });
});
