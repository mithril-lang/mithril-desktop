import { validOriginalScheduleContext } from "@mithril/workspace/original-schedules";

export const ORIGINAL_SCHEDULE_CUSTODY_BYTES = 8192;
export interface OriginalScheduleOccurrence {
  profile: string;
  jobId: string;
  scheduledInstant: string;
  operationId: string;
  authorityRevision: number;
  sourceRevision: number;
  sourceDigest: string;
}
export type OriginalScheduleCustodyCommand =
  | { action: "status"; profile: string }
  | { action: "select"; profile: string; expectedRevision: number }
  | ({ action: "claim" } & OriginalScheduleOccurrence)
  | ({
      action: "transition";
      from: "admitted" | "running";
      to: "running" | "completed" | "unknown";
    } & OriginalScheduleOccurrence);
export type OriginalScheduleCustodyReceipt =
  | { userId: string; profile: string; selected: boolean; revision: number }
  | {
      userId: string;
      profile: string;
      operationId: string;
      status: "admitted" | "running" | "completed" | "unknown";
      fresh: boolean;
    }
  | { userId: string; profile: string; operationId: string; changed: boolean };

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(v).sort().join(",") === [...fields].sort().join(",");
const integer = (v: unknown, minimum = 0): boolean =>
  Number.isSafeInteger(v) && Number(v) >= minimum;
const id = (v: unknown): boolean =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v);
const occurrenceKeys = [
  "profile",
  "jobId",
  "scheduledInstant",
  "operationId",
  "authorityRevision",
  "sourceRevision",
  "sourceDigest",
];
function instant(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const parts =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(
      v,
    );
  if (!parts) return false;
  const millis = Date.parse(parts[1] + "Z");
  return (
    Number.isFinite(millis) &&
    new Date(millis).toISOString() === parts[1] + ".000Z"
  );
}

/** Fixed main-only wire contract; private owner and credential identities are never supplied by callers. */
export function validOriginalScheduleCustodyCommand(
  v: unknown,
): v is OriginalScheduleCustodyCommand {
  if (!object(v) || !validOriginalScheduleContext(v.profile, "UTC"))
    return false;
  if (v.action === "status") return keys(v, ["action", "profile"]);
  if (v.action === "select")
    return (
      keys(v, ["action", "profile", "expectedRevision"]) &&
      integer(v.expectedRevision) &&
      Number(v.expectedRevision) < Number.MAX_SAFE_INTEGER
    );
  if (v.action !== "claim" && v.action !== "transition") return false;
  if (
    !keys(v, [
      "action",
      ...occurrenceKeys,
      ...(v.action === "transition" ? ["from", "to"] : []),
    ]) ||
    !id(v.jobId) ||
    !id(v.operationId) ||
    !instant(v.scheduledInstant) ||
    !integer(v.authorityRevision, 1) ||
    !integer(v.sourceRevision, 1) ||
    typeof v.sourceDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.sourceDigest)
  )
    return false;
  return (
    v.action === "claim" ||
    (v.from === "admitted" && (v.to === "running" || v.to === "unknown")) ||
    (v.from === "running" && (v.to === "completed" || v.to === "unknown"))
  );
}

/** Replayed receipts remain inspection evidence: fresh/changed false never authorizes a second effect. */
export function validOriginalScheduleCustodyReceipt(
  v: unknown,
  owner: string,
  command: OriginalScheduleCustodyCommand,
): v is OriginalScheduleCustodyReceipt {
  if (!object(v) || v.userId !== owner || v.profile !== command.profile)
    return false;
  if (command.action === "status" || command.action === "select")
    return (
      keys(v, ["userId", "profile", "selected", "revision"]) &&
      typeof v.selected === "boolean" &&
      integer(v.revision) &&
      (command.action !== "select" ||
        (v.selected && v.revision === command.expectedRevision + 1))
    );
  if (v.operationId !== command.operationId) return false;
  if (command.action === "claim")
    return (
      keys(v, ["userId", "profile", "operationId", "status", "fresh"]) &&
      typeof v.status === "string" &&
      ["admitted", "running", "completed", "unknown"].includes(v.status) &&
      typeof v.fresh === "boolean" &&
      (!v.fresh || v.status === "admitted")
    );
  return (
    keys(v, ["userId", "profile", "operationId", "changed"]) &&
    typeof v.changed === "boolean"
  );
}
