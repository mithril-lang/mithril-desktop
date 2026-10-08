import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { validMetadataProfile } from "@mithril/workspace/profile-resources";
export interface ProfileMetadataSource {
  profile: string;
  root: string;
  present: boolean;
}
function stat(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function safe(path: string): void {
  if (!isAbsolute(path)) throw Error("Invalid profile inventory storage");
  for (let current = resolve(path); ; current = dirname(current)) {
    if (stat(current)?.isSymbolicLink())
      throw Error("Unsafe profile inventory storage");
    if (dirname(current) === current) break;
  }
}
/** Original profile directory names plus retained account bindings; never reads .env or config. */
// @lat: [[cloud-workspace#All-profile metadata source inventory (draft)]]
export function profileMetadataInventory(
  home: string,
  bindings: string,
  owner: string,
  adopt: (profile: string) => void,
): { sources: ProfileMetadataSource[]; warnings: string[] } {
  safe(home);
  safe(bindings);
  const candidates = new Set<string>(["default"]);
  const warnings: string[] = [];
  const parent = join(home, "profiles");
  safe(parent);
  if (stat(parent)) {
    const entries = readdirSync(parent);
    if (entries.length > 10000)
      throw Error("Profile inventory exceeds supported capacity");
    for (const name of entries)
      if (name !== "default" && validMetadataProfile(name))
        candidates.add(name);
  }
  if (stat(bindings)) {
    const entries = readdirSync(bindings);
    if (entries.length > 30000)
      throw Error("Profile binding inventory exceeds supported capacity");
    for (const name of entries) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const path = join(bindings, name);
      safe(path);
      const info = stat(path);
      if (!info?.isFile() || info.size > 2048)
        throw Error("Invalid profile source binding");
      const value = JSON.parse(readFileSync(path, "utf8")) as {
        profile?: unknown;
        userId?: unknown;
      };
      if (
        !validMetadataProfile(value.profile) ||
        typeof value.userId !== "string" ||
        name !==
          createHash("sha256").update(value.profile).digest("hex") + ".json"
      )
        throw Error("Invalid profile source binding");
      if (value.userId === owner) candidates.add(value.profile);
    }
  }
  if (candidates.size > 10000)
    throw Error("Profile inventory exceeds supported capacity");
  const sources: ProfileMetadataSource[] = [];
  for (const profile of [...candidates].sort()) {
    const root = profile === "default" ? home : join(parent, profile);
    try {
      safe(root);
      const info = stat(root);
      if (info && !info.isDirectory())
        throw Error("Unsupported original profile directory");
      adopt(profile); // Existing binding refuses a different account before source bytes are read.
      sources.push({ profile, root, present: info !== null });
    } catch {
      warnings.push(
        `Profile ${profile} metadata source is unavailable or belongs to another account`,
      );
    }
  }
  return { sources, warnings };
}
