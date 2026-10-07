import {
  emptyRepository,
  validRepositoryState,
  type RepositoryState,
} from "@mithril/workspace/repository-sync";
import Database from "better-sqlite3";
import { createHash, randomBytes } from "crypto";
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

import {
  validOriginalManualBinding,
  validOriginalManualJournalEntry,
  originalManualNativeRequest,
  originalManualWireRequest,
  type OriginalManualBinding,
  type OriginalManualJournalEntry,
} from "./original-schedule-manual-journal";
import {
  parseOriginalCronRunResult,
  type OriginalCronRunResult,
} from "./cron-source-run";
import {
  validOriginalManualResult,
  type OriginalManualReceipt,
} from "./original-schedule-manual";

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
      db.exec(
        "CREATE TABLE IF NOT EXISTS schedule_workdir_identities (root TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE)",
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS schedule_manual_journal (operation_id TEXT PRIMARY KEY, payload TEXT NOT NULL, digest TEXT NOT NULL)",
      );
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  /** Opaque folder identity is independent of bytes and remains private-path bound.
   * The existing owner/profile lock fences capture and restore across processes. */
  workdirIdentity(root: string, identity?: string): string {
    if (
      !isAbsolute(root) ||
      root.includes("\0") ||
      root.length > 32768 ||
      (identity !== undefined && !/^[a-f0-9]{64}$/.test(identity))
    )
      throw Error("Invalid original workdir identity");
    root = resolve(root);
    checkPath(root);
    const db = this.journal();
    try {
      const current = db
        .prepare(
          "SELECT identity FROM schedule_workdir_identities WHERE root=?",
        )
        .get(root) as { identity: string } | undefined;
      const byIdentity =
        identity === undefined
          ? undefined
          : (db
              .prepare(
                "SELECT root FROM schedule_workdir_identities WHERE identity=?",
              )
              .get(identity) as { root: string } | undefined);
      if (
        (current && !/^[a-f0-9]{64}$/.test(current.identity)) ||
        (identity !== undefined && current && current.identity !== identity) ||
        (byIdentity && byIdentity.root !== root)
      )
        throw Error("Original workdir identity conflict");
      if (current) return current.identity;
      const value = identity ?? randomBytes(32).toString("hex");
      db.prepare(
        "INSERT INTO schedule_workdir_identities(root,identity) VALUES(?,?)",
      ).run(root, value);
      return value;
    } finally {
      db.close();
    }
  }
  workdirRoot(identity: string): string | null {
    if (!/^[a-f0-9]{64}$/.test(identity))
      throw Error("Invalid original workdir identity");
    const db = this.journal();
    try {
      const row = db
        .prepare(
          "SELECT root FROM schedule_workdir_identities WHERE identity=?",
        )
        .get(identity) as { root: string } | undefined;
      if (!row) return null;
      if (
        typeof row.root !== "string" ||
        !isAbsolute(row.root) ||
        row.root.includes("\0") ||
        resolve(row.root) !== row.root
      )
        throw Error("Invalid retained original workdir identity");
      checkPath(row.root);
      return row.root;
    } finally {
      db.close();
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
  private manualEntry(
    db: Database.Database,
    operationId: string,
  ): OriginalManualJournalEntry | null {
    const row = db
      .prepare(
        "SELECT payload,digest FROM schedule_manual_journal WHERE operation_id=?",
      )
      .get(operationId) as { payload: string; digest: string } | undefined;
    if (!row) return null;
    if (
      Buffer.byteLength(row.payload) > 8192 ||
      createHash("sha256").update(row.payload).digest("hex") !== row.digest
    )
      throw Error("Invalid retained manual request");
    const value: unknown = JSON.parse(row.payload);
    if (
      !validOriginalManualJournalEntry(value) ||
      value.binding.operationId !== operationId
    )
      throw Error("Invalid retained manual request");
    this.assertScope(value.binding);
    return value;
  }
  private writeManual(
    db: Database.Database,
    entry: OriginalManualJournalEntry,
  ): void {
    if (!validOriginalManualJournalEntry(entry))
      throw Error("Invalid manual request");
    this.assertScope(entry.binding);
    const payload = JSON.stringify(entry);
    db.prepare(
      "INSERT INTO schedule_manual_journal VALUES(?,?,?) ON CONFLICT(operation_id) DO UPDATE SET payload=excluded.payload,digest=excluded.digest",
    ).run(
      entry.binding.operationId,
      payload,
      createHash("sha256").update(payload).digest("hex"),
    );
  }
  /** Fresh API take and confirmed Native binding must precede reservation. This method grants no authority. */
  reserveManual(binding: OriginalManualBinding): OriginalManualJournalEntry {
    if (!validOriginalManualBinding(binding))
      throw Error("Invalid manual binding");
    this.assertScope(binding);
    const db = this.journal();
    try {
      const old = this.manualEntry(db, binding.operationId);
      if (old) {
        if (
          !Object.entries(old.binding).every(
            ([key, value]) =>
              value === binding[key as keyof OriginalManualBinding],
          )
        )
          throw Error("Manual request identity conflict");
        return old;
      }
      const entry: OriginalManualJournalEntry = {
        binding: structuredClone(binding),
        status: "reserved",
        reported: false,
      };
      this.writeManual(db, entry);
      return entry;
    } finally {
      db.close();
    }
  }
  manualRequests(
    scope: OriginalScheduleReplicaScope,
  ): OriginalManualJournalEntry[] {
    this.assertScope(scope);
    const db = this.journal();
    try {
      const rows = db
        .prepare(
          "SELECT operation_id FROM schedule_manual_journal ORDER BY rowid LIMIT 10001",
        )
        .all() as { operation_id: string }[];
      if (rows.length > 10000)
        throw Error("Manual request journal requires review");
      return rows.map((row) => this.manualEntry(db, row.operation_id)!);
    } finally {
      db.close();
    }
  }
  private retainedManual(
    db: Database.Database,
    binding: OriginalManualBinding,
  ): OriginalManualJournalEntry {
    if (!validOriginalManualBinding(binding))
      throw Error("Invalid manual binding");
    this.assertScope(binding);
    const entry = this.manualEntry(db, binding.operationId);
    if (!entry) throw Error("Manual request reservation required");
    if (
      !Object.entries(entry.binding).every(
        ([key, value]) => value === binding[key as keyof OriginalManualBinding],
      )
    )
      throw Error("Manual request identity conflict");
    return entry;
  }
  /** Commit unknown before external effects. A reopened unknown never grants dispatch again. */
  beginManual(binding: OriginalManualBinding): boolean {
    const db = this.journal();
    try {
      const entry = this.retainedManual(db, binding);
      if (entry.status !== "reserved") return false;
      this.writeManual(db, { ...entry, status: "unknown" });
      return true;
    } finally {
      db.close();
    }
  }
  recordManualResult(
    binding: OriginalManualBinding,
    result: OriginalCronRunResult,
  ): OriginalManualJournalEntry {
    const db = this.journal();
    try {
      const entry = this.retainedManual(db, binding);
      const confirmed = parseOriginalCronRunResult(
        JSON.stringify(result),
        originalManualNativeRequest(binding),
      );
      if (
        !confirmed.success ||
        entry.status === "reserved" ||
        (entry.status !== "unknown" &&
          entry.status !== confirmed.receipt.status)
      )
        throw Error("Manual execution result unconfirmed");
      const next = {
        ...entry,
        status: confirmed.receipt.status,
        reported:
          entry.status === confirmed.receipt.status ? entry.reported : false,
      };
      this.writeManual(db, next);
      return next;
    } finally {
      db.close();
    }
  }
  acknowledgeManual(
    binding: OriginalManualBinding,
    receipt: OriginalManualReceipt,
  ): void {
    const db = this.journal();
    try {
      const entry = this.retainedManual(db, binding);
      if (
        entry.status === "reserved" ||
        !validOriginalManualResult(receipt, binding.owner, {
          action: "complete",
          ...originalManualWireRequest(binding),
          status: entry.status,
        })
      )
        throw Error("Manual report receipt unconfirmed");
      this.writeManual(db, { ...entry, reported: true });
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
