import { portableAttachmentRows } from "./kanban-attachment-identity";
import {
  restoreKanbanTaskGroup,
  selectKanbanTaskGroup,
  readStableKanbanTasks,
} from "./kanban-task-group-restore";
import {
  hasPendingKanbanBoard,
  pendingKanbanBoards,
  initializeKanbanBoardMetadata,
  supportsKanbanMetadataReplacement,
  kanbanBoardRecord,
  restoreKanbanBoard,
} from "./kanban-board-replica";
import {
  captureKanbanAttachments,
  type KanbanAttachmentProjection,
} from "./kanban-attachment-snapshot";
import {
  portableKanbanTask,
  kanbanDeviceFields,
} from "./kanban-portable-record";
import { projectKanbanHistory } from "./kanban-history-identity";
import { planKanbanHistoryRestore } from "./kanban-history-restore";
import { restoreKanbanTask } from "./kanban-task-restore";
import {
  prepareKanbanAttachmentWriteback,
  orderedKanbanAttachments,
  type KanbanAttachmentWriteback,
} from "./kanban-attachment-replica";
import { taskAttachmentRecords } from "@mithril/workspace/task-attachments";
import { validReplicaRecord as isReplicaRecord } from "@mithril/workspace/replica-sync";
import { planKanbanDependencies } from "./kanban-dependency-replica";
import {
  memoryReplicaSnapshot,
  applyMemoryReplica,
} from "./memory-replica-files";
import { app } from "electron";
import Database from "better-sqlite3";
import {
  existsSync,
  lstatSync,
  readdirSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join, resolve, dirname } from "path";
import { createHash, randomUUID } from "crypto";
import { profileHome } from "./utils";
import { cloudWorkspace } from "./cloud-workspace-runtime";
import { getConnectionConfig } from "./config";
import {
  validBody,
  repositoryFingerprint,
  type JsonValue,
} from "@mithril/workspace/repository";
import type { RepositorySeed } from "@mithril/workspace/repository-react";
function checked(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error("Unsafe Kanban storage");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function json(value: unknown): JsonValue {
  if (!validBody(value))
    throw Error("Kanban record cannot be synchronized without losing data");
  return value;
}
/** A device profile is bound to its first authorized owner; switching accounts cannot copy it silently. */
export function bindRepositorySource(
  directory: string,
  profile: string,
  userId: string,
): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(userId))
    throw Error("Invalid repository owner");
  checked(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(
    directory,
    createHash("sha256").update(profile).digest("hex") + ".json",
  );
  checked(path);
  if (!existsSync(path)) {
    try {
      writeFileSync(path, JSON.stringify({ profile, userId }), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  if (!lstatSync(path).isFile() || lstatSync(path).size > 2048)
    throw Error("Invalid repository source binding");
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.profile !== profile || value.userId !== userId)
    throw Error(
      "This device profile belongs to another account; automatic migration refused",
    );
}
/** Read an existing source binding without adopting or writing a device profile. */
export function repositorySourceOwned(
  directory: string,
  profile: string,
  userId: string,
): boolean {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(userId))
    throw Error("Invalid repository owner");
  checked(directory);
  const path = join(
    directory,
    createHash("sha256").update(profile).digest("hex") + ".json",
  );
  checked(path);
  if (!existsSync(path)) return false;
  if (!lstatSync(path).isFile() || lstatSync(path).size > 2048)
    throw Error("Invalid repository source binding");
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.profile !== profile || value.userId !== userId)
    throw Error(
      "This device profile belongs to another account; source inventory refused",
    );
  return true;
}
/** Read rich board data in one SQLite snapshot. Never switches boards or invokes an agent. */
export function kanbanRepositorySeed(
  root: string,
  profile: string,
  versions?: Map<string, string>,
  attachmentProjection?: KanbanAttachmentProjection,
): RepositorySeed[] {
  checked(root);
  const base = join(root, "kanban", "boards");
  checked(base);
  const slugs = [
    "default",
    ...(existsSync(base)
      ? readdirSync(base).filter((s) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s))
      : []),
  ];
  const documents: RepositorySeed[] = [];
  for (const slug of [...new Set(slugs)]) {
    const path =
      slug === "default"
        ? join(root, "kanban.db")
        : join(base, slug, "kanban.db");
    checked(path);
    if (!existsSync(path)) continue;
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      db.transaction(() => {
        if (hasPendingKanbanBoard(db))
          throw Error("Board metadata transaction requires recovery");
        const tables = new Set(
          (
            db
              .prepare("SELECT name FROM sqlite_master WHERE type='table'")
              .all() as { name: string }[]
          ).map((r) => r.name),
        );
        if (!tables.has("tasks")) throw Error("Unsupported Kanban schema");
        const supported = new Set([
          "tasks",
          "task_comments",
          "task_events",
          "task_runs",
          "task_dependencies",
          "task_links",
          "task_attachments",
        ]);
        if (
          [...tables].some(
            (name) => name.startsWith("task_") && !supported.has(name),
          )
        )
          throw Error("Unsupported Kanban relationships; source data retained");
        const graphTables = ["task_links", "task_dependencies"].filter((name) =>
          tables.has(name),
        );
        if (graphTables.length > 1)
          throw Error("Ambiguous Kanban relationship schema; source retained");
        if (
          !attachmentProjection &&
          tables.has("task_attachments") &&
          db.prepare("SELECT 1 FROM task_attachments LIMIT 1").get()
        )
          throw Error(
            "Kanban attachments require byte synchronization; original files retained",
          );
        const read = (
          table: string,
          limit = 100000,
        ): Record<string, unknown>[] => {
          if (!tables.has(table)) return [];
          const rows = db
            .prepare(`SELECT * FROM ${table} LIMIT ?`)
            .all(limit + 1) as Record<string, unknown>[];
          if (rows.length > limit)
            throw Error(
              "Kanban snapshot exceeds the supported bound; source data retained",
            );
          return rows;
        };
        const tasks = read("tasks", 1000),
          comments = read("task_comments"),
          events = read("task_events"),
          runs = read("task_runs"),
          attachments = read("task_attachments"),
          dependencies = graphTables.length ? read(graphTables[0], 20000) : [];
        const taskIds = new Set(tasks.map((row) => String(row.id)));
        if (
          read("mithril_history_ids", 300000).some(
            (row) =>
              typeof row.task_id !== "string" || !taskIds.has(row.task_id),
          )
        )
          throw Error("Mapped history task changed; records retained");
        if (
          read("mithril_attachment_ids").some(
            (row) =>
              typeof row.task_id !== "string" || !taskIds.has(row.task_id),
          )
        )
          throw Error("Mapped attachment task changed; files retained");
        const attachmentMarkers = read("mithril_attachment_projection");
        if (
          attachmentMarkers.some(
            (row) =>
              typeof row.task_id !== "string" || !taskIds.has(row.task_id),
          )
        )
          throw Error("Invalid attachment projection marker");
        const markedAttachments = new Set(
          attachmentMarkers.map((row) => row.task_id),
        );
        if (
          [comments, events, runs, attachments].some((rows) =>
            rows.some(
              (row) =>
                typeof row.task_id !== "string" || !taskIds.has(row.task_id),
            ),
          ) ||
          dependencies.some(
            (row) =>
              ![row.task_id, row.parent_id, row.child_id].some(
                (id) => typeof id === "string" && taskIds.has(id),
              ),
          )
        )
          throw Error(
            "Unassigned Kanban relationships require review; original records retained",
          );
        const board = kanbanBoardRecord(root, slug, tasks);
        versions?.set("board:" + slug, board.version);
        documents.push({ collection: "board", id: slug, body: board.body });
        const identityRows = tables.has("mithril_repository_task_ids")
          ? (db
              .prepare(
                "SELECT task_id,document_id FROM mithril_repository_task_ids LIMIT 1001",
              )
              .all() as { task_id: string; document_id: string }[])
          : [];
        if (
          identityRows.length > 1000 ||
          identityRows.some(
            (row) =>
              typeof row.task_id !== "string" ||
              !taskIds.has(row.task_id) ||
              !/^[a-zA-Z0-9_-]{1,100}$/.test(row.document_id),
          ) ||
          new Set(identityRows.map((row) => row.document_id)).size !==
            identityRows.length
        )
          throw Error("Invalid Kanban repository identity map");
        const identityMap = new Map(
          identityRows.map((row) => [row.task_id, row.document_id]),
        );
        for (const raw of tasks) {
          const task = portableKanbanTask(raw);
          const id = String(raw.id),
            key =
              identityMap.get(id) ??
              createHash("sha256")
                .update(JSON.stringify([profile, slug, id]))
                .digest("hex");
          const taskComments = projectKanbanHistory(
            db,
            id,
            "task_comments",
            comments.filter((r) => r.task_id === id),
          );
          const taskEvents = projectKanbanHistory(
            db,
            id,
            "task_events",
            events.filter((r) => r.task_id === id),
          );
          const taskRuns = projectKanbanHistory(
            db,
            id,
            "task_runs",
            runs.filter((r) => r.task_id === id),
          );
          const rawAttachments = orderedKanbanAttachments(
            db,
            id,
            attachments.filter((r) => r.task_id === id),
          );
          const portableAttachments = rawAttachments.length
            ? attachmentProjection!(
                slug,
                key,
                id,
                portableAttachmentRows(db, id, rawAttachments),
              )
            : [];

          versions?.set(
            "task:" + key,
            createHash("sha256")
              .update(
                JSON.stringify([
                  raw,
                  taskComments.raw,
                  taskEvents.raw,
                  taskRuns.raw,
                  dependencies.filter(
                    (r) =>
                      r.task_id === id ||
                      r.parent_id === id ||
                      r.child_id === id,
                  ),
                  ...(rawAttachments.length
                    ? [{ rows: rawAttachments, resources: portableAttachments }]
                    : []),
                ]),
              )
              .digest("hex"),
          );
          documents.push({
            collection: "task",
            id: key,
            body: json({
              board: slug,
              task,
              comments: taskComments.portable,
              events: taskEvents.portable,
              runs: taskRuns.portable,
              dependencies: dependencies.filter(
                (r) =>
                  r.task_id === id || r.parent_id === id || r.child_id === id,
              ),
              parents: dependencies
                .filter((r) => r.child_id === id)
                .map((r) => String(r.parent_id)),
              children: dependencies
                .filter((r) => r.parent_id === id)
                .map((r) => String(r.child_id)),
              latest_summary: taskRuns.portable.at(-1)?.summary ?? null,
              ...(rawAttachments.length || markedAttachments.has(id)
                ? { attachments: portableAttachments }
                : {}),
            }),
          });
        }
      })();
    } finally {
      db.close();
    }
  }
  return documents;
}
export async function nativeRepositorySeed(): Promise<{
  userId: string;
  documents: RepositorySeed[];
}> {
  const before = await cloudWorkspace.nativeContext();
  if (getConnectionConfig().mode !== "local")
    return { userId: before.userId, documents: [] };
  if (process.env.HERMES_KANBAN_DB?.trim())
    throw Error(
      "Custom Kanban storage requires a configured repository adapter",
    );
  bindRepositorySource(
    join(app.getPath("userData"), "repository-source-owners"),
    before.profile,
    before.userId,
  );
  if (process.env.HERMES_KANBAN_ATTACHMENTS_ROOT?.trim())
    throw Error(
      "Custom Kanban attachments require a configured repository adapter",
    );
  const { HERMES_PYTHON } = await import("./installer");
  const root =
    process.env.HERMES_KANBAN_HOME?.trim() || profileHome(before.profile);
  const capture = captureKanbanAttachments(
    root,
    HERMES_PYTHON,
    join(app.getPath("userData"), "repository-task-captures"),
  );
  let documents: RepositorySeed[];
  try {
    documents = kanbanRepositorySeed(
      root,
      before.profile,
      undefined,
      capture.project,
    );
    await capture.publish(
      cloudWorkspace.taskAttachments.forOwner(before.userId),
      async () => {
        if (
          JSON.stringify(before) !==
          JSON.stringify(await cloudWorkspace.nativeContext())
        )
          throw Error(
            "Workspace identity changed; original attachments retained",
          );
      },
    );
  } finally {
    capture.dispose();
  }
  const after = await cloudWorkspace.nativeContext();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error("Workspace identity changed");
  return { userId: after.userId, documents };
}

/** Identity is random per device/profile, persisted independently of paths and account secrets. */
export function repositoryReplicaId(
  directory: string,
  profile: string,
): string {
  checked(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(
    directory,
    createHash("sha256").update(profile).digest("hex") + ".replica",
  );
  checked(file);
  if (!existsSync(file)) {
    try {
      writeFileSync(file, randomUUID(), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  if (!lstatSync(file).isFile() || lstatSync(file).size > 128)
    throw Error("Invalid replica identity");
  const value = readFileSync(file, "utf8");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw Error("Invalid replica identity");
  return value;
}
export function kanbanReplicaSnapshot(
  root: string,
  profile: string,
  userId: string,
  replicaId: string,
  attachmentProjection?: KanbanAttachmentProjection,
): import("@mithril/workspace/replica-sync").ReplicaSnapshot {
  const versions = new Map<string, string>();
  const documents = kanbanRepositorySeed(
    root,
    profile,
    versions,
    attachmentProjection,
  );
  return {
    schemaVersion: 1,
    userId,
    replicaId,
    complete: true,
    collections: ["board", "task"],
    documents: documents.map((row) => ({
      ...row,
      deleted: false,
      version: versions.get(row.collection + ":" + row.id)!,
    })),
  };
}
/** Recover completed metadata writes before source files are read; later missing files cannot strand a receipt. */
function retainedTaskReceipt(
  root: string,
  userId: string,
  replicaId: string,
  write: import("@mithril/workspace/replica-sync").ReplicaWrite,
): import("@mithril/workspace/replica-sync").ReplicaResult | null {
  if (!["task", "board"].includes(write.document.collection)) return null;
  const hint = write.expectedRecord?.body ?? write.document.body;
  if (
    !hint ||
    typeof hint !== "object" ||
    Array.isArray(hint) ||
    typeof (write.document.collection === "board" ? hint.slug : hint.board) !==
      "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(
      String(write.document.collection === "board" ? hint.slug : hint.board),
    )
  )
    return null;
  const slug = String(
    write.document.collection === "board" ? hint.slug : hint.board,
  );
  const file =
    slug === "default"
      ? join(root, "kanban.db")
      : join(root, "kanban", "boards", slug, "kanban.db");
  checked(file);
  if (!existsSync(file)) return null;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (
      !db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='mithril_replica_receipts'",
        )
        .get()
    )
      return null;
    const row = db
      .prepare(
        "SELECT fingerprint,receipt FROM mithril_replica_receipts WHERE operation_id=?",
      )
      .get(write.operationId) as
      | { fingerprint: string; receipt: string }
      | undefined;
    if (!row) return null;
    if (
      row.fingerprint !==
      createHash("sha256").update(JSON.stringify(write)).digest("hex")
    )
      throw Error("Replica operation was reused");
    const receipt = JSON.parse(
      row.receipt,
    ) as import("@mithril/workspace/replica-sync").ReplicaResult;
    if (
      receipt.schemaVersion !== 1 ||
      receipt.userId !== userId ||
      receipt.replicaId !== replicaId ||
      receipt.status !== "applied" ||
      !isReplicaRecord(receipt.record) ||
      receipt.record.collection !== write.document.collection ||
      receipt.record.id !== write.document.id
    )
      throw Error("Invalid retained task receipt; source retained");
    return receipt;
  } finally {
    db.close();
  }
}

/** Applies existing task metadata under the same SQLite writer lock as the device agent. */
export function applyKanbanReplica(
  root: string,
  profile: string,
  userId: string,
  replicaId: string,
  write: import("@mithril/workspace/replica-sync").ReplicaWrite,
  attachmentProjection?: KanbanAttachmentProjection,
  attachmentWriteback?: KanbanAttachmentWriteback,
  boardPython?: string,
  boardMetadataReplacement = false,
  groupDocuments?: import("@mithril/workspace/repository").RepositoryDocument[],
  groupAttachmentPlans?: Map<string, KanbanAttachmentWriteback>,
): import("@mithril/workspace/replica-sync").ReplicaResult {
  const retained = retainedTaskReceipt(root, userId, replicaId, write);
  if (retained) return retained;
  const snapshot =
    (): import("@mithril/workspace/replica-sync").ReplicaSnapshot =>
      kanbanReplicaSnapshot(
        root,
        profile,
        userId,
        replicaId,
        attachmentProjection,
      );
  if (
    write.document.collection === "board" &&
    (write.expectedRecord ||
      (write.document.id === "default" &&
        pendingKanbanBoards(root).includes("default")))
  ) {
    return boardPython
      ? initializeKanbanBoardMetadata(
          root,
          userId,
          replicaId,
          write,
          boardPython,
          boardMetadataReplacement,
        )
      : {
          schemaVersion: 1,
          userId,
          replicaId,
          status: "deferred",
          record: null,
        };
  }
  const observed =
    snapshot().documents.find(
      (row) =>
        row.collection === write.document.collection &&
        row.id === write.document.id,
    ) ?? null;
  const result = (
    status: "applied" | "conflict" | "deferred",
    record = observed,
  ): import("@mithril/workspace/replica-sync").ReplicaResult => ({
    schemaVersion: 1,
    userId,
    replicaId,
    status,
    record,
  });
  if (write.document.collection === "board") {
    if (observed) return result("conflict");
    return boardPython
      ? restoreKanbanBoard(
          root,
          userId,
          replicaId,
          write,
          boardPython,
          boardMetadataReplacement,
        )
      : result("deferred");
  }
  if (write.document.collection !== "task") return result("deferred");
  const body = (observed?.body ?? write.document.body) as {
    board: string;
    task: { id: string };
    [key: string]: JsonValue;
  };
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(body.board))
    throw Error("Invalid native board");
  const file =
    body.board === "default"
      ? join(root, "kanban.db")
      : join(root, "kanban", "boards", body.board, "kanban.db");
  checked(file);
  if (!existsSync(file)) return result("deferred");
  const db = new Database(file, { fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  try {
    return db
      .transaction(() => {
        db.exec(
          "CREATE TABLE IF NOT EXISTS mithril_replica_receipts(operation_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL)",
        );
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(write))
          .digest("hex");
        const receipt = db
          .prepare(
            "SELECT fingerprint,receipt FROM mithril_replica_receipts WHERE operation_id=?",
          )
          .get(write.operationId) as
          | { fingerprint: string; receipt: string }
          | undefined;
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw Error("Replica operation was reused");
          return JSON.parse(
            receipt.receipt,
          ) as import("@mithril/workspace/replica-sync").ReplicaResult;
        }
        const current =
          snapshot().documents.find(
            (row) => row.collection === "task" && row.id === write.document.id,
          ) ?? null;
        if (!observed) {
          if (
            current ||
            write.expectedVersion !== null ||
            write.expectedRecord !== null
          )
            return result("conflict", current);
          if (write.document.deleted) return result("deferred");
          const restored = groupDocuments
            ? restoreKanbanTaskGroup(
                db,
                write.document,
                groupDocuments,
                (document) => {
                  const plan =
                    groupAttachmentPlans?.get(document.id) ??
                    (document.id === write.document.id
                      ? attachmentWriteback
                      : undefined);
                  if (!plan) return undefined;
                  return () => {
                    const value = document.body as {
                      board: string;
                      task: { id: string };
                      attachments?: JsonValue;
                    };
                    plan.apply(db, [], [], write.operationId);
                    const rows = orderedKanbanAttachments(
                      db,
                      value.task.id,
                      db
                        .prepare(
                          "SELECT * FROM task_attachments WHERE task_id=?",
                        )
                        .all(value.task.id) as Record<string, unknown>[],
                    );
                    const resources = rows.length
                      ? attachmentProjection!(
                          value.board,
                          document.id,
                          value.task.id,
                          portableAttachmentRows(db, value.task.id, rows),
                        )
                      : [];
                    if (
                      repositoryFingerprint({
                        body: resources as unknown as JsonValue,
                        deleted: false,
                      }) !==
                      repositoryFingerprint({
                        body: value.attachments ?? [],
                        deleted: false,
                      })
                    )
                      throw Error("Restored attachment projection changed");
                    return { rows, resources };
                  };
                },
              )
            : restoreKanbanTask(
                db,
                write.document.id,
                write.document.body,
                attachmentWriteback
                  ? () => {
                      attachmentWriteback.apply(db, [], [], write.operationId);
                      const rows = orderedKanbanAttachments(
                        db,
                        body.task.id,
                        db
                          .prepare(
                            "SELECT * FROM task_attachments WHERE task_id=?",
                          )
                          .all(body.task.id) as Record<string, unknown>[],
                      );
                      const resources = rows.length
                        ? attachmentProjection!(
                            body.board,
                            write.document.id,
                            body.task.id,
                            portableAttachmentRows(db, body.task.id, rows),
                          )
                        : [];
                      if (
                        repositoryFingerprint({
                          body: resources as unknown as JsonValue,
                          deleted: false,
                        }) !==
                        repositoryFingerprint({
                          body: body.attachments ?? [],
                          deleted: false,
                        })
                      )
                        throw Error("Restored attachment projection changed");
                      return { rows, resources };
                    }
                  : undefined,
              );
          if (!restored) return result("deferred");
          const record = {
            collection: "task" as const,
            id: write.document.id,
            deleted: false,
            ...restored,
          };
          const accepted = result("applied", record);
          db.prepare("INSERT INTO mithril_replica_receipts VALUES(?,?,?)").run(
            write.operationId,
            fingerprint,
            JSON.stringify(accepted),
          );
          return accepted;
        }
        if (!current || current.version !== write.expectedVersion)
          return result("conflict", current);
        const raw = db
          .prepare("SELECT * FROM tasks WHERE id=?")
          .get(body.task.id) as Record<string, unknown>;
        if (raw.claim_lock || raw.status === "running")
          return result("deferred", current);
        const incoming = write.document.body as typeof body;
        if (
          !incoming ||
          typeof incoming !== "object" ||
          !incoming.task ||
          incoming.board !== body.board ||
          incoming.task.id !== body.task.id
        )
          throw Error("Invalid task replica");
        // Run receipts remain historical; graph writes are schema-checked data only.
        const same = (
          a: JsonValue | undefined,
          b: JsonValue | undefined,
        ): boolean =>
          a === undefined || b === undefined
            ? a === b
            : repositoryFingerprint({ body: a, deleted: false }) ===
              repositoryFingerprint({ body: b, deleted: false });
        const runsChanged = [
          "comments",
          "events",
          "runs",
          "latest_summary",
        ].some((key) => !same(body[key], incoming[key]));
        const historyPlan = runsChanged
          ? planKanbanHistoryRestore(db, body.task.id, incoming, body)
          : undefined;
        if (runsChanged && !historyPlan) return result("deferred", current);
        for (const key of new Set([
          ...Object.keys(body),
          ...Object.keys(incoming),
        ])) {
          if (
            ![
              "task",
              "comments",
              "events",
              "dependencies",
              "parents",
              "children",
              ...(historyPlan ? ["runs", "latest_summary"] : []),
              ...(attachmentWriteback ? ["attachments"] : []),
            ].includes(key) &&
            !same(body[key], incoming[key])
          )
            return result("deferred", current);
        }
        const graphChanged = ["dependencies", "parents", "children"].some(
          (key) => !same(body[key], incoming[key]),
        );
        const graphPlan = graphChanged
          ? planKanbanDependencies(db, body.task.id, {
              dependencies: incoming.dependencies,
              parents: incoming.parents,
              children: incoming.children,
            })
          : undefined;
        if (graphChanged && !graphPlan) return result("deferred", current);
        const task = incoming.task as Record<string, JsonValue>;
        if (
          typeof task.title !== "string" ||
          !task.title.trim() ||
          task.title.length > 512 ||
          ("body" in task &&
            task.body !== null &&
            typeof task.body !== "string") ||
          ("priority" in task &&
            (!Number.isSafeInteger(task.priority) ||
              Number(task.priority) < -100 ||
              Number(task.priority) > 100)) ||
          typeof task.status !== "string" ||
          ![
            "triage",
            "todo",
            "scheduled",
            "ready",
            "running",
            "blocked",
            "review",
            "done",
            "archived",
          ].includes(task.status)
        )
          throw Error("Invalid native task metadata");

        const columns = (
          db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]
        ).map((row) => row.name);
        if (
          Object.keys(task).some(
            (key) => !columns.includes(key) && key !== "workspace_path",
          )
        )
          throw Error("Unsupported task field");
        if (
          task.workspace_path !== null ||
          kanbanDeviceFields.some((field) => field in task)
        )
          throw Error("Device paths and locks cannot be synchronized");
        if (
          task.status !== raw.status &&
          ["ready", "scheduled", "running"].includes(String(task.status))
        )
          return result("deferred", current);
        if (write.document.deleted && !columns.includes("archived"))
          return result("deferred", current);
        const values: Record<string, unknown> = {};
        for (const key of columns) {
          if (["id", "workspace_path", ...kanbanDeviceFields].includes(key))
            continue;
          if (!(key in task)) return result("deferred", current);
          const value = task[key];
          values[key] =
            key === "skills" && Array.isArray(value)
              ? JSON.stringify(value)
              : typeof value === "boolean"
                ? Number(value)
                : value;
          if (
            values[key] !== null &&
            !["string", "number"].includes(typeof values[key])
          )
            throw Error("Unsupported SQLite task value");
        }
        if (write.document.deleted) values.archived = 1;
        const fields = Object.keys(values);
        if (fields.some((key) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)))
          throw Error("Unsupported task schema");
        db.prepare(
          `UPDATE tasks SET ${fields.map((key) => `"${key}"=?`).join(",")} WHERE id=?`,
        ).run(...fields.map((key) => values[key]), body.task.id);
        historyPlan?.();
        const appliedGraph = graphPlan?.apply();
        if (
          attachmentWriteback &&
          !same(body.attachments, incoming.attachments)
        ) {
          const rawFiles = db
            .prepare("SELECT * FROM task_attachments WHERE task_id=?")
            .all(body.task.id) as Record<string, unknown>[];
          attachmentWriteback.apply(
            db,
            taskAttachmentRecords(body, write.document.id),
            rawFiles,
            write.operationId,
          );
        }
        const readRelated = (table: string): Record<string, JsonValue>[] => {
          const exists = db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table);
          if (!exists) return [];
          return db
            .prepare(`SELECT * FROM ${table} WHERE task_id=?`)
            .all(body.task.id) as Record<string, JsonValue>[];
        };
        const comments = projectKanbanHistory(
            db,
            body.task.id,
            "task_comments",
            readRelated("task_comments"),
          ),
          events = projectKanbanHistory(
            db,
            body.task.id,
            "task_events",
            readRelated("task_events"),
          );
        const updated = db
          .prepare("SELECT * FROM tasks WHERE id=?")
          .get(body.task.id) as Record<string, unknown>;
        const projected = portableKanbanTask(updated);
        const runHistory = projectKanbanHistory(
          db,
          body.task.id,
          "task_runs",
          readRelated("task_runs"),
        );
        const rawRuns = runHistory.raw;
        const rawAttachments = orderedKanbanAttachments(
          db,
          body.task.id,
          readRelated("task_attachments"),
        );
        const portableAttachments = rawAttachments.length
          ? attachmentProjection!(
              body.board,
              write.document.id,
              body.task.id,
              portableAttachmentRows(db, body.task.id, rawAttachments),
            )
          : [];
        if (
          !same(
            (attachmentWriteback ? incoming : body).attachments ?? [],
            json(portableAttachments),
          )
        )
          throw Error(
            "Original attachment changed during task edit; update rolled back",
          );
        const retainedBody = { ...body };
        if (incoming.attachments === undefined) delete retainedBody.attachments;
        const updatedRecord = {
          ...current,
          body: json({
            ...retainedBody,
            ...(appliedGraph
              ? {
                  dependencies: appliedGraph,
                  parents: appliedGraph
                    .filter((edge) => edge.child_id === body.task.id)
                    .map((edge) => edge.parent_id),
                  children: appliedGraph
                    .filter((edge) => edge.parent_id === body.task.id)
                    .map((edge) => edge.child_id),
                }
              : {}),
            task: projected,
            ...(historyPlan
              ? {
                  runs: runHistory.portable,
                  latest_summary: rawRuns.at(-1)?.summary ?? null,
                }
              : {}),
            ...(incoming.attachments !== undefined
              ? { attachments: json(portableAttachments) }
              : {}),
            comments: comments.portable,
            events: events.portable,
          }),
          version: createHash("sha256")
            .update(
              JSON.stringify([
                updated,
                comments.raw,
                events.raw,
                rawRuns,
                appliedGraph ?? body.dependencies,
                ...(rawAttachments.length
                  ? [{ rows: rawAttachments, resources: portableAttachments }]
                  : []),
              ]),
            )
            .digest("hex"),
        };
        const accepted = result("applied", updatedRecord);
        db.prepare("INSERT INTO mithril_replica_receipts VALUES(?,?,?)").run(
          write.operationId,
          fingerprint,
          JSON.stringify(accepted),
        );
        return accepted;
      })
      .immediate();
  } finally {
    db.close();
  }
}
async function replicaContext(write = false): Promise<{
  root: string;
  profile: string;
  userId: string;
  replicaId: string;
  context: Awaited<ReturnType<typeof cloudWorkspace.nativeContext>>;
}> {
  const context = await cloudWorkspace.nativeContext(write);
  if (getConnectionConfig().mode !== "local")
    throw Error("Native replica storage unavailable");
  const directory = join(app.getPath("userData"), "repository-source-owners");
  bindRepositorySource(directory, context.profile, context.userId);
  return {
    root:
      process.env.HERMES_KANBAN_HOME?.trim() || profileHome(context.profile),
    profile: context.profile,
    userId: context.userId,
    replicaId: repositoryReplicaId(directory, context.profile),
    context,
  };
}
/** Fixed original configuration descriptors; Skill bytes live in separate resources. No tests or installs run here. */
async function nativeCapabilitySource(
  source?: import("./profile-metadata-inventory").ProfileMetadataSource,
  captured?: Awaited<ReturnType<typeof cloudWorkspace.nativeContext>>,
): Promise<
  Awaited<
    ReturnType<import("@mithril/workspace/capability-data").CapabilitySeed>
  > & { configDigest: string }
> {
  const before = captured ?? (await cloudWorkspace.nativeContext());
  const profile = source?.profile ?? before.profile;
  if (source && !source.present) throw Error("Capability profile unavailable");
  if (captured) cloudWorkspace.assertNativeContext(captured);
  if (getConnectionConfig().mode !== "local")
    throw Error("Capability source unavailable for this runtime");
  bindRepositorySource(
    join(app.getPath("userData"), "repository-source-owners"),
    profile,
    before.userId,
  );
  const home = source?.root ?? profileHome(profile);
  checked(home);
  const originalDirectory = source ? lstatSync(home) : null;
  if (originalDirectory && !originalDirectory.isDirectory())
    throw Error("Capability profile unavailable");
  const { assertSkillResourcesReady } =
    await import("./skill-resource-replica");
  const skillStateRoot = join(
    app.getPath("userData"),
    "repository-skill-transactions",
  );
  assertSkillResourcesReady(join(home, "skills"), skillStateRoot);
  const configFile = join(home, "config.yaml");
  checked(configFile);
  const readConfig = (): Buffer => {
    if (captured) cloudWorkspace.assertNativeContext(captured);
    checked(configFile);
    if (!existsSync(configFile)) return Buffer.from("");
    const stat = lstatSync(configFile);
    if (!stat.isFile() || stat.size > 1048576)
      throw Error("Unsupported Capability configuration source");
    return readFileSync(configFile);
  };
  const config = readConfig();
  if (
    config.length > 1048576 ||
    !Buffer.from(config.toString("utf8")).equals(config)
  )
    throw Error("Unsupported Capability configuration source");
  const [{ getToolsets }, { listMcpServers }, { resourceCapabilityData }] =
    await Promise.all([
      import("./tools"),
      import("./mcp-servers"),
      import("@mithril/workspace/capability-data"),
    ]);
  if (captured) cloudWorkspace.assertNativeContext(captured);
  const toolsets = getToolsets(profile);
  const mcps = await listMcpServers(profile);
  if (captured) cloudWorkspace.assertNativeContext(captured);
  assertSkillResourcesReady(join(home, "skills"), skillStateRoot);
  const afterConfig = readConfig();
  if (!config.equals(afterConfig))
    throw Error("Capability changed during snapshot; original source retained");
  if (originalDirectory) {
    checked(home);
    const after = lstatSync(home);
    if (
      !after.isDirectory() ||
      after.ino !== originalDirectory.ino ||
      after.dev !== originalDirectory.dev
    )
      throw Error("Capability profile changed during capture");
  }
  const body = resourceCapabilityData(profile, toolsets, mcps);
  if (captured) cloudWorkspace.assertNativeContext(captured);
  else if (
    JSON.stringify(before) !==
    JSON.stringify(await cloudWorkspace.nativeContext())
  )
    throw Error("Workspace identity changed");
  return {
    userId: before.userId,
    profile,
    body,
    configDigest: createHash("sha256").update(config).digest("hex"),
  };
}
export async function nativeCapabilitySnapshot(): Promise<
  Awaited<
    ReturnType<import("@mithril/workspace/capability-data").CapabilitySeed>
  >
> {
  const { userId, profile, body } = await nativeCapabilitySource();
  return { userId, profile, body };
}

/** Fixed, account-bound original Memory files only; no directory scan or execution. */
export async function nativeMemorySnapshot(): Promise<{
  userId: string;
  profile: string;
  documents: import("@mithril/workspace/replica-sync").ReplicaRecord[];
}> {
  const before = await cloudWorkspace.nativeContext();
  if (getConnectionConfig().mode !== "local")
    throw Error("Memory source unavailable for this runtime");
  bindRepositorySource(
    join(app.getPath("userData"), "repository-source-owners"),
    before.profile,
    before.userId,
  );
  const documents = memoryReplicaSnapshot(
    profileHome(before.profile),
    before.profile,
  );
  if (
    JSON.stringify(before) !==
    JSON.stringify(await cloudWorkspace.nativeContext())
  )
    throw Error("Workspace identity changed");
  return { userId: before.userId, profile: before.profile, documents };
}
/** Captures original Skill paths privately, uploads bytes, then leaves pointer CAS to the replica journal. */
async function profileSkillResourceSnapshot(
  original?: import("./profile-metadata-inventory").ProfileMetadataSource,
  captured?: Awaited<ReturnType<typeof replicaContext>>,
): Promise<import("@mithril/workspace/replica-sync").ReplicaRecord> {
  const before = captured ?? (await replicaContext());
  const profile = original?.profile ?? before.profile;
  const home = original?.root ?? profileHome(profile);
  checked(home);
  const directory = lstatSync(home);
  if (!directory.isDirectory() || (original && !original.present))
    throw Error("Skill profile unavailable");
  const [
    { HERMES_PYTHON },
    { captureSkillResources, publishSkillResources },
    { capabilityId },
    { skillResourceId },
  ] = await Promise.all([
    import("./installer"),
    import("./skill-resource-snapshot"),
    import("@mithril/workspace/capability-data"),
    import("@mithril/workspace/capability-resources"),
  ]);
  const guard = async (): Promise<void> => {
    if (captured) cloudWorkspace.assertNativeContext(before.context);
    else if (
      JSON.stringify(before.context) !==
      JSON.stringify(await cloudWorkspace.nativeContext(true))
    )
      throw Error("Workspace identity changed; Skill resources retained");
    checked(home);
    const current = lstatSync(home);
    if (
      !current.isDirectory() ||
      current.ino !== directory.ino ||
      current.dev !== directory.dev
    )
      throw Error("Skill profile changed; original files retained");
    if (
      !repositorySourceOwned(
        join(app.getPath("userData"), "repository-source-owners"),
        profile,
        before.userId,
      )
    )
      throw Error("Skill profile owner changed");
  };
  await guard();
  const { assertSkillResourcesReady } =
    await import("./skill-resource-replica");
  await guard();
  assertSkillResourcesReady(
    join(home, "skills"),
    join(app.getPath("userData"), "repository-skill-transactions"),
  );
  const capture = captureSkillResources(
    join(home, "skills"),
    HERMES_PYTHON,
    join(app.getPath("userData"), "repository-skill-captures"),
    capabilityId(profile),
  );
  try {
    assertSkillResourcesReady(
      join(home, "skills"),
      join(app.getPath("userData"), "repository-skill-transactions"),
    );
    const manifest = await publishSkillResources(
      capture,
      cloudWorkspace.capabilityResources.forOwner(before.userId),
      guard,
    );
    assertSkillResourcesReady(
      join(home, "skills"),
      join(app.getPath("userData"), "repository-skill-transactions"),
    );
    await guard();
    const fresh = captureSkillResources(
      join(home, "skills"),
      HERMES_PYTHON,
      join(app.getPath("userData"), "repository-skill-captures"),
      capabilityId(profile),
    );
    try {
      if (fresh.digest !== capture.digest)
        throw Error(
          "Skill files changed during upload; original files retained",
        );
    } finally {
      fresh.dispose();
    }
    const body = {
      format: "mithril-skill-resources-v1",
      profile,
      capabilityId: capture.manifest.capabilityId,
      manifest,
    };
    return {
      collection: "capability",
      id: skillResourceId(profile),
      body,
      deleted: false,
      version: createHash("sha256")
        .update(repositoryFingerprint({ body, deleted: false }))
        .digest("hex"),
    };
  } finally {
    capture.dispose();
  }
}
export async function nativeSkillResourceSnapshot(): Promise<
  import("@mithril/workspace/replica-sync").ReplicaRecord
> {
  return profileSkillResourceSnapshot();
}
async function metadataSources(
  before: Awaited<ReturnType<typeof replicaContext>>,
): Promise<
  ReturnType<
    typeof import("./profile-metadata-inventory").profileMetadataInventory
  >
> {
  const [{ profileMetadataInventory }, { HERMES_HOME }] = await Promise.all([
    import("./profile-metadata-inventory"),
    import("./installer"),
  ]);
  if (
    JSON.stringify(before.context) !==
    JSON.stringify(await cloudWorkspace.nativeContext(true))
  )
    throw Error("Workspace identity changed");
  const directory = join(app.getPath("userData"), "repository-source-owners");
  return profileMetadataInventory(
    HERMES_HOME,
    directory,
    before.userId,
    (profile) => bindRepositorySource(directory, profile, before.userId),
  );
}
function profileMetadataPort(
  before: Awaited<ReturnType<typeof replicaContext>>,
  source: import("./profile-metadata-inventory").ProfileMetadataSource,
): Promise<import("./profile-metadata-port").ProfileMetadataPort> {
  return import("./profile-metadata-port").then(
    ({ ProfileMetadataPort }) =>
      new ProfileMetadataPort(
        {
          owner: before.userId,
          profile: source.profile,
          root: source.root,
          replicaId: before.replicaId,
        },
        join(app.getPath("userData"), "repository-profile-transactions"),
        cloudWorkspace.profileResources,
        async () => {
          // Reauthentication happens once in metadataSources at the operation boundary.
          // Between I/O stages, fence against token/account changes without per-profile auth requests.
          cloudWorkspace.assertNativeContext(before.context);
          if (
            !repositorySourceOwned(
              join(app.getPath("userData"), "repository-source-owners"),
              source.profile,
              before.userId,
            )
          )
            throw Error("Profile source identity changed");
        },
      ),
  );
}
export async function nativeReplicaSnapshot(): Promise<
  import("@mithril/workspace/replica-sync").ReplicaSnapshot
> {
  const before = await replicaContext();
  let inventoryPromise: ReturnType<typeof metadataSources> | undefined;
  const inventory = (): ReturnType<typeof metadataSources> =>
    (inventoryPromise ??= metadataSources(before));
  const snapshot: import("@mithril/workspace/replica-sync").ReplicaSnapshot = {
    schemaVersion: 1,
    userId: before.userId,
    replicaId: before.replicaId,
    complete: true,
    collections: [],
    documents: [],
    warnings: [],
  };
  try {
    if (process.env.HERMES_KANBAN_DB?.trim())
      throw Error("Custom Kanban storage");
    if (process.env.HERMES_KANBAN_ATTACHMENTS_ROOT?.trim())
      throw Error(
        "Custom Kanban attachments require a configured repository adapter",
      );
    const { HERMES_PYTHON } = await import("./installer");
    const capture = captureKanbanAttachments(
      before.root,
      HERMES_PYTHON,
      join(app.getPath("userData"), "repository-task-captures"),
    );
    try {
      const kanban = kanbanReplicaSnapshot(
        before.root,
        before.profile,
        before.userId,
        before.replicaId,
        capture.project,
      );
      await capture.publish(
        cloudWorkspace.taskAttachments.forOwner(before.userId),
        async () => {
          if (
            JSON.stringify(before.context) !==
            JSON.stringify(await cloudWorkspace.nativeContext())
          )
            throw Error(
              "Workspace identity changed; attachment files retained",
            );
        },
      );
      snapshot.collections.push(...kanban.collections);
      snapshot.documents.push(...kanban.documents);
    } finally {
      capture.dispose();
    }
  } catch {
    try {
      const boards = pendingKanbanBoards(before.root);
      if (boards.length) {
        snapshot.recoveryRecords = boards.map((id) => ({
          collection: "board" as const,
          id,
        }));
        snapshot.collections.push("board");
        (snapshot.recordScopes ??= []).push({ collection: "board", ids: [] });
      }
    } catch {
      // An unreadable Kanban DB retains its collection without suppressing independent sources.
    }
    snapshot.warnings!.push(
      "Kanban source requires synchronization review; original records are retained",
    );
  }
  try {
    const { profileMemoryInventory } =
      await import("./profile-memory-inventory");
    const memory = profileMemoryInventory((await inventory()).sources);
    cloudWorkspace.assertNativeContext(before.context);
    snapshot.collections.push("memory");
    (snapshot.recordScopes ??= []).push({
      collection: "memory",
      ids: memory.ids,
    });
    snapshot.documents.push(...memory.documents);
    snapshot.warnings!.push(...memory.warnings);
  } catch {
    snapshot.warnings!.push(
      "Memory source requires synchronization review; original files are retained",
    );
  }
  try {
    const sources = await inventory();
    const { capabilityId } = await import("@mithril/workspace/capability-data");
    snapshot.collections.push("capability");
    const scope = { collection: "capability" as const, ids: [] as string[] };
    (snapshot.recordScopes ??= []).push(scope);
    for (const source of sources.sources) {
      if (!source.present) continue;
      try {
        const capability = await nativeCapabilitySource(source, before.context);
        const id = capabilityId(source.profile);
        const body = capability.body as unknown as JsonValue;
        scope.ids.push(id);
        snapshot.documents.push({
          collection: "capability",
          id,
          body,
          deleted: false,
          version: createHash("sha256")
            .update(repositoryFingerprint({ body, deleted: false }))
            .digest("hex"),
        });
      } catch {
        snapshot.warnings!.push(
          `Profile ${source.profile} Capability source is unavailable; original configuration is retained`,
        );
      }
    }
  } catch {
    snapshot.warnings!.push(
      "Capability profile inventory is unavailable; original configuration is retained",
    );
  }
  try {
    const sources = await inventory();
    const [
      { hasPendingSkillResources },
      { capabilityId },
      { skillResourceId },
    ] = await Promise.all([
      import("./skill-resource-replica"),
      import("@mithril/workspace/capability-data"),
      import("@mithril/workspace/capability-resources"),
    ]);
    if (!snapshot.collections.includes("capability"))
      snapshot.collections.push("capability");
    const scopes = (snapshot.recordScopes ??= []);
    let scope = scopes.find((row) => row.collection === "capability");
    if (!scope) {
      scope = { collection: "capability", ids: [] };
      scopes.push(scope);
    }
    for (const source of sources.sources) {
      if (!source.present) continue;
      try {
        const resources = await profileSkillResourceSnapshot(source, before);
        scope.ids.push(resources.id);
        snapshot.documents.push(resources);
      } catch {
        cloudWorkspace.assertNativeContext(before.context);
        if (
          hasPendingSkillResources(
            join(source.root, "skills"),
            join(app.getPath("userData"), "repository-skill-transactions"),
            capabilityId(source.profile),
          )
        )
          (snapshot.recoveryRecords ??= []).push({
            collection: "capability",
            id: skillResourceId(source.profile),
          });
        snapshot.warnings!.push(
          `Profile ${source.profile} Skill synchronization requires review; original directories are retained`,
        );
      }
    }
  } catch {
    snapshot.warnings!.push(
      "Skill profile inventory is unavailable; original directories are retained",
    );
  }
  snapshot.collections.push("profile");
  const metadataScope = { collection: "profile" as const, ids: [] as string[] };
  (snapshot.recordScopes ??= []).push(metadataScope);
  try {
    const sources = await inventory();
    snapshot.warnings!.push(...sources.warnings);
    for (const source of sources.sources) {
      const id = `profile-metadata-${source.profile}`;
      try {
        const port = await profileMetadataPort(before, source);
        const metadata = await port.snapshot();
        metadataScope.ids.push(id);
        if (metadata) snapshot.documents.push(metadata);
      } catch {
        (snapshot.recoveryRecords ??= []).push({ collection: "profile", id });
        snapshot.warnings!.push(
          `Profile ${source.profile} metadata synchronization requires reconnect or conflict resolution; original data is retained`,
        );
      }
    }
  } catch {
    snapshot.warnings!.push(
      "Profile metadata inventory is unavailable; original data is retained",
    );
  }
  // Keep the existing bounded IPC schema usable when multiple profiles need review.
  if (snapshot.warnings!.length > 20)
    snapshot.warnings = [
      ...snapshot.warnings!.slice(0, 19),
      `${snapshot.warnings!.length - 19} additional synchronization sources require review`,
    ];
  if ((snapshot.recoveryRecords?.length ?? 0) > 100) {
    snapshot.recoveryRecords = snapshot.recoveryRecords!.slice(0, 100);
    snapshot.warnings = [
      ...snapshot.warnings!.slice(0, 19),
      "Additional unavailable sources are retained and will be reconsidered on the next snapshot",
    ];
  }
  if (!snapshot.collections.length)
    throw Error("Native sources require synchronization review");
  if (
    JSON.stringify(before.context) !==
    JSON.stringify(await cloudWorkspace.nativeContext())
  )
    throw Error("Workspace identity changed");
  return snapshot;
}
export async function nativeReplicaApply(
  write: import("@mithril/workspace/replica-sync").ReplicaWrite,
): Promise<import("@mithril/workspace/replica-sync").ReplicaResult> {
  const { validRepositoryDocument } =
    await import("@mithril/workspace/repository");
  if (
    !write ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(write.operationId) ||
    !validRepositoryDocument(write.document) ||
    (write.expectedVersion !== null &&
      !/^[a-zA-Z0-9_-]{1,128}$/.test(write.expectedVersion))
  )
    throw Error("Invalid replica operation");
  const { validReplicaRecord } =
    await import("@mithril/workspace/replica-sync");
  if (
    write.expectedRecord === null
      ? write.expectedVersion !== null
      : !validReplicaRecord(write.expectedRecord) ||
        write.expectedRecord.version !== write.expectedVersion ||
        write.expectedRecord.collection !== write.document.collection ||
        write.expectedRecord.id !== write.document.id
  )
    throw Error("Invalid replica source version");
  const before = await replicaContext(true);
  if (
    JSON.stringify(before.context) !==
    JSON.stringify(await cloudWorkspace.nativeContext(true))
  )
    throw Error("Workspace identity changed");
  let result: import("@mithril/workspace/replica-sync").ReplicaResult;
  if (write.document.collection === "profile") {
    const inventory = await metadataSources(before);
    const source = inventory.sources.find(
      (row) => write.document.id === `profile-metadata-${row.profile}`,
    );
    if (!source)
      throw Error("Profile metadata source is unavailable for this account");
    result = await (await profileMetadataPort(before, source)).apply(write);
  } else if (
    write.document.collection === "capability" &&
    write.document.id.startsWith("skill-resources-")
  ) {
    const [
      { validSkillResourcePointer, skillResourceId },
      { HERMES_PYTHON },
      { captureSkillResources, downloadSkillResources },
      { recoverSkillResources, applySkillResources, assertSkillResourcesReady },
    ] = await Promise.all([
      import("@mithril/workspace/capability-resources"),
      import("./installer"),
      import("./skill-resource-snapshot"),
      import("./skill-resource-replica"),
    ]);
    const body = write.document.body;
    const inventory = await metadataSources(before);
    const original = validSkillResourcePointer(body)
      ? inventory.sources.find(
          (row) =>
            row.present &&
            row.profile === body.profile &&
            write.document.id === skillResourceId(row.profile),
        )
      : undefined;
    if (!original)
      return {
        schemaVersion: 1,
        userId: before.userId,
        replicaId: before.replicaId,
        status: "deferred",
        record: null,
      };
    checked(original.root);
    const directory = lstatSync(original.root);
    const root = join(original.root, "skills");
    const stateRoot = join(
      app.getPath("userData"),
      "repository-skill-transactions",
    );
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([before.userId, before.replicaId, write]))
      .digest("hex");
    const guard = async (): Promise<void> => {
      if (
        JSON.stringify(before.context) !==
        JSON.stringify(await cloudWorkspace.nativeContext(true))
      )
        throw Error("Workspace identity changed");
      checked(original.root);
      const current = lstatSync(original.root);
      if (
        !current.isDirectory() ||
        current.ino !== directory.ino ||
        current.dev !== directory.dev
      )
        throw Error("Skill profile changed");
      if (
        !repositorySourceOwned(
          join(app.getPath("userData"), "repository-source-owners"),
          original.profile,
          before.userId,
        )
      )
        throw Error("Skill profile owner changed");
    };
    const observedResult = (
      status: import("@mithril/workspace/replica-sync").ReplicaResult["status"],
      record:
        | import("@mithril/workspace/replica-sync").ReplicaRecord
        | null = null,
    ): import("@mithril/workspace/replica-sync").ReplicaResult => ({
      schemaVersion: 1,
      userId: before.userId,
      replicaId: before.replicaId,
      status,
      record,
    });
    if (
      write.document.deleted ||
      !validSkillResourcePointer(body) ||
      body.profile !== original.profile ||
      write.document.id !== skillResourceId(original.profile)
    ) {
      result = observedResult("deferred");
    } else {
      await guard();
      const replay = recoverSkillResources(
        root,
        HERMES_PYTHON,
        stateRoot,
        write.operationId,
        fingerprint,
      );
      const target = {
        collection: write.document.collection,
        id: write.document.id,
        body,
        deleted: false,
        version: createHash("sha256")
          .update(repositoryFingerprint(write.document))
          .digest("hex"),
      };
      if (replay !== "missing") {
        result = observedResult(replay, replay === "applied" ? target : null);
      } else {
        assertSkillResourcesReady(root, stateRoot);
        const source = captureSkillResources(
          root,
          HERMES_PYTHON,
          join(app.getPath("userData"), "repository-skill-captures"),
          body.capabilityId,
        );
        try {
          const sourceBody = {
            format: "mithril-skill-resources-v1",
            profile: original.profile,
            capabilityId: body.capabilityId,
            manifest: source.digest,
          };
          const observed = {
            ...target,
            body: sourceBody,
            version: createHash("sha256")
              .update(
                repositoryFingerprint({ body: sourceBody, deleted: false }),
              )
              .digest("hex"),
          };
          if (
            (write.expectedRecord === null &&
              source.manifest.files.length > 0) ||
            (write.expectedRecord !== null &&
              (repositoryFingerprint(write.expectedRecord) !==
                repositoryFingerprint(observed) ||
                write.expectedVersion !== observed.version))
          ) {
            result = observedResult("conflict", observed);
          } else {
            const downloaded = await downloadSkillResources(
              body,
              cloudWorkspace.capabilityResources.forOwner(before.userId),
              join(app.getPath("userData"), "repository-skill-captures"),
              guard,
            );
            try {
              await guard();
              const applied = applySkillResources(
                root,
                HERMES_PYTHON,
                stateRoot,
                write.operationId,
                fingerprint,
                source,
                downloaded,
              );
              result = observedResult(
                applied === "missing" ? "deferred" : applied,
                applied === "applied" ? target : null,
              );
            } finally {
              downloaded.dispose();
            }
          }
        } finally {
          source.dispose();
        }
      }
    }
  } else if (write.document.collection === "capability") {
    const { validCapabilityData, capabilityId } =
      await import("@mithril/workspace/capability-data");
    const sources = await metadataSources(before);
    const body = write.document.body;
    const original = validCapabilityData(body)
      ? sources.sources.find(
          (row) =>
            row.present &&
            row.profile === body.profile &&
            write.document.id === capabilityId(row.profile),
        )
      : undefined;
    if (!original)
      return {
        schemaVersion: 1,
        userId: before.userId,
        replicaId: before.replicaId,
        status: "deferred",
        record: null,
      };
    const source = await nativeCapabilitySource(original, before.context);
    const [{ HERMES_PYTHON }, { applyCapabilityConfigReplica }] =
      await Promise.all([
        import("./installer"),
        import("./capability-config-replica"),
      ]);
    if (
      JSON.stringify(before.context) !==
      JSON.stringify(await cloudWorkspace.nativeContext(true))
    )
      throw Error("Workspace identity changed");
    result = applyCapabilityConfigReplica(
      original.root,
      before.userId,
      before.replicaId,
      HERMES_PYTHON,
      source.body,
      write,
      source.configDigest,
    );
  } else if (write.document.collection === "memory") {
    const [{ HERMES_PYTHON }, { profileMemorySource }] = await Promise.all([
      import("./installer"),
      import("./profile-memory-inventory"),
    ]);
    const sources = await metadataSources(before);
    // Revalidate account authority before selecting the owned original working copy.
    if (
      JSON.stringify(before.context) !==
      JSON.stringify(await cloudWorkspace.nativeContext(true))
    )
      throw Error("Workspace identity changed");
    const source = profileMemorySource(sources.sources, write.document);
    if (!source)
      return {
        schemaVersion: 1,
        userId: before.userId,
        replicaId: before.replicaId,
        status: "deferred",
        record: null,
      };
    try {
      result = applyMemoryReplica(
        source.root,
        source.profile,
        before.userId,
        before.replicaId,
        HERMES_PYTHON,
        write,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Memory operation was reused"
      )
        throw error;
      result = {
        schemaVersion: 1,
        userId: before.userId,
        replicaId: before.replicaId,
        status: "deferred",
        record: null,
      };
    }
  } else {
    if (process.env.HERMES_KANBAN_DB?.trim())
      return {
        schemaVersion: 1,
        userId: before.userId,
        replicaId: before.replicaId,
        status: "deferred",
        record: null,
      };
    if (process.env.HERMES_KANBAN_ATTACHMENTS_ROOT?.trim())
      return {
        schemaVersion: 1,
        userId: before.userId,
        replicaId: before.replicaId,
        status: "deferred",
        record: null,
      };
    const { HERMES_PYTHON, HERMES_REPO } = await import("./installer");
    if (
      JSON.stringify(before.context) !==
      JSON.stringify(await cloudWorkspace.nativeContext(true))
    )
      throw Error("Workspace identity changed");
    const capture = captureKanbanAttachments(
      before.root,
      HERMES_PYTHON,
      join(app.getPath("userData"), "repository-task-captures"),
    );
    let attachments: KanbanAttachmentWriteback | undefined;
    const groupAttachmentPlans = new Map<string, KanbanAttachmentWriteback>();
    try {
      const retained = retainedTaskReceipt(
        before.root,
        before.userId,
        before.replicaId,
        write,
      );
      if (retained) return retained;
      if (
        write.document.collection === "task" &&
        ((write.expectedRecord === null &&
          (write.document.body as Record<string, JsonValue>).attachments !==
            undefined) ||
          repositoryFingerprint({
            body:
              (write.document.body as Record<string, JsonValue>).attachments ??
              null,
            deleted: false,
          }) !==
            repositoryFingerprint({
              body:
                (
                  write.expectedRecord?.body as
                    | Record<string, JsonValue>
                    | undefined
                )?.attachments ?? null,
              deleted: false,
            }))
      ) {
        attachments = await prepareKanbanAttachmentWriteback(
          before.root,
          HERMES_PYTHON,
          join(app.getPath("userData"), "repository-task-restores"),
          write.document.id,
          write.document.body,
          cloudWorkspace.taskAttachments.forOwner(before.userId),
          async () => {
            if (
              JSON.stringify(before.context) !==
              JSON.stringify(await cloudWorkspace.nativeContext(true))
            )
              throw Error("Workspace identity changed");
          },
        );
      }
      const incoming = write.document.body as Record<string, JsonValue>;
      const groupDocuments =
        write.document.collection === "task" &&
        write.expectedRecord === null &&
        Array.isArray(incoming.dependencies) &&
        incoming.dependencies.length
          ? await readStableKanbanTasks(
              (after) => cloudWorkspace.repositoryPage("task", after),
              before.userId,
              async () => {
                if (
                  JSON.stringify(before.context) !==
                  JSON.stringify(await cloudWorkspace.nativeContext(true))
                )
                  throw Error("Workspace identity changed");
              },
            )
          : undefined;
      if (groupDocuments) {
        const board = incoming.board;
        if (
          typeof board !== "string" ||
          !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(board)
        )
          throw Error("Invalid native board");
        const file =
          board === "default"
            ? join(before.root, "kanban.db")
            : join(before.root, "kanban", "boards", board, "kanban.db");
        checked(file);
        if (!existsSync(file))
          return {
            schemaVersion: 1,
            userId: before.userId,
            replicaId: before.replicaId,
            status: "deferred",
            record: null,
          };
        const db = new Database(file, { readonly: true, fileMustExist: true });
        let nodes: ReturnType<typeof selectKanbanTaskGroup>;
        try {
          nodes = selectKanbanTaskGroup(db, write.document, groupDocuments);
        } finally {
          db.close();
        }
        if (!nodes)
          return {
            schemaVersion: 1,
            userId: before.userId,
            replicaId: before.replicaId,
            status: "deferred",
            record: null,
          };
        for (const document of nodes.values()) {
          if (
            document.id === write.document.id ||
            (document.body as Record<string, JsonValue>).attachments ===
              undefined
          )
            continue;
          const plan = await prepareKanbanAttachmentWriteback(
            before.root,
            HERMES_PYTHON,
            join(app.getPath("userData"), "repository-task-restores"),
            document.id,
            document.body,
            cloudWorkspace.taskAttachments.forOwner(before.userId),
            async () => {
              if (
                JSON.stringify(before.context) !==
                JSON.stringify(await cloudWorkspace.nativeContext(true))
              )
                throw Error("Workspace identity changed");
            },
          );
          groupAttachmentPlans.set(document.id, plan);
        }
        if (
          JSON.stringify(before.context) !==
          JSON.stringify(await cloudWorkspace.nativeContext(true))
        )
          throw Error("Workspace identity changed");
      }
      result = applyKanbanReplica(
        before.root,
        before.profile,
        before.userId,
        before.replicaId,
        write,
        capture.project,
        attachments,
        HERMES_PYTHON,
        supportsKanbanMetadataReplacement(HERMES_REPO),
        groupDocuments,
        groupAttachmentPlans,
      );
    } finally {
      attachments?.dispose();
      for (const plan of groupAttachmentPlans.values()) plan.dispose();
      capture.dispose();
    }
  }
  if (
    JSON.stringify(before.context) !==
    JSON.stringify(await cloudWorkspace.nativeContext(true))
  )
    throw Error("Workspace identity changed");
  return result;
}
