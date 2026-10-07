import type { OriginalScheduleReplicaScope } from "@mithril/workspace/original-schedule-file-replica";
import { validOriginalScheduleContext } from "@mithril/workspace/original-schedules";
import {
  validOriginalManualCommand,
  type OriginalManualRequest,
} from "./original-schedule-manual";
import {
  validOriginalCronRunRequest,
  type OriginalCronRunRequest,
} from "./cron-source-run";

export interface OriginalManualBinding
  extends OriginalScheduleReplicaScope, OriginalManualRequest {
  authorityRevision: number;
  nativeVersion: string;
}
export interface OriginalManualJournalEntry {
  binding: OriginalManualBinding;
  status: "reserved" | "unknown" | "completed" | "rejected";
  reported: boolean;
}
export function originalManualNativeRequest(
  binding: OriginalManualBinding,
): OriginalCronRunRequest {
  return {
    owner: binding.owner,
    profile: binding.profile,
    jobId: binding.jobId,
    operationId: binding.operationId,
    expectedVersion: binding.nativeVersion,
  };
}
export function originalManualWireRequest(
  binding: OriginalManualBinding,
): OriginalManualRequest {
  return {
    profile: binding.profile,
    jobId: binding.jobId,
    operationId: binding.operationId,
    sourceRevision: binding.sourceRevision,
    sourceDigest: binding.sourceDigest,
  };
}
export function validOriginalManualBinding(
  v: unknown,
): v is OriginalManualBinding {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const b = v as OriginalManualBinding;
  return (
    Object.keys(b).sort().join(",") ===
      "authorityRevision,jobId,nativeVersion,operationId,owner,profile,sourceDigest,sourceRevision,timeZone" &&
    validOriginalScheduleContext(b.profile, b.timeZone) &&
    Number.isSafeInteger(b.authorityRevision) &&
    b.authorityRevision > 0 &&
    validOriginalCronRunRequest(originalManualNativeRequest(b)) &&
    validOriginalManualCommand({
      action: "complete",
      status: "unknown",
      ...originalManualWireRequest(b),
    })
  );
}
export function validOriginalManualJournalEntry(
  v: unknown,
): v is OriginalManualJournalEntry {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const e = v as OriginalManualJournalEntry;
  return (
    Object.keys(e).sort().join(",") === "binding,reported,status" &&
    validOriginalManualBinding(e.binding) &&
    typeof e.reported === "boolean" &&
    ["reserved", "unknown", "completed", "rejected"].includes(e.status) &&
    (e.status !== "reserved" || !e.reported)
  );
}
