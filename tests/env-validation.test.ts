import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;

async function loadConfigModule(): Promise<
  typeof import("../src/main/config")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/config");
}

function readEnvFile(): string {
  return readFileSync(join(testHome, ".env"), "utf-8");
}

describe("environment variable write validation", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-env-validation-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("accepts standard environment variable names and single-line values", async () => {
    const { readEnv, setEnvValue } = await loadConfigModule();

    setEnvValue("OPENAI_API_KEY", "sk-valid");
    setEnvValue("_CUSTOM_TOKEN_2", "token=value=with=equals");

    expect(readEnv()).toEqual({
      OPENAI_API_KEY: "sk-valid",
      _CUSTOM_TOKEN_2: "token=value=with=equals",
    });
    expect(readEnvFile()).toContain("OPENAI_API_KEY=sk-valid");
  });

  it("rejects malformed environment variable names", async () => {
    const { setEnvValue } = await loadConfigModule();

    expect(() => setEnvValue("1TOKEN", "value")).toThrow(
      /Invalid environment variable name/,
    );
    expect(() => setEnvValue("BAD-KEY", "value")).toThrow(
      /Invalid environment variable name/,
    );
    expect(() => setEnvValue("KEY\nINJECTED", "value")).toThrow(
      /Invalid environment variable name/,
    );
    expect(existsSync(join(testHome, ".env"))).toBe(false);
  });

  it("rejects newline and NUL characters before rewriting .env", async () => {
    const { setEnvValue } = await loadConfigModule();

    setEnvValue("SAFE_KEY", "original");

    expect(() => setEnvValue("SAFE_KEY", "next\nINJECTED=value")).toThrow(
      /single-line/,
    );
    expect(() => setEnvValue("SAFE_KEY", "next\rINJECTED=value")).toThrow(
      /single-line/,
    );
    expect(() => setEnvValue("SAFE_KEY", "next\0INJECTED=value")).toThrow(
      /single-line/,
    );

    expect(readEnvFile()).toBe("SAFE_KEY=original\n");
  });

  it("keeps empty values in the read-back dict (valid POSIX env var)", async () => {
    const { readEnv, setEnvValue } = await loadConfigModule();

    setEnvValue("EMPTY_FLAG", "");
    setEnvValue("WITH_VALUE", "present");

    const env = readEnv();
    expect(env.EMPTY_FLAG).toBe("");
    expect(env.WITH_VALUE).toBe("present");
    expect(readEnvFile()).toContain("EMPTY_FLAG=\n");
  });

  it("validates MITHRIL_API_KEY as an mf_ token and never stores it", async () => {
    const { setEnvValue, validateEnvEntry } = await loadConfigModule();

    expect(() => validateEnvEntry("MITHRIL_API_KEY", "mf_ok")).not.toThrow();
    expect(() =>
      setEnvValue("MITHRIL_API_KEY", "sk-not-a-mithril-token"),
    ).toThrow(/start with mf_/);
    // Clearing is allowed (no secret involved).
    expect(() => setEnvValue("MITHRIL_API_KEY", "")).not.toThrow();
  });
});

describe("Mithril token is never written to .env", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-env-mithril-"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Token-only-in-secure-store#No plaintext written]]
  it("refuses to persist an mf_ token, overlays the secure value in memory only", async () => {
    const { readEnv, setEnvValue } = await loadConfigModule();
    const { registerSecureEnvSource } = await import("../src/main/secure-env");
    expect(() => setEnvValue("MITHRIL_API_KEY", "mf_secret")).toThrow(
      /secure store/,
    );
    expect(existsSync(join(testHome, ".env"))).toBe(false);

    registerSecureEnvSource(() => ({ MITHRIL_API_KEY: "mf_from_keychain" }));
    expect(readEnv().MITHRIL_API_KEY).toBe("mf_from_keychain");
    expect(existsSync(join(testHome, ".env"))).toBe(false);
    registerSecureEnvSource(null);
  });
});
