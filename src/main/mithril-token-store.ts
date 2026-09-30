// @lat: [[mithril-migration#Mithril desktop migration#Secure Mithril token storage]]
/**
 * New Mithril credentials are isolated from the legacy Kotoba token file.
 *
 * Two at-rest formats, chosen by what the machine offers:
 *  - v1 "keychain": Electron `safeStorage` (macOS Keychain, Windows DPAPI,
 *    Linux libsecret/KWallet). Preferred whenever a real backend exists.
 *  - v2 "reduced": AES-256-GCM with a key derived (HKDF-SHA256) from a
 *    per-install random secret kept in a 0600 file under Electron `userData`.
 *    Used only when no system keyring is found. This is WEAKER than the OS
 *    keychain: anything running as the same OS user can read both files. It
 *    still keeps the bearer out of plaintext, out of backups/copies of the
 *    profile directory (the secret lives outside it), and out of logs.
 * `--password-store=basic` is deliberately not used: Chromium then encrypts
 * with a fixed, publicly known key, which is weaker than a random secret.
 */
import { app, safeStorage } from "electron";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "crypto";
import { dirname, join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import type { MithrilStorageProtection } from "../shared/account";

export const MITHRIL_TOKEN_FILE = "mithril-token.json";

const tokenPath = (profile?: string): string =>
  join(profileHome(profile), MITHRIL_TOKEN_FILE);

/** Per-install secret for the reduced-protection format (outside profiles). */
export const MITHRIL_INSTALL_SECRET_FILE = "mithril-install-secret";
const FILE_SCHEME = "aes-256-gcm-hkdf-sha256";
const AAD = Buffer.from("mithril-token:v2");

/** True only when a real system keyring backs safeStorage. */
export function mithrilKeychainAvailable(): boolean {
  try {
    if (!safeStorage?.isEncryptionAvailable?.()) return false;
    // Linux without a keyring: Chromium falls back to a hard-coded key.
    const backend = (
      safeStorage as { getSelectedStorageBackend?: () => string }
    ).getSelectedStorageBackend?.();
    return backend !== "basic_text";
  } catch {
    return false;
  }
}

/** Back-compat name: is there some usable at-rest protection at all? */
export function mithrilSecureStorageAvailable(): boolean {
  return mithrilKeychainAvailable() || installSecretUsable();
}

function installSecretPath(): string {
  return join(app.getPath("userData"), MITHRIL_INSTALL_SECRET_FILE);
}

function installSecretUsable(): boolean {
  try {
    return Boolean(installSecretPath());
  } catch {
    return false;
  }
}

function loadInstallSecret(create: boolean): Buffer | null {
  const path = installSecretPath();
  if (existsSync(path)) {
    const secret = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
    return secret.length === 32 ? secret : null;
  }
  if (!create) return null;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const secret = randomBytes(32);
  try {
    // "wx": never clobber a secret another process created first.
    writeFileSync(path, secret.toString("base64"), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      return loadInstallSecret(false);
    throw error;
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    /* non-POSIX filesystem */
  }
  return secret;
}

function fileKey(secret: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, salt, "mithril-token", 32));
}

function sealWithFileKey(token: string): Record<string, string | number> {
  const secret = loadInstallSecret(true);
  if (!secret) throw new Error("Secure token storage is unavailable.");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fileKey(secret, salt), iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    version: 2,
    scheme: FILE_SCHEME,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

function openWithFileKey(record: Record<string, unknown>): string | null {
  const b64 = (key: string): Buffer | null =>
    typeof record[key] === "string"
      ? Buffer.from(record[key] as string, "base64")
      : null;
  const salt = b64("salt");
  const iv = b64("iv");
  const tag = b64("tag");
  const data = b64("data");
  if (record.scheme !== FILE_SCHEME || !salt || !iv || !tag || !data)
    return null;
  const secret = loadInstallSecret(false);
  if (!secret) return null;
  const decipher = createDecipheriv("aes-256-gcm", fileKey(secret, salt), iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return out.toString("utf8").trim() || null;
}

/**
 * How the stored token (or, when none is stored, the next one) is protected.
 * "reduced" means no system keyring was found.
 */
export function mithrilStorageProtection(
  profile?: string,
): MithrilStorageProtection {
  const path = tokenPath(profile);
  if (existsSync(path)) {
    try {
      const { version } = JSON.parse(readFileSync(path, "utf8")) as {
        version?: unknown;
      };
      if (version === 2) return "reduced";
      if (version === 1) return "keychain";
    } catch {
      /* fall through to the current machine's capability */
    }
  }
  return mithrilKeychainAvailable() ? "keychain" : "reduced";
}

export function readMithrilToken(profile?: string): string | null {
  const path = tokenPath(profile);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      version?: unknown;
      encryptedToken?: unknown;
    };
    if (data.version === 2) return openWithFileKey(data);
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
  if (!token) throw new Error("Secure token storage is unavailable.");
  const useKeychain = mithrilKeychainAvailable();
  if (!useKeychain && !installSecretUsable()) {
    throw new Error("Secure token storage is unavailable.");
  }
  const path = tokenPath(profile);
  const previous = existsSync(path) ? readFileSync(path, "utf8") : null;
  try {
    safeWriteFile(
      path,
      JSON.stringify(
        useKeychain
          ? {
              version: 1,
              encryptedToken: safeStorage
                .encryptString(token)
                .toString("base64"),
            }
          : sealWithFileKey(token),
      ),
    );
    try {
      chmodSync(path, 0o600);
    } catch {
      /* non-POSIX filesystem */
    }
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
