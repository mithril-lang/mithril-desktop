import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ base: "", available: true, failRead: false }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (value: Buffer) => {
      if (state.failRead) throw new Error("keychain locked");
      return value.toString().replace(/^sealed:/, "");
    },
  },
}));
vi.mock("./utils", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  return {
    profileHome: (profile?: string) => path.join(state.base, profile ?? "default"),
    safeWriteFile: (file: string, value: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, value);
    },
  };
});

import { clearMithrilToken, MITHRIL_TOKEN_FILE, readMithrilToken, writeMithrilToken } from "./mithril-token-store";

beforeAll(() => { state.base = mkdtempSync(join(tmpdir(), "mithril-token-test-")); });
afterAll(() => { rmSync(state.base, { recursive: true, force: true }); });

describe("Mithril token at rest", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#Secure Mithril token storage#Profile isolation]]
  it("stores a round-trippable encrypted file in the selected profile only", () => {
    const token = `mf_${"a".repeat(43)}`;
    writeMithrilToken("alice", token);
    expect(readMithrilToken("alice")).toBe(token);
    expect(readMithrilToken("bob")).toBeNull();
    expect(readFileSync(join(state.base, "alice", MITHRIL_TOKEN_FILE), "utf8"))
      .not.toContain(token);
    clearMithrilToken("alice");
    expect(readMithrilToken("alice")).toBeNull();
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Secure Mithril token storage#No plaintext fallback]]
  it("refuses to write when encryption is unavailable", () => {
    state.available = false;
    expect(() => writeMithrilToken("bob", `mf_${"b".repeat(43)}`))
      .toThrow("Secure token storage is unavailable.");
    expect(readMithrilToken("bob")).toBeNull();
    state.available = true;
  });

  // @lat: [[mithril-migration#Mithril desktop migration#Secure Mithril token storage#Failed replacement]]
  it("restores the prior encrypted token when a replacement cannot be read back", () => {
    const previous = `mf_${"c".repeat(43)}`;
    writeMithrilToken("carol", previous);
    state.failRead = true;
    expect(() => writeMithrilToken("carol", `mf_${"d".repeat(43)}`))
      .toThrow("The keychain could not read the stored token.");
    state.failRead = false;
    expect(readMithrilToken("carol")).toBe(previous);
  });
});
