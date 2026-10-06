import { app } from "electron";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { setNativeHistoryCacheOwner } from "./native-history-cache";

const stores = new Map<string, { owner: string; db: Database.Database }>();
function checked(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error("Unsafe remote history storage");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
/** Cloud working copies do not require an installed/running native Agent. */
export function remoteHistoryStore(
  owner: string,
  profile: string,
): Database.Database {
  if (
    !owner ||
    typeof owner !== "string" ||
    owner.length > 128 ||
    !profile ||
    typeof profile !== "string" ||
    profile.length > 128
  )
    throw Error("Invalid remote history identity");
  const existing = stores.get(profile);
  if (existing?.owner === owner) return existing.db;
  if (existing) {
    existing.db.close();
    stores.delete(profile);
  }
  const directory = join(app.getPath("userData"), "workspace-history-cache");
  checked(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(
    directory,
    createHash("sha256")
      .update(JSON.stringify([owner, profile]))
      .digest("hex") + ".sqlite",
  );
  checked(path);
  if (existsSync(path) && !lstatSync(path).isFile())
    throw Error("Invalid remote history file");
  const db = new Database(path);
  try {
    chmodSync(path, 0o600);
    setNativeHistoryCacheOwner(db.name, owner);
    stores.set(profile, { owner, db });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function currentRemoteHistoryStore(
  profile: string,
): Database.Database | null {
  return stores.get(profile)?.db ?? null;
}
export function clearRemoteHistoryStores(): void {
  for (const { db } of stores.values()) db.close();
  stores.clear();
}
