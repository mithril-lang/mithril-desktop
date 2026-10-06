import type Database from "better-sqlite3";
import { createHash } from "crypto";
import {
  repositoryFingerprint,
  validRepositoryPage,
  type RepositoryPage,
  type JsonValue,
  type RepositoryDocument,
} from "@mithril/workspace/repository";
import type { TaskAttachment } from "@mithril/workspace/task-attachments";
import { restoreKanbanTask } from "./kanban-task-restore";
import { planKanbanDependencies } from "./kanban-dependency-replica";
import { portableKanbanTask } from "./kanban-portable-record";
import { projectKanbanHistory } from "./kanban-history-identity";

/** Read-only selection; apply rechecks this inventory under its writer transaction. */
export function selectKanbanTaskGroup(
  db: Database.Database,
  requested: RepositoryDocument,
  documents: RepositoryDocument[],
): Map<string, RepositoryDocument> | null {
  const root = requested.body as Record<string, JsonValue>;
  const rootTask = root.task as Record<string, JsonValue>;
  if (
    typeof rootTask?.id !== "string" ||
    typeof root.board !== "string" ||
    documents.length > 4096
  )
    return null;
  const byTask = new Map<string, RepositoryDocument>();
  for (const document of documents) {
    const body = document.body as Record<string, JsonValue>;
    const task = body?.task as Record<string, JsonValue>;
    if (
      document.collection !== "task" ||
      document.deleted ||
      body?.board !== root.board
    )
      continue;
    if (typeof task?.id !== "string" || byTask.has(task.id)) return null;
    byTask.set(task.id, document);
  }
  const retained = byTask.get(rootTask.id);
  if (
    !retained ||
    retained.id !== requested.id ||
    retained.revision !== requested.revision ||
    repositoryFingerprint(retained) !== repositoryFingerprint(requested)
  )
    return null;
  const nodes = new Map<string, RepositoryDocument>();
  const queue = [rootTask.id];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (nodes.has(id)) continue;
    if (db.prepare("SELECT 1 FROM tasks WHERE id=?").get(id)) continue;
    const document = byTask.get(id);
    if (!document || nodes.size >= 1000) return null;
    nodes.set(id, document);
    const body = document.body as Record<string, JsonValue>;
    if (!Array.isArray(body.dependencies) || body.dependencies.length > 20000)
      return null;
    for (const value of body.dependencies) {
      const edge = value as Record<string, JsonValue>;
      if (
        typeof edge?.parent_id !== "string" ||
        typeof edge.child_id !== "string" ||
        (edge.parent_id !== id && edge.child_id !== id)
      )
        return null;
      if (queue.length > 80000) return null;
      queue.push(edge.parent_id, edge.child_id);
    }
  }
  if (!nodes.has(rootTask.id)) return null;
  return nodes;
}

/** Restore missing connected nodes and their relationships in one writer savepoint. */
export function restoreKanbanTaskGroup(
  db: Database.Database,
  requested: RepositoryDocument,
  documents: RepositoryDocument[],
  restoreAttachments?: (
    document: RepositoryDocument,
  ) =>
    | (() => { rows: Record<string, unknown>[]; resources: TaskAttachment[] })
    | undefined,
): { body: JsonValue; version: string } | null {
  if (!db.inTransaction)
    throw Error("Task group requires a writer transaction");
  const deferred = new Error("Task group deferred");
  const refuse = (): never => {
    throw deferred;
  };
  try {
    return db.transaction(() => {
      const nodes = selectKanbanTaskGroup(db, requested, documents);
      if (!nodes) return refuse();
      const rootTask = (requested.body as { task: { id: string } }).task;
      const files = new Map<
        string,
        { rows: Record<string, unknown>[]; resources: TaskAttachment[] }
      >();
      // Every new node must agree on shared edges before any source is committed.
      for (const [id, document] of nodes) {
        const body = document.body as Record<string, JsonValue>;
        for (const value of body.dependencies as JsonValue[]) {
          const edge = value as Record<string, JsonValue>;
          const other = nodes.get(
            String(edge.parent_id === id ? edge.child_id : edge.parent_id),
          );
          if (
            other &&
            !(
              (other.body as Record<string, JsonValue>)
                .dependencies as JsonValue[]
            ).some(
              (candidate) =>
                repositoryFingerprint({ body: candidate, deleted: false }) ===
                repositoryFingerprint({ body: value, deleted: false }),
            )
          )
            return refuse();
        }
        const attachmentPlan = restoreAttachments?.(document);
        if (
          Array.isArray(body.attachments) &&
          body.attachments.length &&
          !attachmentPlan
        )
          return refuse();
        const staged = restoreKanbanTask(
          db,
          document.id,
          { ...body, dependencies: [], parents: [], children: [] },
          attachmentPlan
            ? () => {
                const value = attachmentPlan();
                files.set(id, value);
                return value;
              }
            : undefined,
          true,
        );
        if (!staged) return refuse();
        if (body.attachments !== undefined && !attachmentPlan) {
          if (!Array.isArray(body.attachments) || body.attachments.length)
            return refuse();
          db.exec(
            "CREATE TABLE IF NOT EXISTS mithril_attachment_projection(task_id TEXT PRIMARY KEY,attachment_ids TEXT NOT NULL DEFAULT '[]')",
          );
          db.prepare(
            "INSERT INTO mithril_attachment_projection(task_id,attachment_ids) VALUES(?,?)",
          ).run(id, "[]");
        }
      }
      const records = new Map<string, { body: JsonValue; version: string }>();
      for (const [id, document] of nodes) {
        const body = document.body as Record<string, JsonValue>;
        const plan = planKanbanDependencies(db, id, body);
        if (!plan) return refuse();
        plan.apply();
      }
      for (const [id, document] of nodes) {
        const body = document.body as Record<string, JsonValue>;
        const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
        const comments = projectKanbanHistory(
          db,
          id,
          "task_comments",
          db
            .prepare("SELECT * FROM task_comments WHERE task_id=?")
            .all(id) as Record<string, unknown>[],
        );
        const events = projectKanbanHistory(
          db,
          id,
          "task_events",
          db
            .prepare("SELECT * FROM task_events WHERE task_id=?")
            .all(id) as Record<string, unknown>[],
        );
        const runs = projectKanbanHistory(
          db,
          id,
          "task_runs",
          db
            .prepare("SELECT * FROM task_runs WHERE task_id=?")
            .all(id) as Record<string, unknown>[],
        );
        const table = db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_links'",
          )
          .get()
          ? "task_links"
          : "task_dependencies";
        const edges = db
          .prepare(`SELECT * FROM ${table} LIMIT 20001`)
          .all() as Record<string, JsonValue>[];
        const dependencies = edges.filter(
          (edge) => edge.parent_id === id || edge.child_id === id,
        );
        const attachments = files.get(id);
        const restored = {
          ...body,
          ...(attachments
            ? { attachments: attachments.resources as unknown as JsonValue }
            : {}),
          task: portableKanbanTask(task as Record<string, unknown>),
          comments: comments.portable,
          events: events.portable,
          runs: runs.portable,
          dependencies,
          parents: dependencies
            .filter((e) => e.child_id === id)
            .map((e) => e.parent_id),
          children: dependencies
            .filter((e) => e.parent_id === id)
            .map((e) => e.child_id),
        };
        if (
          repositoryFingerprint({ body: restored, deleted: false }) !==
          repositoryFingerprint(document)
        )
          return refuse();
        records.set(id, {
          body: restored,
          version: createHash("sha256")
            .update(
              JSON.stringify([
                task,
                comments.raw,
                events.raw,
                runs.raw,
                dependencies,
                ...(attachments?.rows.length
                  ? [
                      {
                        rows: attachments.rows,
                        resources: attachments.resources,
                      },
                    ]
                  : []),
              ]),
            )
            .digest("hex"),
        });
      }
      return records.get(rootTask.id)!;
    })();
  } catch (error) {
    if (error === deferred) return null;
    throw error;
  }
}

/** Complete, owner-checked repeat reads prevent adopting a torn cloud component. */
export async function readStableKanbanTasks(
  page: (after?: string) => Promise<RepositoryPage>,
  owner: string,
  guard: () => Promise<void>,
): Promise<RepositoryDocument[]> {
  const read = async (): Promise<RepositoryDocument[]> => {
    const documents: RepositoryDocument[] = [];
    const seen = new Set<string>();
    let after: string | undefined;
    for (let count = 0; count < 64; count++) {
      await guard();
      const result = await page(after);
      await guard();
      if (
        !validRepositoryPage(result, "task", after) ||
        result.userId !== owner
      )
        throw Error("Task component owner/page changed");
      for (const document of result.documents) {
        if (seen.has(document.id) || documents.length >= 4096)
          throw Error("Task component inventory incomplete");
        seen.add(document.id);
        documents.push(document);
      }
      if (result.nextAfter === null) return documents;
      after = result.nextAfter;
    }
    throw Error("Task component inventory incomplete");
  };
  const first = await read(),
    second = await read();
  if (JSON.stringify(first) !== JSON.stringify(second))
    throw Error("Task component revisions changed");
  return second;
}
