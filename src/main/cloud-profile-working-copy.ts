import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { validMetadataProfile } from "@mithril/workspace/profile-resources";

function checked(path: string): void {
  if (!isAbsolute(path)) throw Error("Invalid profile working-copy storage");
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw Error("Unsafe profile working-copy storage");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) break;
  }
}
function durable(path: string, bytes: string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function flush(directory: string): void {
  if (process.platform === "win32") return;
  const fd = openSync(directory, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Only first-time remote profiles may create a working copy. Retained ownership
 * alone never recreates a deleted original directory. No runtime keys/config are cloned.
 */
// @lat: [[cloud-workspace#Cloud-only profile working copies (draft)]]
export function createCloudProfileWorkingCopy(
  scope: { home: string; directory: string; owner: string; profile: string },
  authority: { guard: () => void; hasBinding: () => boolean; bind: () => void },
): string | null {
  const { home, directory, owner, profile } = scope;
  if (
    !validMetadataProfile(profile) ||
    profile === "default" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(owner)
  )
    throw Error("Invalid cloud profile identity");
  checked(home);
  checked(directory);
  if (!lstatSync(home).isDirectory())
    throw Error("Original profile home unavailable");
  const parent = join(home, "profiles"),
    root = join(parent, profile);
  checked(parent);
  checked(root);
  authority.guard();
  const bound = authority.hasBinding(); // A foreign binding throws before any mutation.
  const key = createHash("sha256")
    .update(JSON.stringify([owner, profile, resolve(home)]))
    .digest("hex");
  const path = join(directory, key + ".json");
  checked(path);
  let pending = false;
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > 2048 ||
      (process.platform !== "win32" && stat.mode & 0o077)
    )
      throw Error("Unsafe profile creation intent");
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (
      record.owner !== owner ||
      record.profile !== profile ||
      record.root !== root ||
      !["creating", "ready"].includes(record.phase)
    )
      throw Error("Invalid profile creation intent");
    pending = record.phase === "creating";
  }
  const ready = (): void => {
    const temp = join(directory, `.${key}-${randomUUID()}`);
    try {
      durable(temp, JSON.stringify({ owner, profile, root, phase: "ready" }));
      renameSync(temp, path);
      flush(directory);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  };
  // Complete a creation interrupted after mkdir before allowing metadata replay.
  // This prevents a later deletion from being mistaken for the first creation.
  if (existsSync(root)) {
    if (pending && bound) {
      authority.guard();
      if (!lstatSync(root).isDirectory())
        throw Error("Unsafe profile working copy");
      ready();
    }
    return null;
  }
  if ((bound && !pending) || (existsSync(path) && !pending)) return null;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  checked(directory);
  if (!existsSync(path)) {
    durable(path, JSON.stringify({ owner, profile, root, phase: "creating" }));
    flush(directory);
  }
  authority.guard();
  authority.bind(); // Persist ownership before making the directory visible to inventory.
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  checked(parent);
  authority.guard();
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
  flush(parent);
  ready();
  return root;
}
