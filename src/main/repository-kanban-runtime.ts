import { memoryFileId, memoryFileKinds } from "@mithril/workspace/memory-files";
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
/** Read rich board data in one SQLite snapshot. Never switches boards or invokes an agent. */
export function kanbanRepositorySeed(
  root: string,
  profile: string,
  versions?: Map<string, string>,
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
        const read = (
          table: string,
          limit = 20000,
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
          dependencies = read("task_dependencies");
        versions?.set(
          "board:" + slug,
          createHash("sha256")
            .update(JSON.stringify([slug, tasks]))
            .digest("hex"),
        );
        documents.push({
          collection: "board",
          id: slug,
          body: json({
            slug,
            name: slug === "default" ? "Default" : slug,
            is_current: false,
            total: 0,
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
          versions?.set(
            "task:" + key,
            createHash("sha256")
              .update(
                JSON.stringify([
                  raw,
                  comments.filter((r) => r.task_id === id),
                  taskEvents,
                  taskRuns,
                  dependencies.filter(
                    (r) =>
                      r.task_id === id ||
                      r.parent_id === id ||
                      r.child_id === id,
                  ),
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
): import("@mithril/workspace/replica-sync").ReplicaSnapshot {
  const versions = new Map<string, string>();
  const documents = kanbanRepositorySeed(root, profile, versions);
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
/** Applies existing task metadata under the same SQLite writer lock as the device agent. */
export function applyKanbanReplica(
  root: string,
  profile: string,
  userId: string,
  replicaId: string,
  write: import("@mithril/workspace/replica-sync").ReplicaWrite,
): import("@mithril/workspace/replica-sync").ReplicaResult {
  const snapshot =
    (): import("@mithril/workspace/replica-sync").ReplicaSnapshot =>
      kanbanReplicaSnapshot(root, profile, userId, replicaId);
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
  if (!observed || write.document.collection !== "task")
    return result("deferred");
  const body = observed.body as {
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
            (row) => row.collection === "task" && row.id === observed.id,
          ) ?? null;
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
        // Run receipts and dependency graphs need their own schema-aware adapter; never replay or erase them.
        const same = (
          a: JsonValue | undefined,
          b: JsonValue | undefined,
        ): boolean =>
          a === undefined || b === undefined
            ? a === b
            : repositoryFingerprint({ body: a, deleted: false }) ===
              repositoryFingerprint({ body: b, deleted: false });
        for (const key of new Set([
          ...Object.keys(body),
          ...Object.keys(incoming),
        ])) {
          if (
            !["task", "comments", "events"].includes(key) &&
            !same(body[key], incoming[key])
          )
            return result("deferred", current);
        }
        const additions: { table: string; values: Record<string, unknown> }[] =
          [];
        for (const [key, table] of [
          ["comments", "task_comments"],
          ["events", "task_events"],
        ]) {
          if (same(body[key], incoming[key])) continue;
          if (!Array.isArray(body[key]) || !Array.isArray(incoming[key]))
            throw Error("Invalid task history");
          const oldRows = body[key] as Record<string, JsonValue>[],
            newRows = incoming[key] as Record<string, JsonValue>[];
          if (
            newRows.length > 20000 ||
            !oldRows.every((row) => newRows.some((next) => same(row, next)))
          )
            return result("deferred", current);
          const schema = (
            db.prepare(`PRAGMA table_info(${table})`).all() as {
              name: string;
            }[]
          ).map((row) => row.name);
          if (
            !schema.includes("id") ||
            !schema.includes("task_id") ||
            schema.some((name) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
          )
            return result("deferred", current);
          const ids = new Set<string>();
          for (const row of newRows) {
            if (
              !row ||
              typeof row !== "object" ||
              !Number.isSafeInteger(row.id) ||
              row.task_id !== body.task.id ||
              ids.has(String(row.id))
            )
              throw Error("Invalid task history identity");
            ids.add(String(row.id));
            if (oldRows.some((old) => same(old, row))) continue;
            if (
              Object.keys(row).some(
                (field) => !schema.includes(field) && row[field] !== null,
              )
            )
              return result("deferred", current);
            const values: Record<string, unknown> = {};
            for (const field of schema)
              if (field in row) {
                const value = row[field];
                values[field] =
                  field === "payload" ? JSON.stringify(value) : value;
                if (
                  values[field] !== null &&
                  !["string", "number"].includes(typeof values[field])
                )
                  throw Error("Unsupported history field");
              }
            if (db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(row.id))
              return result("deferred", current);
            additions.push({ table, values });
          }
        }
        const task = incoming.task as Record<string, JsonValue>;
        if (
          typeof task.title !== "string" ||
          !task.title.trim() ||
          task.title.length > 512 ||
          ("body" in task && typeof task.body !== "string") ||
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
        if (task.workspace_path !== null || "claim_lock" in task)
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
          if (["id", "workspace_path", "claim_lock"].includes(key)) continue;
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
        for (const addition of additions) {
          const keys = Object.keys(addition.values);
          db.prepare(
            `INSERT INTO ${addition.table} (${keys.map((key) => `"${key}"`).join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
          ).run(...keys.map((key) => addition.values[key]));
        }
        const readRelated = (table: string): Record<string, JsonValue>[] => {
          const exists = db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table);
          if (!exists) return [];
          return (
            db
              .prepare(`SELECT * FROM ${table} WHERE task_id=?`)
              .all(body.task.id) as Record<string, JsonValue>[]
          ).map((row) =>
            table === "task_events" && typeof row.payload === "string"
              ? { ...row, payload: JSON.parse(row.payload) }
              : row,
          );
        };
        const comments = readRelated("task_comments"),
          events = readRelated("task_events");
        // Read our uncommitted update from this connection, then construct the exact sanitized projection.
        const updated = db
          .prepare("SELECT * FROM tasks WHERE id=?")
          .get(body.task.id) as Record<string, unknown>;
        const projected: Record<string, unknown> = {
          ...updated,
          workspace_path: null,
        };
        delete (projected as Record<string, unknown>).claim_lock;
        if (typeof projected.skills === "string")
          projected.skills = JSON.parse(projected.skills);
        const updatedRecord = {
          ...current,
          body: json({ ...body, task: projected, comments, events }),
          version: createHash("sha256")
            .update(
              JSON.stringify([
                updated,
                comments,
                events,
                body.runs,
                body.dependencies,
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
/** Fixed original capability descriptors and installed skill bodies; no tests or installs run here. */
async function nativeCapabilitySource(): Promise<
  Awaited<
    ReturnType<import("@mithril/workspace/capability-data").CapabilitySeed>
  > & { configDigest: string }
> {
  const before = await cloudWorkspace.nativeContext();
  if (getConnectionConfig().mode !== "local")
    throw Error("Capability source unavailable for this runtime");
  bindRepositorySource(
    join(app.getPath("userData"), "repository-source-owners"),
    before.profile,
    before.userId,
  );
  const home = profileHome(before.profile);
  checked(home);
  const configFile = join(home, "config.yaml");
  checked(configFile);
  const readConfig = (): Buffer => {
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
  const [
    { getToolsets },
    { listMcpServers },
    { listInstalledSkills, getSkillContent },
    { sharedCapabilityData },
  ] = await Promise.all([
    import("./tools"),
    import("./mcp-servers"),
    import("./skills"),
    import("@mithril/workspace/capability-data"),
  ]);
  const toolsets = getToolsets(before.profile);
  const mcps = await listMcpServers(before.profile);
  const skills = listInstalledSkills(before.profile, true).map((skill) => ({
    name: skill.name,
    category: skill.category,
    description: skill.description,
    content: getSkillContent(skill.path, true),
  }));
  const afterConfig = readConfig();
  if (!config.equals(afterConfig))
    throw Error("Capability changed during snapshot; original source retained");
  const body = sharedCapabilityData(before.profile, toolsets, mcps, skills);
  if (
    JSON.stringify(before) !==
    JSON.stringify(await cloudWorkspace.nativeContext())
  )
    throw Error("Workspace identity changed");
  return {
    userId: before.userId,
    profile: before.profile,
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
export async function nativeSkillResourceSnapshot(): Promise<
  import("@mithril/workspace/replica-sync").ReplicaRecord
> {
  const before = await replicaContext();
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
    if (
      JSON.stringify(before.context) !==
      JSON.stringify(await cloudWorkspace.nativeContext(true))
    )
      throw Error("Workspace identity changed; Skill resources retained");
  };
  await guard();
  const capture = captureSkillResources(
    join(profileHome(before.profile), "skills"),
    HERMES_PYTHON,
    join(app.getPath("userData"), "repository-skill-captures"),
    capabilityId(before.profile),
  );
  try {
    const manifest = await publishSkillResources(
      capture,
      cloudWorkspace.capabilityResources.forOwner(before.userId),
      guard,
    );
    const body = {
      format: "mithril-skill-resources-v1",
      profile: before.profile,
      capabilityId: capture.manifest.capabilityId,
      manifest,
    };
    return {
      collection: "capability",
      id: skillResourceId(before.profile),
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
export async function nativeReplicaSnapshot(): Promise<
  import("@mithril/workspace/replica-sync").ReplicaSnapshot
> {
  const before = await replicaContext();
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
    const kanban = kanbanReplicaSnapshot(
      before.root,
      before.profile,
      before.userId,
      before.replicaId,
    );
    snapshot.collections.push(...kanban.collections);
    snapshot.documents.push(...kanban.documents);
  } catch {
    snapshot.warnings!.push(
      "Kanban source requires synchronization review; original records are retained",
    );
  }
  try {
    const memory = memoryReplicaSnapshot(
      profileHome(before.profile),
      before.profile,
    );
    snapshot.collections.push("memory");
    snapshot.recordScopes = [
      {
        collection: "memory",
        ids: memoryFileKinds.map((kind) => memoryFileId(before.profile, kind)),
      },
    ];
    snapshot.documents.push(...memory);
  } catch {
    snapshot.warnings!.push(
      "Memory source requires synchronization review; original files are retained",
    );
  }
  try {
    const capability = await nativeCapabilitySnapshot();
    const { capabilityId } = await import("@mithril/workspace/capability-data");
    const id = capabilityId(before.profile);
    snapshot.collections.push("capability");
    (snapshot.recordScopes ??= []).push({
      collection: "capability",
      ids: [id],
    });
    const body = capability.body as unknown as JsonValue;
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
      "Capability source requires synchronization review; original configuration is retained",
    );
  }
  try {
    const resources = await nativeSkillResourceSnapshot();
    if (!snapshot.collections.includes("capability"))
      snapshot.collections.push("capability");
    const scopes = (snapshot.recordScopes ??= []);
    let scope = scopes.find((row) => row.collection === "capability");
    if (!scope) {
      scope = { collection: "capability", ids: [] };
      scopes.push(scope);
    }
    scope.ids.push(resources.id);
    snapshot.documents.push(resources);
  } catch {
    snapshot.warnings!.push(
      "Skill resource synchronization requires review or reconnect; original directories are retained",
    );
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
  if (
    write.document.collection === "capability" &&
    write.document.id.startsWith("skill-resources-")
  ) {
    // Resource downloads need their own receipt-backed directory transaction, not the YAML writer.
    result = {
      schemaVersion: 1,
      userId: before.userId,
      replicaId: before.replicaId,
      status: "deferred",
      record: null,
    };
  } else if (write.document.collection === "capability") {
    const source = await nativeCapabilitySource();
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
      profileHome(before.profile),
      before.userId,
      before.replicaId,
      HERMES_PYTHON,
      source.body,
      write,
      source.configDigest,
    );
  } else if (write.document.collection === "memory") {
    const { HERMES_PYTHON } = await import("./installer");
    // Account changes during module loading must be checked before touching source files.
    if (
      JSON.stringify(before.context) !==
      JSON.stringify(await cloudWorkspace.nativeContext(true))
    )
      throw Error("Workspace identity changed");
    try {
      result = applyMemoryReplica(
        profileHome(before.profile),
        before.profile,
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
    result = applyKanbanReplica(
      before.root,
      before.profile,
      before.userId,
      before.replicaId,
      write,
    );
  }
  if (
    JSON.stringify(before.context) !==
    JSON.stringify(await cloudWorkspace.nativeContext(true))
  )
    throw Error("Workspace identity changed");
  return result;
}
