import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { profileHome } from "./utils";
import { parseMemoryLimitsConfig, type MemoryLimits } from "./memory-limits";
import { HERMES_PYTHON } from "./installer";
import { mutateMemoryFiles, type MemoryMutation } from "./memory-file-lock";

const ENTRY_DELIMITER = "\n§\n";

export interface MemoryEntry {
  index: number;
  content: string;
}

export interface MemoryInfo {
  memory: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    entries: MemoryEntry[];
    charCount: number;
    charLimit: number;
  };
  user: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    charCount: number;
    charLimit: number;
  };
  stats: { totalSessions: number; totalMessages: number };
}

function memoryPath(profile?: string): string {
  return join(profileHome(profile), "memories", "MEMORY.md");
}

function userPath(profile?: string): string {
  return join(profileHome(profile), "memories", "USER.md");
}

function configPath(profile?: string): string {
  return join(profileHome(profile), "config.yaml");
}

function readMemoryLimits(profile?: string): MemoryLimits {
  try {
    const filePath = configPath(profile);
    if (!existsSync(filePath)) return parseMemoryLimitsConfig("");
    return parseMemoryLimitsConfig(readFileSync(filePath, "utf-8"));
  } catch {
    return parseMemoryLimitsConfig("");
  }
}

function readFileSafe(filePath: string): {
  content: string;
  exists: boolean;
  lastModified: number | null;
} {
  if (!existsSync(filePath)) {
    return { content: "", exists: false, lastModified: null };
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    const stat = statSync(filePath);
    return {
      content,
      exists: true,
      lastModified: Math.floor(stat.mtimeMs / 1000),
    };
  } catch {
    return { content: "", exists: false, lastModified: null };
  }
}

function parseMemoryEntries(content: string): MemoryEntry[] {
  if (!content.trim()) return [];
  return content
    .split(ENTRY_DELIMITER)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((content, index) => ({ index, content }));
}

function getSessionStats(profile?: string): {
  totalSessions: number;
  totalMessages: number;
} {
  const home = profileHome(profile);
  const dbPath = join(home, "state.db");
  if (!existsSync(dbPath)) return { totalSessions: 0, totalMessages: 0 };

  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const sessionRow = db
        .prepare("SELECT COUNT(*) as count FROM sessions")
        .get() as { count: number } | undefined;
      const messageRow = db
        .prepare("SELECT COUNT(*) as count FROM messages")
        .get() as { count: number } | undefined;
      return {
        totalSessions: sessionRow?.count ?? 0,
        totalMessages: messageRow?.count ?? 0,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    console.error("[memory] getSessionStats failed:", err);
    return { totalSessions: 0, totalMessages: 0 };
  }
}

// ── Read ────────────────────────────────────────────

export function readMemory(profile?: string): MemoryInfo {
  const memFile = readFileSafe(memoryPath(profile));
  const userFile = readFileSafe(userPath(profile));
  const limits = readMemoryLimits(profile);

  return {
    memory: {
      ...memFile,
      entries: parseMemoryEntries(memFile.content),
      charCount: memFile.content.length,
      charLimit: limits.memoryCharLimit,
    },
    user: {
      ...userFile,
      charCount: userFile.content.length,
      charLimit: limits.userCharLimit,
    },
    stats: getSessionStats(profile),
  };
}

/** Raw MEMORY.md content (empty string when missing) — for whole-file sync. */
export function readMemoryRaw(profile?: string): string {
  return readFileSafe(memoryPath(profile)).content;
}

/**
 * Replace MEMORY.md wholesale. Used by cloud agent sync when the remote copy
 * wins — the content is the user's own cloud copy, so no entry parsing or
 * char-limit gate applies (safeWriteFile creates `memories/` when missing).
 */
function mutate(
  content: MemoryMutation,
  profile?: string,
  expected?: { memory: string; user: string },
): { success: boolean; error?: string } {
  let config = "";
  try {
    config = readFileSync(configPath(profile), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      return { success: false, error: "Memory configuration unavailable" };
  }
  return mutateMemoryFiles({
    configDigest: createHash("sha256").update(config).digest("hex"),
    home: profileHome(profile),
    python: HERMES_PYTHON,
    limits: parseMemoryLimitsConfig(config),
    mutation: content,
    ...(expected ? { expected } : {}),
  });
}

export function writeMemoryRaw(
  content: string,
  profile?: string,
): { success: boolean; error?: string } {
  return mutate({ action: "raw", content }, profile);
}
export function addMemoryEntry(
  content: string,
  profile?: string,
): { success: boolean; error?: string } {
  return mutate({ action: "add", content }, profile);
}
export function updateMemoryEntry(
  index: number,
  content: string,
  profile?: string,
  expected?: { memory: string; user: string },
): { success: boolean; error?: string } {
  if (!expected)
    return { success: false, error: "Refresh Memory before editing" };
  return mutate({ action: "update", index, content }, profile, expected);
}
export function removeMemoryEntry(
  index: number,
  profile?: string,
  expected?: { memory: string; user: string },
): boolean {
  if (!expected) return false;
  return mutate({ action: "remove", index }, profile, expected).success;
}
export function writeUserProfile(
  content: string,
  profile?: string,
  expected?: { memory: string; user: string },
): { success: boolean; error?: string } {
  if (!expected)
    return { success: false, error: "Refresh Memory before editing" };
  return mutate({ action: "user", content }, profile, expected);
}
/** Under-lock compare prevents concurrent Hermes writes from being overwritten. */
export function applyMemoryMutation(
  mutation: MemoryMutation,
  expected: { memory: string; user: string },
  profile?: string,
): { success: boolean; error?: string } {
  return mutate(mutation, profile, expected);
}
