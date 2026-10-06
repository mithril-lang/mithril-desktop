import { describe, expect, it } from "vitest";
import { applyResponseHeaders } from "../src/main/app/response-headers";

describe("Kuro response authority", () => {
  it("preserves the actual sandbox policy without adding a broader duplicate", () => {
    const policy =
      "default-src 'none'; worker-src blob:; connect-src https://app.mithril.fund/spa/kuro/; sandbox allow-scripts; frame-ancestors 'self' https://code.mithril.fund file:";
    const headers = {
      "content-security-policy": [policy],
      "content-type": ["text/html"],
    };
    const result = applyResponseHeaders(
      "https://app.mithril.fund/spa/kuro/index.html",
      headers,
    );
    expect(result).toEqual(headers);
    expect(result).not.toHaveProperty("Content-Security-Policy");
    expect(headers).toEqual(result);
  });
  it("cannot acquire the exception using an adjacent path or lookalike origin", () => {
    for (const url of [
      "https://app.mithril.fund/spa/kuro-evil/",
      "https://app.mithril.fund.evil/spa/kuro/",
    ]) {
      expect(applyResponseHeaders(url)["Content-Security-Policy"][0]).toContain(
        "object-src 'none'",
      );
    }
  });
  it("keeps one local renderer policy and immutable registry caching", () => {
    const result = applyResponseHeaders(
      "file:///Applications/Mithril.app/index.html",
      { "content-security-policy": ["old"] },
    );
    expect(result).not.toHaveProperty("content-security-policy");
    expect(result["Content-Security-Policy"][0]).toContain("wasm-unsafe-eval");
    const icon = applyResponseHeaders(
      "https://registry.hermesone.org/registry-icon/abc.svg",
      { "cache-control": ["no-cache"] },
    );
    expect(icon).not.toHaveProperty("cache-control");
    expect(icon["Cache-Control"]).toEqual([
      "public, max-age=31536000, immutable",
    ]);
  });
});
