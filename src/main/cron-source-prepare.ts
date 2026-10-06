import {
  validJson,
  repositoryFingerprint,
  type JsonValue,
} from "@mithril/workspace/repository";

export interface OriginalCronPrepareRequest {
  owner: string;
  profile: string;
  operationId: string;
  timeZone: string;
  input: { schedule: string; prompt?: string; name?: string; deliver?: string };
}
export type OriginalCronPreparation = OriginalCronPrepareRequest & {
  job: Record<string, JsonValue>;
};
export type OriginalCronPrepareResult =
  | { success: true; preparation: OriginalCronPreparation }
  | { success: false; error: string };
const sourceObject = (value: unknown): value is Record<string, JsonValue> =>
  validJson(value) &&
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value);

export function validOriginalCronPrepareRequest(
  request: OriginalCronPrepareRequest,
): boolean {
  if (
    !request ||
    !validJson(request) ||
    Object.keys(request).sort().join(",") !==
      "input,operationId,owner,profile,timeZone" ||
    ![request.owner, request.profile, request.operationId].every(
      (value) =>
        typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value),
    ) ||
    request.profile.length > 64 ||
    typeof request.timeZone !== "string" ||
    !request.timeZone ||
    !request.input ||
    typeof request.input !== "object" ||
    Array.isArray(request.input) ||
    typeof request.input.schedule !== "string" ||
    !request.input.schedule.trim() ||
    Object.keys(request.input).some(
      (key) => !["schedule", "prompt", "name", "deliver"].includes(key),
    ) ||
    Object.values(request.input).some((value) => typeof value !== "string")
  )
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: request.timeZone });
    return Buffer.byteLength(JSON.stringify(request)) <= 20 * 1024 * 1024;
  } catch {
    return false;
  }
}

/** The original Agent parser owns schedule semantics. Only the preparation for
 * this exact profile, timezone and input is accepted; it has no execution lease.
 */
export function parseOriginalCronPrepareResult(
  stdout: string,
  request: OriginalCronPrepareRequest,
): OriginalCronPrepareResult {
  try {
    if (!validOriginalCronPrepareRequest(request)) throw Error("request");
    const result = JSON.parse(stdout);
    if (result.success === true && result.preparation) {
      const prepared = result.preparation;
      const job = prepared.job;
      if (
        Object.keys(result).length === 2 &&
        Object.keys(prepared).sort().join(",") ===
          "input,job,operationId,owner,profile,timeZone" &&
        prepared.owner === request.owner &&
        prepared.profile === request.profile &&
        prepared.operationId === request.operationId &&
        prepared.timeZone === request.timeZone &&
        validJson(prepared.input) &&
        repositoryFingerprint({ body: prepared.input, deleted: false }) ===
          repositoryFingerprint({ body: request.input, deleted: false }) &&
        sourceObject(job) &&
        typeof job.id === "string" &&
        /^[a-f0-9]{12}$/.test(job.id) &&
        typeof job.name === "string" &&
        (!request.input.name || job.name === request.input.name) &&
        job.prompt === (request.input.prompt ?? "").trim() &&
        job.deliver === (request.input.deliver ?? "local") &&
        job.enabled === true &&
        job.state === "scheduled" &&
        sourceObject(job.schedule) &&
        typeof job.schedule.kind === "string" &&
        ["cron", "interval", "once"].includes(job.schedule.kind) &&
        !["run_claim", "fire_claim", "pending_slot"].some((key) =>
          Object.hasOwn(job, key),
        )
      )
        return { success: true, preparation: prepared };
    }
    const messages: Record<string, string> = {
      identity: "Schedule workspace identity changed",
      timezone: "Schedule timezone differs from the original profile",
      operation: "Schedule preparation requires review",
      oversize: "Schedule source exceeds synchronization capacity",
      invalid_preparation: "Original schedule could not be prepared",
    };
    if (result.success === false && typeof result.error === "string")
      return {
        success: false,
        error: Object.hasOwn(messages, result.error)
          ? messages[result.error]
          : "Schedule preparation unavailable",
      };
  } catch {
    // Raw child output, prompt text and filesystem paths stay out of UI errors.
  }
  return { success: false, error: "Schedule preparation unavailable" };
}
