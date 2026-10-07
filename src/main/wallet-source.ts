import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
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
      current.size !== opened.size ||
      current.mtimeMs !== opened.mtimeMs ||
      current.ctimeMs !== opened.ctimeMs ||
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

/** Cloud presentation edits never replace signing identity or encrypted native custody. */
export function restoreWalletSource(
  path: string,
  before: ProfileWallet,
  after: ProfileWallet,
  guard: () => void,
): void {
  if (
    !validPublicWallet(before) ||
    !validPublicWallet(after) ||
    before.id !== after.id ||
    before.address !== after.address ||
    before.network !== after.network ||
    before.createdAt !== after.createdAt ||
    before.imported !== after.imported
  )
    throw Error("Cloud wallet edit cannot replace native identity");
  const same = (a: ProfileWallet, b: ProfileWallet): boolean =>
    a.id === b.id &&
    a.name === b.name &&
    a.address === b.address &&
    a.network === b.network &&
    a.createdAt === b.createdAt &&
    a.imported === b.imported;
  const wallets = captureWalletSource(path, guard);
  if (!wallets.some((wallet) => same(wallet, before)))
    throw Error("Wallet source conflict");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  let original;
  try {
    original = fstatSync(fd);
    bytes = readFileSync(fd);
    if (bytes.length > 1024 * 1024) throw Error("Unsupported wallet source");
  } finally {
    closeSync(fd);
  }
  const value = JSON.parse(bytes.toString("utf8"));
  const item = value.wallets.find((row: ProfileWallet) => row.id === before.id);
  if (!item) throw Error("Wallet source conflict");
  const { encryptedRecoveryPhrase: _private, ...publicFields } = item;
  if (!validPublicWallet(publicFields) || !same(publicFields, before))
    throw Error("Wallet source conflict");
  // Preserve every other record and this exact ciphertext. Name is the only editable cloud field.
  item.name = after.name;
  const temp = join(dirname(path), `.wallet-sync-${randomUUID()}.tmp`);
  let written = false;
  try {
    const target = openSync(temp, "wx", 0o600);
    written = true;
    try {
      writeFileSync(target, JSON.stringify(value, null, 2));
      fsyncSync(target);
    } finally {
      closeSync(target);
    }
    guard();
    const current = lstatSync(path);
    if (
      current.isSymbolicLink() ||
      current.ino !== original.ino ||
      current.dev !== original.dev ||
      current.size !== original.size ||
      current.mtimeMs !== original.mtimeMs ||
      current.ctimeMs !== original.ctimeMs
    )
      throw Error("Wallet source conflict");
    const check = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      if (!readFileSync(check).equals(bytes))
        throw Error("Wallet source conflict");
    } finally {
      closeSync(check);
    }
    guard();
    const final = lstatSync(path);
    if (
      final.isSymbolicLink() ||
      final.ino !== original.ino ||
      final.dev !== original.dev ||
      final.size !== original.size ||
      final.mtimeMs !== original.mtimeMs ||
      final.ctimeMs !== original.ctimeMs
    )
      throw Error("Wallet source conflict");
    renameSync(temp, path);
    written = false;
  } finally {
    if (written) unlinkSync(temp);
  }
}
