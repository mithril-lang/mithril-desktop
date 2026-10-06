import type { JsonValue } from "@mithril/workspace/repository";
export const kanbanDeviceFields = [
  "claim_lock",
  "claim_expires",
  "worker_pid",
  "worker_started_at",
  "last_heartbeat_at",
  "current_run_id",
] as const;
export function portableKanbanTask(
  raw: Record<string, unknown>,
): Record<string, JsonValue> {
  const task = { ...raw, workspace_path: null } as Record<string, JsonValue>;
  for (const field of kanbanDeviceFields) delete task[field];
  if (typeof task.skills === "string") task.skills = JSON.parse(task.skills);
  return task;
}
export function portableKanbanRun(
  raw: Record<string, unknown>,
): Record<string, JsonValue> {
  const run = { ...raw } as Record<string, JsonValue>;
  for (const field of kanbanDeviceFields) delete run[field];
  return run;
}
