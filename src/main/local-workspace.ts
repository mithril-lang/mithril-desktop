import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  validateOperation,
  validateRecord,
  operationFingerprint,
  validId,
  type WorkspaceSnapshot,
  type WorkspaceOperation,
  type WorkspaceOperationsResponse,
  type WorkspaceRecord,
} from "@mithril/workspace/protocol";
import {
  repositoryCollections,
  validRepositoryEdit,
  validRepositoryPage,
  validRepositoryReceipt,
  type RepositoryCollection,
  type RepositoryDocument,
  type RepositoryEdit,
  type RepositoryPage,
  type RepositoryReceipt,
} from "@mithril/workspace/repository";
const retryableConnection = (error: unknown): boolean =>
  error instanceof Error &&
  !/owner|account|sign.in|auth|permission|scope|refused|schema|invalid|generation|persist/i.test(
    error.message,
  ) &&
  (/network unavailable|failed to fetch|fetch failed|request failed \((408|429|500|502|503|504)\)|inventory changed/i.test(
    error.message,
  ) ||
    ["TimeoutError", "NetworkError"].includes(error.name));
import type { LocalWorkspaceSyncStatus } from "../shared/local-workspace";

type Edit = WorkspaceOperation | RepositoryEdit;
type RecordValue = WorkspaceRecord | RepositoryDocument;
interface Pending {
  key: string;
  type: "workspace" | "repository";
  edit: Edit;
  record: RecordValue;
  conflict?: RecordValue | null;
}
interface State {
  owner: string;
  authorized: boolean;
  ready: boolean;
  generation?: number;
  cursor: number;
  localRevision?: number;
  records: WorkspaceRecord[];
  documents: RepositoryDocument[];
  pending: Pending[];
  phase: LocalWorkspaceSyncStatus["phase"];
  message: string;
  lastSyncedAt: number | null;
}
export interface LocalWorkspaceRemote {
  enable(): Promise<{ userId: string | null; enabled: boolean }>;
  getSnapshot(): Promise<WorkspaceSnapshot>;
  applyOperations(
    ops: WorkspaceOperation[],
    owner?: string,
  ): Promise<WorkspaceOperationsResponse>;
  repositoryPage(
    collection: RepositoryCollection,
    after?: string,
  ): Promise<RepositoryPage>;
  repositoryApply(edit: RepositoryEdit): Promise<RepositoryReceipt>;
}
const keyOf = (edit: Edit): string =>
  "collection" in edit
    ? `repository:${edit.collection}:${edit.id}`
    : `workspace:${edit.id}`;
const fingerprint = (edit: Edit): string =>
  "collection" in edit
    ? JSON.stringify([
        edit.collection,
        edit.id,
        edit.baseRevision,
        edit.deleted,
        edit.body,
        edit.datasetGeneration ?? 0,
        edit.capabilityMigration,
      ])
    : operationFingerprint(edit);

/** One main-process service owns durable data and the serialized outbox; no execution or file-upload operations are admitted. */
// @lat: [[local-workspace#Local SQLite workspace]]
export class LocalWorkspace {
  private db: Database.Database;
  private running: Promise<void> | null = null;
  private connecting: Promise<{
    userId: string | null;
    enabled: boolean;
  }> | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private epoch = 0;
  private stopped = false;
  constructor(
    path: string,
    private scope: () => string | null,
    private remote: LocalWorkspaceRemote,
    private changed: () => void = () => {},
  ) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    chmodSync(path, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("busy_timeout = 5000");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS local_workspace_state(scope TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_workspace_receipts(scope TEXT NOT NULL, operation_id TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope,operation_id));`);
  }
  private read(scope = this.scope()): State | null {
    if (!scope) return null;
    const row = this.db
      .prepare("SELECT payload FROM local_workspace_state WHERE scope=?")
      .get(scope) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as State) : null;
  }
  private save(scope: string, state: State): void {
    state.localRevision = (state.localRevision ?? 0) + 1;
    this.db
      .prepare(
        "INSERT INTO local_workspace_state(scope,payload) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload",
      )
      .run(scope, JSON.stringify(state));
  }
  private context(): { scope: string; state: State } {
    const scope = this.scope();
    const state = this.read(scope);
    if (!scope || !state?.authorized || this.stopped)
      throw Error("Sign in to your Mithril account first");
    return { scope, state };
  }
  private current(scope: string, epoch: number): void {
    if (this.stopped || this.scope() !== scope || this.epoch !== epoch)
      throw Error("Workspace account changed; stale response discarded");
  }
  private start(): void {
    if (!this.timer) {
      this.timer = setInterval(() => void this.sync(), 5000);
      this.timer.unref?.();
    }
  }
  async enable(): Promise<{ userId: string | null; enabled: boolean }> {
    this.stopped = false;
    const scope = this.scope();
    if (!scope) throw Error("Sign in to your Mithril account first");
    const stored = this.read(scope);
    if (stored?.authorized) {
      this.start();
      void this.sync();
      return { userId: stored.owner, enabled: true };
    }
    if (this.connecting) return this.connecting;
    const epoch = this.epoch;
    this.connecting = (async () => {
      const status = await this.remote.enable();
      this.current(scope, epoch);
      if (!status.userId || !status.enabled)
        throw Error("Sign in to your Mithril account first");
      const retained = this.read(scope);
      if (retained && retained.owner !== status.userId)
        throw Error("Workspace owner mismatch");
      this.save(
        scope,
        retained
          ? { ...retained, authorized: true, phase: "starting", message: "" }
          : {
              owner: status.userId,
              authorized: true,
              ready: false,
              cursor: 0,
              records: [],
              documents: [],
              pending: [],
              phase: "starting",
              message: "",
              lastSyncedAt: null,
            },
      );
      this.start();
      this.changed();
      void this.sync();
      return status;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  async connectionStatus(): Promise<{
    userId: string | null;
    enabled: boolean;
  }> {
    if (!this.scope()) return { userId: null, enabled: false };
    return this.enable();
  }
  async reconnect(): Promise<void> {
    const scope = this.scope(),
      epoch = this.epoch;
    if (!scope) throw Error("Sign in to your Mithril account first");
    this.stopped = false;
    const status = await this.remote.enable();
    this.current(scope, epoch);
    const state = this.read(scope);
    if (!state) {
      await this.enable();
      await this.sync();
      return;
    }
    if (status.userId !== state.owner || !status.enabled)
      throw Error("Workspace owner mismatch");
    state.authorized = true;
    state.phase = "starting";
    state.message = "";
    this.save(scope, state);
    this.start();
    // An explicit refresh must run after any older in-flight snapshot.
    if (this.running) await this.running;
    await this.sync();
  }
  status(): { userId: string | null; enabled: boolean } {
    const state = this.read();
    return {
      userId: !this.stopped && state?.authorized ? state.owner : null,
      enabled: !this.stopped && !!state?.authorized,
    };
  }
  syncStatus(): LocalWorkspaceSyncStatus {
    const state = this.read();
    if (!state || this.stopped)
      return {
        userId: null,
        ready: false,
        phase: "starting",
        pending: 0,
        conflicts: [],
        lastSyncedAt: null,
        message: "",
      };
    return {
      userId: state.authorized ? state.owner : null,
      ready: state.ready,
      phase: state.phase,
      pending: state.pending.length,
      conflicts: state.pending
        .filter((p) => p.conflict !== undefined)
        .map((p) => ({
          key: p.key,
          operationId: p.edit.operationId,
          local: p.record,
          cloud: p.conflict,
        })),
      lastSyncedAt: state.lastSyncedAt,
      message: state.message,
    };
  }
  getSnapshot(): WorkspaceSnapshot {
    const { state } = this.context();
    return {
      schemaVersion: 1,
      userId: state.owner,
      datasetGeneration: state.generation,
      cursor: state.cursor,
      records: state.records,
    };
  }
  repositoryPage(
    collection: RepositoryCollection,
    after?: string,
  ): RepositoryPage {
    if (
      !repositoryCollections.includes(collection) ||
      collection === "chat" ||
      (after !== undefined && !validId(after))
    )
      throw Error("Invalid repository page");
    const { state } = this.context();
    // Local reads return a complete immutable IPC snapshot, with no network pagination.
    const all = state.documents
      .filter((d) => d.collection === collection)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const rows = (after ? all.filter((d) => d.id > after) : all).slice(0, 3);
    const documents = rows.slice(0, 2);
    return {
      schemaVersion: 1,
      userId: state.owner,
      datasetGeneration: state.generation,
      documents,
      nextAfter: rows.length > 2 ? documents[1].id : null,
      inventory: {
        cursor: state.localRevision ?? 0,
        anchor: state.localRevision ?? 0,
        total: all.length,
      },
    };
  }
  /** An accepted result here acknowledges a LOCAL SQLite commit. Only syncStatus can assert cloud acknowledgement. */
  applyOperations(
    ops: WorkspaceOperation[],
    owner?: string,
  ): WorkspaceOperationsResponse {
    if (
      !Array.isArray(ops) ||
      !ops.length ||
      ops.length > 50 ||
      !ops.every(validateOperation) ||
      new Set(ops.map((op) => op.operationId)).size !== ops.length ||
      ops.some((op) => ["file_set", "repository_document"].includes(op.kind))
    )
      throw Error("Unsupported local workspace operations");
    const { scope, state } = this.context();
    if (owner !== undefined && owner !== state.owner)
      throw Error("Workspace owner changed; saved changes were not sent");
    const results = this.db.transaction(() =>
      ops.map((op) => this.commit(scope, op, "workspace")),
    )();
    this.changed();
    void this.sync();
    return {
      schemaVersion: 1,
      userId: state.owner,
      results: results.map((r) => ({
        operationId: r.operationId,
        datasetGeneration: r.datasetGeneration,
        status: r.status,
        record: r.value as WorkspaceRecord | null,
      })),
    };
  }
  repositoryApply(edit: RepositoryEdit): RepositoryReceipt {
    if (
      !validRepositoryEdit(edit) ||
      edit.capabilityMigration ||
      edit.collection === "chat"
    )
      throw Error("Unsupported local repository edit");
    const { scope, state } = this.context();
    const result = this.db.transaction(() =>
      this.commit(scope, edit, "repository"),
    )();
    this.changed();
    void this.sync();
    return {
      schemaVersion: 1,
      userId: state.owner,
      operationId: result.operationId,
      datasetGeneration: result.datasetGeneration,
      status: result.status,
      document: result.value as RepositoryDocument | null,
    };
  }
  private commit(
    scope: string,
    edit: Edit,
    type: Pending["type"],
  ): {
    operationId: string;
    datasetGeneration?: number;
    status: "accepted" | "conflict";
    value: RecordValue | null;
  } {
    const state = this.read(scope)!;
    if (!state.ready || state.phase === "blocked")
      throw Error(
        "Workspace initial synchronization or conflict review required before editing",
      );
    if ((edit.datasetGeneration ?? 0) !== (state.generation ?? 0))
      throw Error("Workspace dataset generation changed");
    const fp = fingerprint(edit);
    const previous = this.db
      .prepare(
        "SELECT fingerprint,payload FROM local_workspace_receipts WHERE scope=? AND operation_id=?",
      )
      .get(scope, edit.operationId) as
      | { fingerprint: string; payload: string }
      | undefined;
    if (previous) {
      if (previous.fingerprint !== fp)
        throw Error("Workspace operation ID reused");
      return JSON.parse(previous.payload);
    }
    const key = keyOf(edit);
    const old =
      type === "workspace"
        ? state.records.find((r) => r.id === edit.id)
        : state.documents.find(
            (d) =>
              d.id === edit.id &&
              d.collection === (edit as RepositoryEdit).collection,
          );
    const blocked = state.pending.some(
      (p) => p.key === key && p.conflict !== undefined,
    );
    const accepted = !blocked && (old?.revision ?? 0) === edit.baseRevision;
    const value: RecordValue | null = accepted
      ? "collection" in edit
        ? {
            collection: edit.collection,
            id: edit.id,
            body: edit.body,
            revision: edit.baseRevision + 1,
            updatedAt: Date.now(),
            deleted: edit.deleted,
          }
        : {
            id: edit.id,
            kind: edit.kind,
            data: edit.data,
            revision: edit.baseRevision + 1,
            updatedAt: Date.now(),
            deleted: edit.deleted,
          }
      : (old ?? null);
    const result = {
      operationId: edit.operationId,
      datasetGeneration: state.generation,
      status: accepted ? ("accepted" as const) : ("conflict" as const),
      value,
    };
    if (accepted && value) {
      if (type === "workspace")
        state.records = [
          ...state.records.filter((r) => r.id !== edit.id),
          value as WorkspaceRecord,
        ];
      else
        state.documents = [
          ...state.documents.filter(
            (d) => keyOf({ ...d, operationId: "", baseRevision: 0 }) !== key,
          ),
          value as RepositoryDocument,
        ];
      state.pending.push({ key, type, edit, record: value });
      this.save(scope, state);
    }
    this.db
      .prepare(
        "INSERT INTO local_workspace_receipts(scope,operation_id,fingerprint,payload) VALUES(?,?,?,?)",
      )
      .run(scope, edit.operationId, fp, JSON.stringify(result));
    return result;
  }
  async sync(): Promise<void> {
    if (this.stopped) return;
    if (this.running) return this.running;
    this.running = this.pass().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async pass(): Promise<void> {
    const scope = this.scope(),
      epoch = this.epoch;
    const initial = this.read(scope);
    if (!scope || !initial?.authorized || initial.phase === "blocked") return;
    try {
      const status = await this.remote.enable();
      this.current(scope, epoch);
      if (status.userId !== initial.owner || !status.enabled)
        throw Error("Workspace owner mismatch");
      // Pull BEFORE replay detects destructive cloud restore/generation changes.
      const snapshot = await this.remote.getSnapshot();
      this.current(scope, epoch);
      if (
        snapshot.userId !== initial.owner ||
        snapshot.schemaVersion !== 1 ||
        !snapshot.records.every(validateRecord) ||
        !Number.isSafeInteger(snapshot.cursor)
      )
        throw Error("Invalid workspace owner/schema");
      const generation = snapshot.datasetGeneration ?? 0;
      if (
        !Number.isSafeInteger(generation) ||
        generation < 0 ||
        new Set(snapshot.records.map((r) => r.id)).size !==
          snapshot.records.length
      )
        throw Error("Invalid workspace snapshot");
      let state = this.read(scope)!;
      if (state.ready && generation < (state.generation ?? 0))
        throw Error("Workspace dataset generation regressed");
      if (state.pending.length && generation !== (state.generation ?? 0))
        throw Error(
          "Workspace dataset generation changed; pending edits retained for review",
        );
      const documents: RepositoryDocument[] = [];
      for (const collection of repositoryCollections.filter(
        (value) => value !== "chat",
      )) {
        let after: string | undefined;
        let inventory: RepositoryPage["inventory"];
        let received = 0;
        do {
          const page = await this.remote.repositoryPage(collection, after);
          this.current(scope, epoch);
          if (
            !validRepositoryPage(page, collection, after) ||
            page.userId !== initial.owner ||
            (page.datasetGeneration ?? 0) !== generation
          )
            throw Error("Invalid repository owner/schema/generation");
          if (after === undefined) inventory = page.inventory;
          else if (JSON.stringify(inventory) !== JSON.stringify(page.inventory))
            throw Error("Repository inventory changed during synchronization");
          documents.push(...page.documents);
          received += page.documents.length;
          after = page.nextAfter ?? undefined;
        } while (after);
        if (inventory && received !== inventory.total)
          throw Error("Incomplete repository inventory");
      }
      this.db.transaction(() => {
        state = this.read(scope)!;
        const keys = new Set(state.pending.map((p) => p.key));
        state.records = [
          ...snapshot.records.filter((r) => !keys.has(`workspace:${r.id}`)),
          ...state.records.filter((r) => keys.has(`workspace:${r.id}`)),
        ];
        state.documents = [
          ...documents.filter(
            (d) => !keys.has(`repository:${d.collection}:${d.id}`),
          ),
          ...state.documents.filter((d) =>
            keys.has(`repository:${d.collection}:${d.id}`),
          ),
        ];
        state.cursor = snapshot.cursor;
        state.generation = generation;
        state.ready = true;
        this.save(scope, state);
      })();
      this.changed();
      const blocked = new Set<string>();
      for (const pending of this.read(scope)!.pending) {
        if (pending.conflict !== undefined || blocked.has(pending.key)) {
          blocked.add(pending.key);
          continue;
        }
        let remoteRecord: RecordValue | null;
        let accepted: boolean;
        if (pending.type === "workspace") {
          const response = await this.remote.applyOperations(
            [pending.edit as WorkspaceOperation],
            initial.owner,
          );
          this.current(scope, epoch);
          const r = response.results[0];
          if (
            response.userId !== initial.owner ||
            response.schemaVersion !== 1 ||
            response.results.length !== 1 ||
            r.operationId !== pending.edit.operationId ||
            !["accepted", "conflict"].includes(r.status) ||
            (r.record &&
              (!validateRecord(r.record) ||
                r.record.id !== pending.edit.id ||
                r.record.kind !== (pending.edit as WorkspaceOperation).kind ||
                (r.status === "accepted" &&
                  (r.record.revision !== pending.edit.baseRevision + 1 ||
                    JSON.stringify(r.record.data) !==
                      JSON.stringify(
                        (pending.edit as WorkspaceOperation).data,
                      ) ||
                    r.record.deleted !== pending.edit.deleted)))) ||
            (r.datasetGeneration ?? 0) !== generation
          )
            throw Error("Invalid workspace receipt");
          accepted = r.status === "accepted";
          remoteRecord = r.record;
        } else {
          const r = await this.remote.repositoryApply(
            pending.edit as RepositoryEdit,
          );
          this.current(scope, epoch);
          if (
            !validRepositoryReceipt(r, pending.edit as RepositoryEdit) ||
            r.userId !== initial.owner ||
            (r.datasetGeneration ?? 0) !== generation
          )
            throw Error("Invalid repository receipt");
          accepted = r.status === "accepted";
          remoteRecord = r.document;
        }
        if (accepted && !remoteRecord) throw Error("Invalid accepted receipt");
        this.db.transaction(() => {
          const latest = this.read(scope)!;
          const target = latest.pending.find(
            (p) => p.edit.operationId === pending.edit.operationId,
          );
          if (!target) throw Error("Pending operation changed");
          if (accepted) {
            latest.pending = latest.pending.filter((p) => p !== target);
            if (!latest.pending.some((p) => p.key === pending.key)) {
              if (pending.type === "workspace")
                latest.records = [
                  ...latest.records.filter((r) => r.id !== pending.edit.id),
                  remoteRecord as WorkspaceRecord,
                ];
              else
                latest.documents = [
                  ...latest.documents.filter(
                    (d) => `repository:${d.collection}:${d.id}` !== pending.key,
                  ),
                  remoteRecord as RepositoryDocument,
                ];
            }
          } else target.conflict = remoteRecord;
          this.save(scope, latest);
        })();
        if (!accepted) blocked.add(pending.key);
        this.changed();
      }
      this.current(scope, epoch);
      state = this.read(scope)!;
      state.phase = "synced";
      state.message = "";
      state.lastSyncedAt = Date.now();
      this.save(scope, state);
      this.changed();
    } catch (error) {
      if (
        this.stopped ||
        this.scope() !== scope ||
        this.epoch !== epoch ||
        !scope
      )
        return;
      const state = this.read(scope)!;
      state.message =
        error instanceof Error
          ? error.message
          : "Workspace synchronization failed";
      state.phase = retryableConnection(error) ? "offline" : "blocked";
      // Revoked credentials stop exposing cached account data. Network failures retain offline access.
      if (
        /sign.in|auth|permission|scope|refused|401|403|owner mismatch/i.test(
          state.message,
        )
      )
        state.authorized = false;
      this.save(scope, state);
      this.changed();
    }
  }
  resolve(operationId: string, choice: "local" | "cloud"): void {
    if (!validId(operationId) || !["local", "cloud"].includes(choice))
      throw Error("Invalid conflict choice");
    const { scope } = this.context();
    this.db.transaction(() => {
      const state = this.read(scope)!;
      const conflict = state.pending.find(
        (p) => p.edit.operationId === operationId && p.conflict !== undefined,
      );
      if (!conflict) throw Error("Conflict no longer exists");
      const related = state.pending.filter((p) => p.key === conflict.key);
      const latest = related[related.length - 1];
      state.pending = state.pending.filter((p) => p.key !== conflict.key);
      const cloud = conflict.conflict ?? null;
      if (choice === "local") {
        const edit = {
          ...latest.edit,
          operationId: randomUUID(),
          baseRevision: cloud?.revision ?? 0,
          datasetGeneration: state.generation,
        };
        const record = {
          ...latest.record,
          revision: edit.baseRevision + 1,
          updatedAt: Date.now(),
        };
        state.pending.push({
          key: conflict.key,
          type: conflict.type,
          edit,
          record,
        });
        if (conflict.type === "workspace")
          state.records = [
            ...state.records.filter((r) => r.id !== edit.id),
            record as WorkspaceRecord,
          ];
        else
          state.documents = [
            ...state.documents.filter(
              (d) => `repository:${d.collection}:${d.id}` !== conflict.key,
            ),
            record as RepositoryDocument,
          ];
      } else if (conflict.type === "workspace")
        state.records = [
          ...state.records.filter((r) => r.id !== conflict.edit.id),
          ...(cloud ? [cloud as WorkspaceRecord] : []),
        ];
      else
        state.documents = [
          ...state.documents.filter(
            (d) => `repository:${d.collection}:${d.id}` !== conflict.key,
          ),
          ...(cloud ? [cloud as RepositoryDocument] : []),
        ];
      this.save(scope, state);
    })();
    this.changed();
    void this.sync();
  }
  reset(): void {
    this.epoch++;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.changed();
  }
  close(): void {
    this.reset();
    this.db.close();
  }
}
