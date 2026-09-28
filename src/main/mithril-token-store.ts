// @lat: [[mithril-migration#Mithril desktop migration#Secure Mithril token storage]]
/** New Mithril credentials are isolated from the legacy Kotoba token file. */
import { safeStorage } from "electron";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";

export const MITHRIL_TOKEN_FILE = "mithril-token.json";

const tokenPath = (profile?: string): string =>
  join(profileHome(profile), MITHRIL_TOKEN_FILE);

export function mithrilSecureStorageAvailable(): boolean {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

export function readMithrilToken(profile?: string): string | null {
  const path = tokenPath(profile);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      version?: unknown;
      encryptedToken?: unknown;
    };
    if (data.version !== 1 || typeof data.encryptedToken !== "string")
      return null;
    return (
      safeStorage
        .decryptString(Buffer.from(data.encryptedToken, "base64"))
        .trim() || null
    );
  } catch {
    return null;
  }
}

export function writeMithrilToken(
  profile: string | undefined,
  token: string,
): void {
  if (!token || !mithrilSecureStorageAvailable()) {
    throw new Error("Secure token storage is unavailable.");
  }
  const path = tokenPath(profile);
  const previous = existsSync(path) ? readFileSync(path, "utf8") : null;
  try {
    safeWriteFile(
      path,
      JSON.stringify({
        version: 1,
        encryptedToken: safeStorage.encryptString(token).toString("base64"),
      }),
    );
    if (readMithrilToken(profile) !== token) {
      throw new Error("The keychain could not read the stored token.");
    }
  } catch (error) {
    // A failed replacement must not silently discard an older working token.
    if (previous !== null) safeWriteFile(path, previous);
    else if (existsSync(path)) unlinkSync(path);
    throw error;
  }
}

export function clearMithrilToken(profile?: string): void {
  const path = tokenPath(profile);
  if (existsSync(path)) unlinkSync(path);
}
