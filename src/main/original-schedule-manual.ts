import { validOriginalScheduleContext } from "@mithril/workspace/original-schedules";

export interface OriginalManualRequest {
  profile: string;
  jobId: string;
  operationId: string;
  sourceRevision: number;
  sourceDigest: string;
  datasetGeneration?: number;
}
export type OriginalManualStatus = "unknown" | "completed" | "rejected";
export type OriginalManualCommand =
  | { action: "take"; profile: string; datasetGeneration?: number }
  | (OriginalManualRequest & {
      action: "complete";
      status: OriginalManualStatus;
    });
export type OriginalManualReceipt = OriginalManualRequest & {
  userId: string;
  status: OriginalManualStatus;
};
export type OriginalManualTake =
  | { fresh: false; request: null }
  | {
      fresh: boolean;
      request: OriginalManualReceipt;
      authorityRevision?: number;
    };
export type OriginalManualResult = OriginalManualTake | OriginalManualReceipt;
export const ORIGINAL_MANUAL_BYTES = 8192;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: object, fields: string[]): boolean =>
  Object.keys(v).sort().join(",") ===
  [...fields, ...("datasetGeneration" in v ? ["datasetGeneration"] : [])]
    .sort()
    .join(",");
const fields = [
  "profile",
  "jobId",
  "operationId",
  "sourceRevision",
  "sourceDigest",
];
const id = (v: unknown): boolean =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v);
const positive = (v: unknown): boolean =>
  Number.isSafeInteger(v) && Number(v) > 0;
const status = (v: unknown): boolean =>
  typeof v === "string" && ["unknown", "completed", "rejected"].includes(v);
function request(v: Record<string, unknown>): boolean {
  return (
    (v.datasetGeneration === undefined ||
      (Number.isSafeInteger(v.datasetGeneration) &&
        Number(v.datasetGeneration) >= 0)) &&
    validOriginalScheduleContext(v.profile, "UTC") &&
    id(v.jobId) &&
    id(v.operationId) &&
    positive(v.sourceRevision) &&
    typeof v.sourceDigest === "string" &&
    /^[a-f0-9]{64}$/.test(v.sourceDigest)
  );
}
/** Main-only consumer commands. Account/executor identity is derived from the credential. */
export function validOriginalManualCommand(
  v: unknown,
): v is OriginalManualCommand {
  if (
    !object(v) ||
    !validOriginalScheduleContext(v.profile, "UTC") ||
    (v.datasetGeneration !== undefined &&
      (!Number.isSafeInteger(v.datasetGeneration) ||
        Number(v.datasetGeneration) < 0))
  )
    return false;
  if (v.action === "take") return exact(v, ["action", "profile"]);
  return (
    v.action === "complete" &&
    exact(v, ["action", "status", ...fields]) &&
    request(v) &&
    status(v.status)
  );
}
function receipt(
  v: unknown,
  owner: string,
  profile: string,
): v is OriginalManualReceipt {
  return (
    object(v) &&
    exact(v, ["userId", "status", ...fields]) &&
    v.userId === owner &&
    v.profile === profile &&
    request(v) &&
    status(v.status)
  );
}
/** A replay is inspection only; only a fresh unknown take carries dispatch permission. */
export function validOriginalManualResult(
  v: unknown,
  owner: string,
  command: OriginalManualCommand,
): v is OriginalManualResult {
  if (command.action === "complete")
    return (
      receipt(v, owner, command.profile) &&
      v.status === command.status &&
      (v.datasetGeneration ?? 0) === (command.datasetGeneration ?? 0) &&
      fields.every(
        (field) =>
          v[field as keyof OriginalManualRequest] ===
          command[field as keyof OriginalManualRequest],
      )
    );
  if (!object(v) || typeof v.fresh !== "boolean") return false;
  if (v.request === null)
    return v.fresh === false && exact(v, ["fresh", "request"]);
  if (
    !receipt(v.request, owner, command.profile) ||
    (v.request.datasetGeneration ?? 0) !== (command.datasetGeneration ?? 0)
  )
    return false;
  if (v.request.status === "rejected")
    return v.fresh === false && exact(v, ["fresh", "request"]);
  return (
    v.request.status === "unknown" &&
    positive(v.authorityRevision) &&
    exact(v, ["fresh", "request", "authorityRevision"])
  );
}
