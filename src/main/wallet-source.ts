import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { validPublicWallet } from "@mithril/workspace/wallet-descriptors";
import type { ProfileWallet } from "@mithril/workspace/desktop-wallet-types";

/** Capture one validated original file; malformed or replaced sources never imply deletion. */
export function captureWalletSource(
  path: string,
  guard: () => void,
): ProfileWallet[] {
  guard();
  let before;
  try {
    before = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > 1024 * 1024
  )
    throw Error("Unsupported wallet source");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size !== before.size
    )
      throw Error("Wallet source changed during capture");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    guard();
    const current = lstatSync(path);
    if (
      bytes.length > 1024 * 1024 ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      current.ino !== opened.ino ||
      current.dev !== opened.dev ||
      current.isSymbolicLink()
    )
      throw Error("Wallet source changed during capture");
    const value = JSON.parse(bytes.toString("utf8"));
    if (
      !value ||
      value.version !== 1 ||
      !Array.isArray(value.wallets) ||
      value.wallets.length > 100
    )
      throw Error("Invalid wallet source; original data retained");
    const ids = new Set<string>();
    return value.wallets.map((item: Record<string, unknown>) => {
      if (!item || typeof item.encryptedRecoveryPhrase !== "string")
        throw Error("Invalid wallet source; original data retained");
      const { encryptedRecoveryPhrase: _private, ...publicFields } = item;
      if (!validPublicWallet(publicFields) || ids.has(publicFields.id))
        throw Error("Invalid wallet source; original data retained");
      ids.add(publicFields.id);
      return publicFields;
    });
  } finally {
    closeSync(fd);
  }
}
