// @lat: [[e2ee-vault#Local key custody]]
import { safeStorage } from "electron";
import { readFileSync, existsSync, statSync } from "node:fs";
import { mithrilKeychainAvailable } from "./mithril-token-store";
import { safeWriteFile } from "./utils";
import type { VaultState } from "./kagi-vault-client";

/** No reduced-protection fallback for the key that unlocks an entire E2EE Vault. */
export function writeKagiVaultState(path: string, state: VaultState): void {
  if (!mithrilKeychainAvailable() || state.key.length !== 32)
    throw new Error("Vault keychain unavailable.");
  const plaintext = JSON.stringify({
    version: 1,
    ...state,
    key: Buffer.from(state.key).toString("base64"),
  });
  const ciphertext = safeStorage.encryptString(plaintext);
  // Verify keychain read-back before replacing the last working state.
  if (safeStorage.decryptString(ciphertext) !== plaintext)
    throw new Error("Vault keychain verification failed.");
  const stored = JSON.stringify({
    version: 1,
    ciphertext: ciphertext.toString("base64"),
  });
  if (Buffer.byteLength(stored, "utf8") > 16777216)
    throw Error("Vault state exceeds the local storage limit.");
  safeWriteFile(path, stored);
}
export function readKagiVaultState(
  path: string,
  ownerId: string,
): VaultState | null {
  if (!existsSync(path)) return null;
  if (!mithrilKeychainAvailable())
    throw new Error("Vault keychain unavailable.");
  try {
    if (statSync(path).size > 16777216) throw new Error();
    const stored = JSON.parse(readFileSync(path, "utf8"));
    if (stored.version !== 1 || typeof stored.ciphertext !== "string")
      throw new Error();
    const state = JSON.parse(
      safeStorage.decryptString(Buffer.from(stored.ciphertext, "base64")),
    );
    const key = Buffer.from(state.key, "base64");
    if (
      state.version !== 1 ||
      state.ownerId !== ownerId ||
      !/^[a-f0-9]{32}$/.test(state.vaultId) ||
      key.length !== 32 ||
      !state.records ||
      typeof state.records !== "object" ||
      Array.isArray(state.records)
    )
      throw new Error();
    return {
      ownerId,
      vaultId: state.vaultId,
      key,
      records: state.records,
      pending: state.pending,
    };
  } catch {
    throw new Error("Vault state could not be opened.");
  }
}
