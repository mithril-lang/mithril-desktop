import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  profileMetadataValue,
  validProfileMetadataPointer,
} from "@mithril/workspace/profile-resources";
import {
  validReplicaRecord,
  type ReplicaRecord,
} from "@mithril/workspace/replica-sync";
import {
  readProfileMetadataFile,
  replaceProfileMetadataFile,
} from "./profile-meta-files";

interface Row {
  operation: string;
  fingerprint: string;
  before_bytes: Buffer | null;
  target_bytes: Buffer | null;
  record: string;
  state: "pending" | "complete";
}
function safe(path: string): void {
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) throw Error("Unsafe profile replica storage");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) break;
  }
}
const same = (a: Buffer | null, b: Buffer | null): boolean =>
  a === null ? b === null : b !== null && a.equals(b);

/** Main-only durable intent and receipt; no agent/Python runtime is required.
 * Each synchronous operation is serialized by SQLite before native file mutation.
 */
// @lat: [[cloud-workspace#Durable profile metadata restoration (draft)]]
export class ProfileMetadataReplica {
  private readonly path: string;
  private readonly root: string;
  private readonly profile: string;
  constructor(
    directory: string,
    scope: { owner: string; profile: string; root: string },
  ) {
    if (
      !isAbsolute(directory) ||
      !isAbsolute(scope.root) ||
      !scope.owner ||
      scope.owner.length > 128 ||
      !/^[a-z0-9_][a-z0-9_-]{0,63}$/.test(scope.profile)
    )
      throw Error("Invalid profile replica identity");
    this.root = resolve(scope.root);
    this.profile = scope.profile;
    safe(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    safe(directory);
    const key = createHash("sha256")
      .update(JSON.stringify([scope.owner, scope.profile, this.root]))
      .digest("hex");
    this.path = join(directory, key + ".sqlite");
  }
  private database(): Database.Database {
    safe(this.path);
    try {
      closeSync(openSync(this.path, "wx", 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    for (const path of [
      this.path,
      this.path + "-journal",
      this.path + "-wal",
      this.path + "-shm",
    ]) {
      safe(path);
      try {
        const stat = lstatSync(path);
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          (process.platform !== "win32" && stat.mode & 0o077)
        )
          throw Error("Unsafe profile replica storage");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const db = new Database(this.path, { timeout: 0 });
    try {
      db.pragma("journal_mode = DELETE");
      db.pragma("synchronous = FULL");
      db.exec(
        "CREATE TABLE IF NOT EXISTS profile_operations (operation TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, before_bytes BLOB, target_bytes BLOB, record TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','complete')))",
      );
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  private validateTarget(
    record: unknown,
    target: Buffer | null,
  ): asserts record is ReplicaRecord {
    if (
      !validReplicaRecord(record) ||
      record.collection !== "profile" ||
      record.id !== `profile-metadata-${this.profile}` ||
      record.deleted !== (target === null)
    )
      throw Error("Invalid retained profile receipt");
    if (target !== null) {
      profileMetadataValue(target);
      if (
        !validProfileMetadataPointer(record.body) ||
        record.body.profile !== this.profile ||
        record.body.size !== target.length ||
        record.body.digest !== createHash("sha256").update(target).digest("hex")
      )
        throw Error("Profile replica target differs from receipt");
    }
  }
  private finish(db: Database.Database, row: Row): ReplicaRecord {
    const record: unknown = JSON.parse(row.record);
    this.validateTarget(record, row.target_bytes);
    if (row.state === "complete") return record;
    const current = readProfileMetadataFile(this.root);
    if (!same(current, row.target_bytes)) {
      if (!same(current, row.before_bytes))
        throw Error("Profile metadata recovery conflict");
      replaceProfileMetadataFile(this.root, row.before_bytes, row.target_bytes);
    }
    db.prepare(
      "UPDATE profile_operations SET state='complete' WHERE operation=?",
    ).run(row.operation);
    return record;
  }
  /** Caller must revalidate captured workspace authorization immediately before this synchronous call. */
  apply(
    operation: string,
    fingerprint: string,
    before: Uint8Array | null,
    target: Uint8Array | null,
    record: ReplicaRecord,
  ): ReplicaRecord {
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(operation) ||
      !/^[a-f0-9]{64}$/.test(fingerprint) ||
      !validReplicaRecord(record)
    )
      throw Error("Invalid profile replica operation");
    const original = before === null ? null : Buffer.from(before);
    const next = target === null ? null : Buffer.from(target);
    if (original) profileMetadataValue(original);
    this.validateTarget(record, next);
    const db = this.database();
    try {
      // Intent is committed separately; interruption before or after file rename is recoverable.
      db.transaction(() => {
        const retained = db
          .prepare("SELECT * FROM profile_operations WHERE operation=?")
          .get(operation) as Row | undefined;
        if (retained) {
          if (
            retained.fingerprint !== fingerprint ||
            !same(retained.before_bytes, original) ||
            !same(retained.target_bytes, next) ||
            retained.record !== JSON.stringify(record)
          )
            throw Error("Profile replica operation reused");
          return;
        }
        if (
          db
            .prepare("SELECT 1 FROM profile_operations WHERE state='pending'")
            .get()
        )
          throw Error("Profile metadata recovery required");
        if (!same(readProfileMetadataFile(this.root), original))
          throw Error("Profile metadata changed before saving");
        db.prepare(
          "INSERT INTO profile_operations VALUES (?,?,?,?,?,'pending')",
        ).run(operation, fingerprint, original, next, JSON.stringify(record));
      }).immediate();
      return db
        .transaction(() =>
          this.finish(
            db,
            db
              .prepare("SELECT * FROM profile_operations WHERE operation=?")
              .get(operation) as Row,
          ),
        )
        .immediate();
    } finally {
      db.close();
    }
  }
  /** Read the retained result before re-capturing a potentially newer native file. */
  receipt(operation: string, fingerprint: string): ReplicaRecord | null {
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(operation) ||
      !/^[a-f0-9]{64}$/.test(fingerprint)
    )
      throw Error("Invalid profile replica operation");
    const db = this.database();
    try {
      const row = db
        .prepare("SELECT * FROM profile_operations WHERE operation=?")
        .get(operation) as Row | undefined;
      if (!row) return null;
      if (row.fingerprint !== fingerprint)
        throw Error("Profile replica operation reused");
      if (row.state !== "complete") return null;
      const record: unknown = JSON.parse(row.record);
      this.validateTarget(record, row.target_bytes);
      return record;
    } finally {
      db.close();
    }
  }
  /** Recover only under fresh authorization for this owner/profile, before publishing a native snapshot. */
  recover(): ReplicaRecord[] {
    const db = this.database();
    try {
      return db
        .transaction(() => {
          const rows = db
            .prepare(
              "SELECT * FROM profile_operations WHERE state='pending' ORDER BY rowid",
            )
            .all() as Row[];
          return rows.map((row) => this.finish(db, row));
        })
        .immediate();
    } finally {
      db.close();
    }
  }
}
