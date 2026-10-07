import {
  emptyRepository,
  validRepositoryState,
  type RepositoryState,
} from "@mithril/workspace/repository-sync";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { closeSync, lstatSync, mkdirSync, openSync, type Stats } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import type { OriginalScheduleBoundTargets } from "./original-schedule-native-port";
import { validateOriginalScheduleText } from "@mithril/workspace/original-schedule-text";
import type {
  OriginalScheduleNativeWrite,
  OriginalScheduleReplicaJournal,
  OriginalScheduleReplicaScope,
  OriginalScheduleReplicaStore,
} from "@mithril/workspace/original-schedule-file-replica";

export interface OriginalSchedulePrivateDirectoryTarget {
  root: string;
  expectedManifest: string;
}

function validDirectoryTarget(
  value: unknown,
): value is OriginalSchedulePrivateDirectoryTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as OriginalSchedulePrivateDirectoryTarget;
  return (
    Object.keys(value).sort().join(",") === "expectedManifest,root" &&
    typeof target.root === "string" &&
    target.root.length <= 32768 &&
    isAbsolute(target.root) &&
    !target.root.includes("\0") &&
    typeof target.expectedManifest === "string" &&
    /^[a-f0-9]{64}$/.test(target.expectedManifest)
  );
}

function statIfPresent(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function checkPath(path: string): void {
  for (let current = resolve(path); ; current = dirname(current)) {
    if (statIfPresent(current)?.isSymbolicLink())
      throw Error("Unsafe schedule replica storage");
    if (dirname(current) === current) break;
  }
}
function privateFile(path: string): void {
  checkPath(path);
  try {
    closeSync(openSync(path, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  for (const file of [path, path + "-journal", path + "-wal", path + "-shm"]) {
    checkPath(file);
    const stat = statIfPresent(file);
    if (!stat) continue;
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    )
      throw Error("Unsafe schedule replica storage");
  }
}

/** Main-only pending portable source journal. A separate SQLite reserved lock survives
 * windows/processes without retaining a transaction over the durable journal writes.
 * Process termination releases the OS lock, while pending operations remain committed.
 */
export class NativeOriginalScheduleReplicaStore
  implements OriginalScheduleReplicaStore, OriginalScheduleBoundTargets
{
  private readonly scope: OriginalScheduleReplicaScope;
  private readonly journalPath: string;
  private readonly lockPath: string;
  private held = false;
  constructor(directory: string, scope: OriginalScheduleReplicaScope) {
    if (
      !scope ||
      [scope.owner, scope.profile, scope.timeZone].some(
        (value) => typeof value !== "string" || !value || value.length > 128,
      )
    )
      throw Error("Invalid schedule replica identity");
    this.scope = Object.freeze({ ...scope });
    const root = resolve(directory);
    checkPath(root);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(root);
    if (
      !stat.isDirectory() ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    )
      throw Error("Unsafe schedule replica storage");
    const key = createHash("sha256")
      .update(JSON.stringify([scope.owner, scope.profile, scope.timeZone]))
      .digest("hex");
    this.journalPath = join(root, key + ".sqlite");
    this.lockPath = join(root, key + ".lock.sqlite");
  }
  private assertScope(scope: OriginalScheduleReplicaScope): void {
    if (
      !scope ||
      scope.owner !== this.scope.owner ||
      scope.profile !== this.scope.profile ||
      scope.timeZone !== this.scope.timeZone
    )
      throw Error("Schedule replica identity changed");
  }
  private journal(): Database.Database {
    if (!this.held) throw Error("Schedule replica lock required");
    privateFile(this.journalPath);
    const db = new Database(this.journalPath, { timeout: 0 });
    try {
      db.pragma("journal_mode = DELETE");
      db.pragma("synchronous = FULL");
      db.exec(
        "CREATE TABLE IF NOT EXISTS schedule_replica_journal (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)",
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS schedule_bound_targets (operation_id TEXT PRIMARY KEY, request TEXT NOT NULL, source TEXT NOT NULL, digest TEXT NOT NULL)",
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS schedule_directory_targets (operation_id TEXT NOT NULL, slot TEXT NOT NULL, request TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(operation_id,slot))",
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS schedule_repository_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)",
      );
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  async exclusive<T>(
    scope: OriginalScheduleReplicaScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.assertScope(scope);
    if (this.held) throw Error("Schedule replica busy");
    privateFile(this.lockPath);
    const lock = new Database(this.lockPath, { timeout: 0 });
    try {
      try {
        lock.exec("BEGIN IMMEDIATE");
      } catch (error) {
        if ((error as { code?: string }).code === "SQLITE_BUSY")
          throw Error("Schedule replica busy");
        throw error;
      }
      this.held = true;
      return await operation();
    } finally {
      this.held = false;
      try {
        if (lock.inTransaction) lock.exec("ROLLBACK");
      } finally {
        lock.close();
      }
    }
  }
  async retain(
    write: OriginalScheduleNativeWrite,
    bind: () => Promise<string>,
  ): Promise<string> {
    this.assertScope(write);
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(write.operationId))
      throw Error("Invalid schedule binding operation");
    validateOriginalScheduleText(
      write.sourceText,
      write.profile,
      write.timeZone,
    );
    const request = JSON.stringify([
      write.owner,
      write.profile,
      write.timeZone,
      write.operationId,
      write.expectedVersion,
      write.sourceText,
    ]);
    const db = this.journal();
    try {
      const row = db
        .prepare(
          "SELECT request, source, digest FROM schedule_bound_targets WHERE operation_id=?",
        )
        .get(write.operationId) as
        | { request: string; source: string; digest: string }
        | undefined;
      if (row) {
        if (
          row.request !== request ||
          createHash("sha256").update(row.source).digest("hex") !== row.digest
        )
          throw Error("Schedule binding operation conflict");
        validateOriginalScheduleText(row.source, write.profile, write.timeZone);
        return row.source;
      }
      const source = await bind();
      this.assertScope(write);
      if (!this.held) throw Error("Schedule replica lock required");
      validateOriginalScheduleText(source, write.profile, write.timeZone);
      const digest = createHash("sha256").update(source).digest("hex");
      // The coordinator's cross-process lock covers binding and this durable commit.
      db.prepare("INSERT INTO schedule_bound_targets VALUES(?,?,?,?)").run(
        write.operationId,
        request,
        source,
        digest,
      );
      return source;
    } finally {
      db.close();
    }
  }
  /** Commit path and immutable baseline before resource restoration. A retry must not
   * capture today's local files as yesterday's baseline or choose another destination. */
  async retainDirectoryTarget(
    write: OriginalScheduleNativeWrite,
    slot: { kind: "scripts" | "workdir"; jobId: string | null },
    manifest: string,
    bind: () => Promise<OriginalSchedulePrivateDirectoryTarget>,
  ): Promise<OriginalSchedulePrivateDirectoryTarget> {
    this.assertScope(write);
    if (
      !/^[A-Za-z0-9_-]{1,160}$/.test(write.operationId) ||
      !/^[a-f0-9]{64}$/.test(manifest) ||
      !slot ||
      (slot.kind !== "scripts" && slot.kind !== "workdir") ||
      (slot.kind === "scripts"
        ? slot.jobId !== null
        : typeof slot.jobId !== "string" ||
          !slot.jobId ||
          slot.jobId.length > 512)
    )
      throw Error("Invalid schedule directory binding");
    validateOriginalScheduleText(
      write.sourceText,
      write.profile,
      write.timeZone,
    );
    const key = JSON.stringify([slot.kind, slot.jobId]);
    const request = createHash("sha256")
      .update(
        JSON.stringify([
          write.owner,
          write.profile,
          write.timeZone,
          write.operationId,
          write.expectedVersion,
          write.sourceText,
          manifest,
        ]),
      )
      .digest("hex");
    const db = this.journal();
    try {
      const row = db
        .prepare(
          "SELECT request,payload,digest FROM schedule_directory_targets WHERE operation_id=? AND slot=?",
        )
        .get(write.operationId, key) as
        | { request: string; payload: string; digest: string }
        | undefined;
      if (row) {
        if (
          row.request !== request ||
          createHash("sha256").update(row.payload).digest("hex") !== row.digest
        )
          throw Error("Schedule directory binding operation conflict");
        const target: unknown = JSON.parse(row.payload);
        if (!validDirectoryTarget(target))
          throw Error("Invalid retained schedule directory target");
        checkPath(target.root);
        return target;
      }
      const target = await bind();
      this.assertScope(write);
      if (!this.held) throw Error("Schedule replica lock required");
      if (!validDirectoryTarget(target))
        throw Error("Invalid schedule directory target");
      checkPath(target.root);
      const payload = JSON.stringify(target);
      const digest = createHash("sha256").update(payload).digest("hex");
      db.prepare(
        "INSERT INTO schedule_directory_targets VALUES(?,?,?,?,?)",
      ).run(write.operationId, key, request, payload, digest);
      return JSON.parse(payload) as OriginalSchedulePrivateDirectoryTarget;
    } finally {
      db.close();
    }
  }
  /** The source manifest outbox shares this profile's durable cross-process lock. */
  async readRepository(
    scope: OriginalScheduleReplicaScope,
  ): Promise<RepositoryState> {
    this.assertScope(scope);
    const db = this.journal();
    try {
      const row = db
        .prepare("SELECT payload FROM schedule_repository_state WHERE id=1")
        .get() as { payload: string } | undefined;
      const state: unknown = row ? JSON.parse(row.payload) : emptyRepository();
      if (!validRepositoryState(state))
        throw Error("Invalid schedule repository state");
      return structuredClone(state);
    } finally {
      db.close();
    }
  }
  async updateRepository(
    scope: OriginalScheduleReplicaScope,
    change: (state: RepositoryState) => RepositoryState,
  ): Promise<RepositoryState> {
    this.assertScope(scope);
    const before = await this.readRepository(scope);
    const next = change(before);
    if (!validRepositoryState(next))
      throw Error("Invalid schedule repository state");
    const payload = JSON.stringify(next);
    if (Buffer.byteLength(payload) > 128 * 1024 * 1024)
      throw Error("Schedule repository state too large");
    const db = this.journal();
    try {
      db.prepare(
        "INSERT INTO schedule_repository_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      ).run(payload);
      return structuredClone(next);
    } finally {
      db.close();
    }
  }
  async read(
    scope: OriginalScheduleReplicaScope,
  ): Promise<OriginalScheduleReplicaJournal | null> {
    this.assertScope(scope);
    const db = this.journal();
    try {
      const row = db
        .prepare("SELECT payload FROM schedule_replica_journal WHERE id=1")
        .get() as { payload: string } | undefined;
      if (!row) return null;
      let state: OriginalScheduleReplicaJournal;
      try {
        state = JSON.parse(row.payload) as OriginalScheduleReplicaJournal;
      } catch {
        throw Error("Invalid schedule replica journal");
      }
      this.assertScope(state);
      return state;
    } finally {
      db.close();
    }
  }
  async write(state: OriginalScheduleReplicaJournal): Promise<void> {
    this.assertScope(state);
    const payload = JSON.stringify(state);
    if (Buffer.byteLength(payload) > 128 * 1024 * 1024)
      throw Error("Schedule replica journal too large");
    const db = this.journal();
    try {
      db.prepare(
        "INSERT INTO schedule_replica_journal VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      ).run(payload);
    } finally {
      db.close();
    }
  }
}
