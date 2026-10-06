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
import { createHash } from "crypto";
import { profileHome } from "./utils";
import { cloudWorkspace } from "./cloud-workspace-runtime";
import { getConnectionConfig } from "./config";
import { validBody, type JsonValue } from "@mithril/workspace/repository";
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
/** Read rich board data in one SQLite snapshot. Never switches boards or invokes an agent. */
export function kanbanRepositorySeed(
  root: string,
  profile: string,
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
        ]);
        if (
          [...tables].some(
            (name) => name.startsWith("task_") && !supported.has(name),
          )
        )
          throw Error("Unsupported Kanban relationships; source data retained");
        const read = (table: string): Record<string, unknown>[] =>
          tables.has(table)
            ? (db.prepare(`SELECT * FROM ${table}`).all() as Record<
                string,
                unknown
              >[])
            : [];
        const tasks = read("tasks"),
          comments = read("task_comments"),
          events = read("task_events"),
          runs = read("task_runs"),
          dependencies = read("task_dependencies");
        documents.push({
          collection: "board",
          id: slug,
          body: json({
            slug,
            name: slug === "default" ? "Default" : slug,
            is_current: false,
            total: tasks.length,
            counts: {},
          }),
        });
        for (const raw of tasks) {
          const task = { ...raw, workspace_path: null };
          delete (task as Record<string, unknown>).claim_lock;
          for (const field of ["skills"])
            if (typeof (task as Record<string, unknown>)[field] === "string")
              (task as Record<string, unknown>)[field] = JSON.parse(
                (task as Record<string, unknown>)[field] as string,
              );
          const id = String(raw.id),
            key = createHash("sha256")
              .update(JSON.stringify([profile, slug, id]))
              .digest("hex");
          const taskEvents = events
            .filter((r) => r.task_id === id)
            .map((r) => ({
              ...r,
              payload:
                typeof r.payload === "string"
                  ? JSON.parse(r.payload)
                  : r.payload,
            }));
          const taskRuns = runs.filter((r) => r.task_id === id);
          documents.push({
            collection: "task",
            id: key,
            body: json({
              board: slug,
              task,
              comments: comments.filter((r) => r.task_id === id),
              events: taskEvents,
              runs: taskRuns,
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
              latest_summary: taskRuns.at(-1)?.summary ?? null,
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
  const documents = kanbanRepositorySeed(
    process.env.HERMES_KANBAN_HOME?.trim() || profileHome(before.profile),
    before.profile,
  );
  const after = await cloudWorkspace.nativeContext();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error("Workspace identity changed");
  return { userId: after.userId, documents };
}
