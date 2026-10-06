import type Database from "better-sqlite3";
import {
  repositoryFingerprint,
  type JsonValue,
} from "@mithril/workspace/repository";
type Edge = Record<string, JsonValue>;
/** Prepare a data-only graph update inside the caller's SQLite writer transaction. */
export function planKanbanDependencies(
  db: Database.Database,
  taskId: string,
  incoming: {
    dependencies?: JsonValue;
    parents?: JsonValue;
    children?: JsonValue;
  },
): { edges: Edge[]; apply(): Edge[] } | null {
  const schema = db.prepare("PRAGMA table_info(task_dependencies)").all() as {
    name: string;
  }[];
  const columns = schema.map((row) => row.name);
  if (
    !columns.includes("parent_id") ||
    !columns.includes("child_id") ||
    columns.some((name) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
  )
    return null;
  if (
    !Array.isArray(incoming.dependencies) ||
    incoming.dependencies.length > 20000
  )
    throw Error("Invalid dependency graph");
  const edges = incoming.dependencies as Edge[];
  const pairs = new Set<string>();
  for (const edge of edges) {
    if (
      !edge ||
      typeof edge !== "object" ||
      Array.isArray(edge) ||
      Object.keys(edge).length !== columns.length ||
      columns.some((key) => !(key in edge)) ||
      Object.keys(edge).some((key) => !columns.includes(key)) ||
      columns.some(
        (key) =>
          edge[key] !== null &&
          typeof edge[key] !== "string" &&
          !(typeof edge[key] === "number" && Number.isFinite(edge[key])),
      ) ||
      typeof edge.parent_id !== "string" ||
      typeof edge.child_id !== "string" ||
      !edge.parent_id ||
      !edge.child_id ||
      edge.parent_id.length > 128 ||
      edge.child_id.length > 128 ||
      edge.parent_id === edge.child_id ||
      (edge.parent_id !== taskId && edge.child_id !== taskId)
    )
      throw Error("Invalid dependency identity");
    const key = JSON.stringify([edge.parent_id, edge.child_id]);
    if (pairs.has(key)) throw Error("Duplicate dependency");
    pairs.add(key);
  }
  const parents = edges
    .filter((edge) => edge.child_id === taskId)
    .map((edge) => edge.parent_id);
  const children = edges
    .filter((edge) => edge.parent_id === taskId)
    .map((edge) => edge.child_id);
  const matches = (
    value: JsonValue | undefined,
    expected: JsonValue[],
  ): boolean =>
    Array.isArray(value) &&
    value.length === expected.length &&
    new Set(value).size === value.length &&
    expected.every((id) => value.includes(id));
  if (
    !matches(incoming.parents, parents) ||
    !matches(incoming.children, children)
  )
    throw Error("Inconsistent dependency projection");
  const original = db
    .prepare("SELECT * FROM task_dependencies LIMIT 20001")
    .all() as Edge[];
  if (original.length > 20000) return null;
  const old = original.filter(
    (edge) => edge.parent_id === taskId || edge.child_id === taskId,
  );
  const oldHashes = new Set(
    old.map((edge) => repositoryFingerprint({ body: edge, deleted: false })),
  );
  const newHashes = new Set(
    edges.map((edge) => repositoryFingerprint({ body: edge, deleted: false })),
  );
  const changed = [
    ...old.filter(
      (edge) =>
        !newHashes.has(repositoryFingerprint({ body: edge, deleted: false })),
    ),
    ...edges.filter(
      (edge) =>
        !oldHashes.has(repositoryFingerprint({ body: edge, deleted: false })),
    ),
  ];
  for (const id of new Set(
    changed.flatMap((edge) => [edge.parent_id, edge.child_id]),
  )) {
    if (typeof id !== "string")
      throw Error("Invalid existing dependency identity");
    const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!task) return null; // Keep the cloud record until its endpoint is reconstructed.
    if (
      task.claim_lock ||
      ["ready", "scheduled", "running"].includes(String(task.status))
    )
      return null;
  }
  const graph = [
    ...original.filter(
      (edge) => edge.parent_id !== taskId && edge.child_id !== taskId,
    ),
    ...edges,
  ];
  if (
    graph.length > 20000 ||
    new Set(
      graph.map((edge) => JSON.stringify([edge.parent_id, edge.child_id])),
    ).size !== graph.length
  )
    return null;
  const adjacency = new Map<string, string[]>(),
    indegree = new Map<string, number>();
  for (const edge of graph) {
    if (typeof edge.parent_id !== "string" || typeof edge.child_id !== "string")
      return null;
    const children = adjacency.get(edge.parent_id) ?? [];
    children.push(edge.child_id);
    adjacency.set(edge.parent_id, children);
    indegree.set(edge.parent_id, indegree.get(edge.parent_id) ?? 0);
    indegree.set(edge.child_id, (indegree.get(edge.child_id) ?? 0) + 1);
  }
  const ready = [...indegree]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  let count = 0;
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i];
    count++;
    for (const child of adjacency.get(id) ?? []) {
      const degree = indegree.get(child)! - 1;
      indegree.set(child, degree);
      if (degree === 0) ready.push(child);
    }
  }
  if (count !== indegree.size) throw Error("Cyclic dependency graph");
  return {
    edges,
    apply: () => {
      if (!db.inTransaction)
        throw Error("Dependency writes require the task transaction");
      db.prepare(
        "DELETE FROM task_dependencies WHERE parent_id=? OR child_id=?",
      ).run(taskId, taskId);
      const insert = db.prepare(
        "INSERT INTO task_dependencies (" +
          columns.map((key) => '"' + key + '"').join(",") +
          ") VALUES(" +
          columns.map(() => "?").join(",") +
          ")",
      );
      for (const edge of edges) insert.run(...columns.map((key) => edge[key]));
      const actual = db
        .prepare("SELECT * FROM task_dependencies LIMIT 20001")
        .all() as Edge[];
      const expected = new Set(
        graph.map((edge) =>
          repositoryFingerprint({ body: edge, deleted: false }),
        ),
      );
      const actualHashes = new Set(
        actual.map((edge) =>
          repositoryFingerprint({ body: edge, deleted: false }),
        ),
      );
      if (
        actual.length !== graph.length ||
        actualHashes.size !== expected.size ||
        actual.some(
          (edge) =>
            !expected.has(
              repositoryFingerprint({ body: edge, deleted: false }),
            ),
        )
      )
        throw Error("Dependency schema changed data; source retained");
      return actual.filter(
        (edge) => edge.parent_id === taskId || edge.child_id === taskId,
      );
    },
  };
}
