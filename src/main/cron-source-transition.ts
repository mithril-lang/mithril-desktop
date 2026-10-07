import {
  validJson,
  repositoryFingerprint,
  type JsonValue,
} from "@mithril/workspace/repository";
import {
  originalScheduleFromSource,
  originalTransitionRetainsSource,
} from "@mithril/workspace/original-schedule-source";
import { validOriginalCronScope } from "./cron-source-prepare";
export interface OriginalCronTransitionRequest {
  owner: string;
  profile: string;
  operationId: string;
  timeZone: string;
  action: "pause" | "resume";
  source: Record<string, JsonValue>;
}
export type OriginalCronTransitionResult =
  | {
      success: true;
      preparation: OriginalCronTransitionRequest & {
        job: Record<string, JsonValue>;
      };
    }
  | { success: false; error: string };
export function validOriginalCronTransitionRequest(
  request: OriginalCronTransitionRequest,
): boolean {
  try {
    if (
      !request ||
      !validJson(request) ||
      !validOriginalCronScope(request) ||
      Object.keys(request).sort().join(",") !==
        "action,operationId,owner,profile,source,timeZone" ||
      !["pause", "resume"].includes(request.action) ||
      Buffer.byteLength(JSON.stringify(request)) > 20 * 1024 * 1024
    )
      return false;
    originalScheduleFromSource(
      request.source,
      request.profile,
      request.timeZone,
    );
    return !["pending_slot", "run_claim", "fire_claim"].some(
      (key) => request.source[key] != null,
    );
  } catch {
    return false;
  }
}
const fingerprint = (body: JsonValue): string =>
  repositoryFingerprint({ body, deleted: false });
/** Data-only original lifecycle preparation; a receipt never grants an execution lease. */
export function parseOriginalCronTransitionResult(
  stdout: string,
  request: OriginalCronTransitionRequest,
): OriginalCronTransitionResult {
  try {
    if (!validOriginalCronTransitionRequest(request)) throw Error("request");
    const result = JSON.parse(stdout);
    const prepared = result.preparation;
    if (
      result.success === true &&
      Object.keys(result).length === 2 &&
      prepared &&
      Object.keys(prepared).sort().join(",") ===
        "action,job,operationId,owner,profile,source,timeZone" &&
      prepared.owner === request.owner &&
      prepared.profile === request.profile &&
      prepared.operationId === request.operationId &&
      prepared.timeZone === request.timeZone &&
      prepared.action === request.action &&
      validJson(prepared.source) &&
      fingerprint(prepared.source) === fingerprint(request.source)
    ) {
      const target = originalScheduleFromSource(
        prepared.job,
        request.profile,
        request.timeZone,
      );
      if (
        originalTransitionRetainsSource(request.source, prepared.job) &&
        target.job.state ===
          (request.action === "pause" ? "paused" : "active") &&
        target.job.enabled === (request.action === "resume")
      )
        return { success: true, preparation: prepared };
    }
    const messages: Record<string, string> = {
      identity: "Schedule workspace identity changed",
      timezone: "Schedule timezone differs from the original profile",
      busy: "Schedule has an outstanding occurrence; retry after it finishes",
      terminal: "Completed schedule requires review",
      invalid_preparation: "Original schedule could not be transitioned",
    };
    if (
      result.success === false &&
      typeof result.error === "string" &&
      Object.hasOwn(messages, result.error)
    )
      return { success: false, error: messages[result.error] };
  } catch {
    /* Raw child output and private paths stay out of renderer errors. */
  }
  return { success: false, error: "Schedule transition unavailable" };
}
