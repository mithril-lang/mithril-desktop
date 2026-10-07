import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  emptyRepository,
  validRepositoryState,
  type RepositoryState,
  type RepositoryStore,
} from "@mithril/workspace/repository-sync";
import {
  validWalletDescriptor,
  type WalletDescriptor,
  type WalletDescriptorSnapshot,
} from "@mithril/workspace/wallet-descriptors";
import { validRepositoryDocument } from "@mithril/workspace/repository";
export interface WalletSourceCheckpoint {
  source: WalletDescriptor;
  cloud: WalletDescriptorSnapshot | null;
}
function safe(path: string): void {
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw Error("Unsafe wallet replica path");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) break;
  }
}
/** Private durable public-data outbox; never stores native ciphertext or recovery phrases. */
export class WalletRepositoryStore implements RepositoryStore {
  private readonly path: string;
  private held = false;
  constructor(
    directory: string,
    readonly owner: string,
    readonly profile: string,
    private readonly guard: () => void,
  ) {
    if (
      !isAbsolute(directory) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(owner) ||
      !/^[a-z0-9_][a-z0-9_-]{0,63}$/.test(profile)
    )
      throw Error("Invalid wallet replica scope");
    safe(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    safe(directory);
    const directoryStat = lstatSync(directory);
    if (
      !directoryStat.isDirectory() ||
      (process.platform !== "win32" && directoryStat.mode & 0o077)
    )
      throw Error("Unsafe wallet replica directory");
    this.path = join(
      directory,
      createHash("sha256")
        .update(JSON.stringify([owner, profile]))
        .digest("hex") + ".sqlite",
    );
  }
  private database(path = this.path): Database.Database {
    safe(path);
    try {
      closeSync(openSync(path, "wx", 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    for (const file of [
      path,
      path + "-journal",
      path + "-wal",
      path + "-shm",
    ]) {
      safe(file);
      try {
        const stat = lstatSync(file);
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          (process.platform !== "win32" && stat.mode & 0o077)
        )
          throw Error("Unsafe wallet replica storage");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const db = new Database(path, { timeout: 0 });
    db.pragma("journal_mode = DELETE");
    db.pragma("synchronous = FULL");
    return db;
  }
  private assert(owner = this.owner): void {
    this.guard();
    if (!this.held || owner !== this.owner)
      throw Error("Wallet replica requires its owner lock");
  }
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    this.guard();
    if (this.held) throw Error("Wallet replica busy");
    const lock = this.database(this.path + ".lock.sqlite");
    try {
      lock.exec("BEGIN IMMEDIATE");
      this.held = true;
      const db = this.database();
      try {
        db.exec(
          "CREATE TABLE IF NOT EXISTS wallet_repository_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS wallet_source_checkpoints (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
        );
      } finally {
        db.close();
      }
      return await operation();
    } finally {
      this.held = false;
      lock.close();
    }
  }
  async read(owner: string): Promise<RepositoryState> {
    this.assert(owner);
    const db = this.database();
    try {
      const row = db
        .prepare("SELECT payload FROM wallet_repository_state WHERE id=1")
        .get() as { payload: string } | undefined;
      const state = row ? JSON.parse(row.payload) : emptyRepository();
      if (!validRepositoryState(state))
        throw Error("Invalid wallet repository state");
      return state;
    } finally {
      db.close();
    }
  }
  async update(
    owner: string,
    change: (state: RepositoryState) => RepositoryState,
  ): Promise<RepositoryState> {
    const state = change(await this.read(owner));
    this.assert(owner);
    if (!validRepositoryState(state))
      throw Error("Invalid wallet repository state");
    const payload = JSON.stringify(state);
    if (Buffer.byteLength(payload) > 32 * 1024 * 1024)
      throw Error("Wallet replica capacity exceeded");
    const db = this.database();
    try {
      db.prepare(
        "INSERT INTO wallet_repository_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      ).run(payload);
    } finally {
      db.close();
    }
    return state;
  }
  checkpoints(): WalletSourceCheckpoint[] {
    this.assert();
    const db = this.database();
    try {
      const rows = db
        .prepare(
          "SELECT payload FROM wallet_source_checkpoints ORDER BY id LIMIT 1001",
        )
        .all() as { payload: string }[];
      if (rows.length > 1000)
        throw Error("Wallet checkpoint capacity exceeded");
      return rows.map((row) => {
        const value = JSON.parse(row.payload) as WalletSourceCheckpoint;
        if (
          !validWalletDescriptor(value.source) ||
          value.source.profile !== this.profile ||
          (value.cloud !== null &&
            (!validRepositoryDocument(value.cloud.document) ||
              value.cloud.owner !== this.owner ||
              !validWalletDescriptor(value.cloud.descriptor) ||
              value.cloud.descriptor.profile !== this.profile ||
              value.cloud.descriptor.wallet.id !== value.source.wallet.id))
        )
          throw Error("Invalid wallet source checkpoint");
        return value;
      });
    } finally {
      db.close();
    }
  }
  checkpoint(value: WalletSourceCheckpoint): void {
    this.assert();
    if (
      !validWalletDescriptor(value.source) ||
      value.source.profile !== this.profile ||
      (value.cloud &&
        (value.cloud.owner !== this.owner ||
          !validWalletDescriptor(value.cloud.descriptor) ||
          value.cloud.descriptor.wallet.id !== value.source.wallet.id))
    )
      throw Error("Invalid wallet source checkpoint");
    const db = this.database();
    try {
      db.prepare(
        "INSERT INTO wallet_source_checkpoints VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      ).run(value.source.wallet.id, JSON.stringify(value));
    } finally {
      db.close();
    }
  }
}
