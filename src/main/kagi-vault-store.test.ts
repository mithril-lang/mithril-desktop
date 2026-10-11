// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const control = vi.hoisted(() => ({ available: true, failRead: false }));
vi.mock("./mithril-token-store", () => ({
  mithrilKeychainAvailable: () => control.available,
}));
vi.mock("electron", () => ({
  safeStorage: {
    encryptString: (s: string) => Buffer.from("encrypted:" + s),
    decryptString: (b: Buffer) => {
      if (control.failRead) throw new Error("locked");
      return b.toString().slice(10);
    },
  },
}));
vi.mock("./utils", () => ({
  safeWriteFile: (path: string, text: string) =>
    writeFileSync(path, text, { mode: 0o600 }),
}));
import { writeKagiVaultState, readKagiVaultState } from "./kagi-vault-store";
const paths: string[] = [];
function path(): string {
  const dir = mkdtempSync(join(tmpdir(), "mithril-vault-test-"));
  paths.push(dir);
  return join(dir, "state.json");
}
afterEach(() => {
  for (const dir of paths.splice(0))
    rmSync(dir, { recursive: true, force: true });
  control.available = true;
  control.failRead = false;
});
const state = (): import("./kagi-vault-client").VaultState => ({
  ownerId: "owner-a",
  vaultId: "a".repeat(32),
  key: new Uint8Array(32).fill(42),
  records: {},
});
it("refuses weak or unavailable key storage and preserves the existing file", () => {
  const file = path();
  writeFileSync(file, "existing");
  control.available = false;
  expect(() => writeKagiVaultState(file, state())).toThrow(
    "Vault keychain unavailable.",
  );
  expect(readFileSync(file, "utf8")).toBe("existing");
});
it("verifies keychain read-back before replacing working state", () => {
  const file = path();
  writeFileSync(file, "existing");
  control.failRead = true;
  expect(() => writeKagiVaultState(file, state())).toThrow();
  expect(readFileSync(file, "utf8")).toBe("existing");
});
it("restores key and pending state only for the same owner and preserves corrupt files", () => {
  const file = path();
  writeKagiVaultState(file, state());
  expect(readKagiVaultState(file, "owner-a")?.key).toEqual(
    Buffer.alloc(32, 42),
  );
  const previous = readFileSync(file, "utf8");
  expect(() => readKagiVaultState(file, "owner-b")).toThrow(
    "Vault state could not be opened.",
  );
  expect(readFileSync(file, "utf8")).toBe(previous);
  writeFileSync(file, "corrupt");
  expect(() => readKagiVaultState(file, "owner-a")).toThrow();
  expect(readFileSync(file, "utf8")).toBe("corrupt");
});
