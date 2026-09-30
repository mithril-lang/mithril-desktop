import { describe, expect, it } from "vitest";
import { classifyMithrilError, describeMithrilError } from "./mithril-errors";

describe("classifyMithrilError", () => {
  it.each([
    [
      "Error code: 429 - {'error': {'code': 'free_tier_exhausted'}}",
      "free_tier_exhausted",
    ],
    [
      "Error code: 402 - {'error': {'code': 'insufficient_credit'}}",
      "insufficient_credit",
    ],
    [
      "Error code: 400 - {'error': {'code': 'input_too_large', 'message': 'chat request exceeds the input limit'}}",
      "input_too_large",
    ],
    [
      "Error code: 401 - {'error': {'code': 'mithril_token_required'}}",
      "token_invalid",
    ],
    ["research_scope_required", "research_scope_required"],
  ])("maps %s", (raw, kind) => {
    expect(classifyMithrilError(raw)?.kind).toBe(kind);
  });

  it("ignores unrelated errors and non-strings", () => {
    expect(classifyMithrilError("socket hang up")).toBeNull();
    expect(classifyMithrilError(undefined)).toBeNull();
  });

  it("never echoes the raw string", () => {
    const info = classifyMithrilError("free_tier_exhausted Bearer mf_secret")!;
    expect(JSON.stringify(info)).not.toContain("mf_secret");
    expect(describeMithrilError(info, "ja")).toContain("無料枠");
  });
});
