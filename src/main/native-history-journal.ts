import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { NativeHistoryJournal } from "./native-history-sync";

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
function checked(path: string): void {
  for (let current = resolve(path); ; ) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error("Unsafe history journal storage");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
function paths(
  root: string,
  owner: string,
  profile: string,
): { legacy: string; entries: string } {
  checked(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const name = digest(JSON.stringify([owner, profile]));
  const legacy = join(root, name + ".json"),
    entries = join(root, name + ".entries");
  checked(legacy);
  checked(entries);
  return { legacy, entries };
}
function readJson(path: string): unknown {
  checked(path);
  if (!lstatSync(path).isFile() || lstatSync(path).size > 64 * 1024 * 1024)
    throw Error(
      "History journal entry exceeds supported bound; source retained",
    );
  return JSON.parse(readFileSync(path, "utf8"));
}
/** Retained legacy journal is overlaid by newer durable, owner/profile-scoped entries. */
export function readNativeHistoryJournal(
  root: string,
  owner: string,
  profile: string,
): NativeHistoryJournal {
  const pathsForOwner = paths(root, owner, profile);
  const state = existsSync(pathsForOwner.legacy)
    ? (readJson(pathsForOwner.legacy) as NativeHistoryJournal)
    : { entries: {} };
  if (
    !state ||
    typeof state !== "object" ||
    !state.entries ||
    typeof state.entries !== "object" ||
    Array.isArray(state.entries)
  )
    throw Error("Invalid retained history journal");
  if (existsSync(pathsForOwner.entries)) {
    if (!lstatSync(pathsForOwner.entries).isDirectory())
      throw Error("Invalid history journal directory");
    for (const name of readdirSync(pathsForOwner.entries)) {
      if (!name.endsWith(".json")) continue; // Interrupted private temporary writes are never admitted.
      const row = readJson(join(pathsForOwner.entries, name)) as {
        schemaVersion: number;
        owner: string;
        profile: string;
        sessionId: string;
        entry: NativeHistoryJournal["entries"][string];
      };
      if (
        !row ||
        row.schemaVersion !== 1 ||
        row.owner !== owner ||
        row.profile !== profile ||
        typeof row.sessionId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(row.sessionId) ||
        name !== digest(row.sessionId) + ".json" ||
        !row.entry ||
        typeof row.entry !== "object" ||
        Array.isArray(row.entry)
      )
        throw Error("Invalid history journal entry owner");
      Object.defineProperty(state.entries, row.sessionId, {
        value: row.entry,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return state;
}
/** Fsync before replacement and parent-directory fsync before acknowledging persistence. */
export function writeNativeHistoryEntry(
  root: string,
  owner: string,
  profile: string,
  sessionId: string,
  entry: NativeHistoryJournal["entries"][string],
): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId))
    throw Error("Invalid history journal session");
  const { entries } = paths(root, owner, profile);
  mkdirSync(entries, { recursive: true, mode: 0o700 });
  const file = join(entries, digest(sessionId) + ".json"),
    temp = file + "." + randomUUID() + ".tmp";
  checked(file);
  const value = JSON.stringify({
    schemaVersion: 1,
    owner,
    profile,
    sessionId,
    entry,
  });
  if (Buffer.byteLength(value) > 64 * 1024 * 1024)
    throw Error(
      "History journal entry exceeds supported bound; source retained",
    );
  try {
    writeFileSync(temp, value, { flag: "wx", mode: 0o600 });
    const fd = openSync(temp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
    if (process.platform !== "win32") {
      for (const path of [entries, root, dirname(root)]) {
        const directory = openSync(path, "r");
        try {
          fsyncSync(directory);
        } finally {
          closeSync(directory);
        }
      }
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
