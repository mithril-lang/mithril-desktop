import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  MAX_PROFILE_META_BYTES,
  patchProfileMetadataBytes,
  profileMetadataValue,
} from "@mithril/workspace/profile-resources";

function checked(path: string): void {
  if (!isAbsolute(path)) throw Error("Invalid profile metadata directory");
  let current = resolve(path);
  for (;;) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw Error("Unsafe profile metadata storage");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
/** Exact bytes; unsupported files are never converted into an empty metadata record. */
// @lat: [[cloud-workspace#Original profile metadata file preservation (draft)]]
export function readProfileMetadataFile(root: string): Buffer | null {
  checked(root);
  const path = join(root, "profile-meta.json");
  checked(path);
  if (!existsSync(path)) return null;
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > MAX_PROFILE_META_BYTES)
      throw Error("Unsupported profile metadata; original file retained");
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(fd);
    if (
      size !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      throw Error("Profile metadata changed while reading");
    const bytes = buffer.subarray(0, size);
    profileMetadataValue(bytes);
    return bytes;
  } finally {
    closeSync(fd);
  }
}
/** Synchronous read/patch/replace keeps all main-process appearance writers in one lane.
 * Existing unknown source tokens survive; fsync and rename leave an intact old or new file.
 */
// @lat: [[cloud-workspace#Original profile metadata file preservation (draft)]]
export function patchProfileMetadataFile(
  root: string,
  patch: Partial<Record<"name" | "color" | "avatar", string | undefined>>,
): void {
  const before = readProfileMetadataFile(root);
  const next = patchProfileMetadataBytes(before ?? Buffer.from("{}"), patch);
  replaceProfileMetadataFile(root, before, next);
}

/** Compare exact captured bytes after download, before any native mutation.
 * Null is absence, not an empty JSON object. Conflicts retain the newer file.
 */
// @lat: [[cloud-workspace#Original profile metadata compare and swap (draft)]]
export function replaceProfileMetadataFile(
  root: string,
  expected: Uint8Array | null,
  target: Uint8Array | null,
): void {
  // Snapshot caller-owned buffers before validating or touching the filesystem.
  const before = expected === null ? null : Buffer.from(expected);
  const next = target === null ? null : Buffer.from(target);
  if (next !== null) profileMetadataValue(next);
  const matches = (current: Buffer | null): boolean =>
    before === null
      ? current === null
      : current !== null && before.equals(current);
  checked(root);
  if (!matches(readProfileMetadataFile(root)))
    throw Error("Profile metadata changed before saving");
  if (next === null && before === null) return;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  checked(root);
  const path = join(root, "profile-meta.json"),
    temp = join(root, `.mithril-profile-meta-${randomUUID()}`);
  try {
    if (next !== null) {
      const fd = openSync(
        temp,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        writeFileSync(fd, next);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    if (!matches(readProfileMetadataFile(root)))
      throw Error("Profile metadata changed before saving");
    checked(root);
    checked(path);
    if (next === null) unlinkSync(path);
    else renameSync(temp, path);
    if (process.platform !== "win32") {
      const directory = openSync(
        root,
        constants.O_RDONLY |
          (constants.O_DIRECTORY ?? 0) |
          (constants.O_NOFOLLOW ?? 0),
      );
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
