// @lat: [[mithril-migration#Mithril desktop migration#Token-only-in-secure-store]]
/**
 * The Mithril token lives only in the OS keychain / encrypted fallback file
 * ([[src/main/mithril-token-store.ts]]). It is handed to the agent in memory
 * through the secure-env overlay and is never written to a `.env` file.
 * This module also migrates a `MITHRIL_API_KEY=` line left in `.env` by
 * earlier previews into the secure store and removes only that line.
 */
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { invalidateSecretsCache } from "./config";
import { HERMES_HOME } from "./installer";
import { mirrorFirstPartyAgentProviders } from "./agent-config-providers";
import { registerSecureEnvSource } from "./secure-env";
import { profilePaths } from "./utils";
import { readMithrilToken, writeMithrilToken } from "./mithril-token-store";

export const MITHRIL_API_KEY_ENV = "MITHRIL_API_KEY";

/** Overlay the stored token onto the agent's environment, in memory only. */
export function registerMithrilSecureEnv(): void {
  registerSecureEnvSource((profile): Record<string, string> => {
    const token = readMithrilToken(profile);
    return token?.startsWith("mf_") ? { [MITHRIL_API_KEY_ENV]: token } : {};
  });
}

/**
 * After a successful connect: declare the named `providers: mithril` entry in
 * config.yaml (URL + env-var *name* only, no secret) and drop cached env views.
 */
export function onMithrilConnected(profile: string | undefined): void {
  invalidateSecretsCache();
  mirrorFirstPartyAgentProviders(profile);
}

export function onMithrilDisconnected(): void {
  invalidateSecretsCache();
}

const ACTIVE_LINE = /^\s*(?:export\s+)?MITHRIL_API_KEY\s*=(.*)$/;

function unquote(raw: string): string {
  const v = raw.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'")))
  )
    return v.slice(1, -1).trim();
  return v;
}

/** Rewrite `file` with `content`, keeping its permission bits. */
function rewritePreservingMode(file: string, content: string): void {
  const mode = statSync(file).mode & 0o777;
  const temp = join(
    dirname(file),
    `.${basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeFileSync(temp, content, { encoding: "utf-8", mode });
    try {
      chmodSync(temp, mode);
    } catch {
      /* non-POSIX filesystem */
    }
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      /* already gone */
    }
    throw error;
  }
}

export type MithrilEnvMigration =
  | "none" // no MITHRIL_API_KEY line in .env
  | "migrated" // token moved into the secure store, line removed
  | "already-stored" // store already had a token; stale line removed
  | "cleared-empty" // empty/blank line removed
  | "skipped-not-mithril" // value is not an mf_ token; left untouched
  | "failed"; // could not store it; .env left untouched so nothing is lost

/**
 * One profile: move an `.env` MITHRIL_API_KEY into the secure store if none is
 * stored yet, then remove only that line. Other lines, comments and line
 * endings are preserved; the file is deleted only if nothing else remains;
 * its mode is kept. The line is never removed unless the value is safe.
 */
export function migrateMithrilEnvKey(profile?: string): MithrilEnvMigration {
  const { envFile } = profilePaths(profile);
  if (!existsSync(envFile)) return "none";
  const content = readFileSync(envFile, "utf-8");
  const lines = content.split(/(?<=\n)/);
  let value: string | null = null;
  const kept: string[] = [];
  for (const line of lines) {
    const match = ACTIVE_LINE.exec(line.replace(/\r?\n$/, ""));
    if (match) value = unquote(match[1]);
    else kept.push(line);
  }
  if (value === null) return "none";

  let result: MithrilEnvMigration;
  if (value === "") {
    result = "cleared-empty";
  } else if (!value.startsWith("mf_")) {
    return "skipped-not-mithril";
  } else if (readMithrilToken(profile) !== null) {
    result = "already-stored";
  } else {
    try {
      writeMithrilToken(profile, value);
    } catch {
      return "failed";
    }
    result = "migrated";
  }

  const rest = kept.join("");
  if (rest.trim() === "") unlinkSync(envFile);
  else rewritePreservingMode(envFile, rest);
  invalidateSecretsCache();
  return result;
}

/** Startup: migrate the default profile and every named profile. */
export function migrateAllMithrilEnvKeys(): Record<
  string,
  MithrilEnvMigration
> {
  const out: Record<string, MithrilEnvMigration> = {};
  const profiles: (string | undefined)[] = [undefined];
  try {
    const dir = join(HERMES_HOME, "profiles");
    for (const entry of readdirSync(dir, { withFileTypes: true }))
      if (entry.isDirectory()) profiles.push(entry.name);
  } catch {
    /* no named profiles */
  }
  for (const profile of profiles) {
    try {
      const result = migrateMithrilEnvKey(profile);
      if (result !== "none") out[profile ?? "default"] = result;
    } catch (error) {
      console.error(
        `[mithril] .env migration failed for ${profile ?? "default"}:`,
        error instanceof Error ? error.message : "unknown error",
      );
      out[profile ?? "default"] = "failed";
    }
  }
  return out;
}
