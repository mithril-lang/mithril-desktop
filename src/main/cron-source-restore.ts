import { createHash } from "crypto";
import { validJson } from "@mithril/workspace/repository";
import type { OriginalCronFile } from "./cron-source-files";

interface OriginalCronRestoreScope {
  owner: string;
  profile: string;
  operationId: string;
  expectedVersion: string | null;
}
export type OriginalCronRestoreRequest = OriginalCronRestoreScope &
  (
    | { file: OriginalCronFile["file"]; sourceText?: never }
    | { sourceText: string; file?: never }
  );

export function validOriginalCronRestoreRequest(
  value: unknown,
): value is OriginalCronRestoreRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  const keys = Object.keys(request).sort().join(",");
  if (
    ![
      "expectedVersion,file,operationId,owner,profile",
      "expectedVersion,operationId,owner,profile,sourceText",
    ].includes(keys) ||
    ![request.owner, request.profile, request.operationId].every(
      (part) => typeof part === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(part),
    ) ||
    (request.profile as string).length > 64 ||
    (request.expectedVersion !== null &&
      (typeof request.expectedVersion !== "string" ||
        !/^[a-f0-9]{64}$/.test(request.expectedVersion)))
  )
    return false;
  if ("sourceText" in request) {
    if (
      typeof request.sourceText !== "string" ||
      Buffer.byteLength(request.sourceText) > 20 * 1024 * 1024 ||
      Buffer.from(request.sourceText).toString("utf8") !== request.sourceText
    )
      return false;
    try {
      return validJson(
        JSON.parse(
          request.sourceText.startsWith("\uFEFF")
            ? request.sourceText.slice(1)
            : request.sourceText,
        ),
      );
    } catch {
      return false;
    }
  }
  return validJson(request.file);
}
export interface OriginalCronRestoreReceipt {
  owner: string;
  profile: string;
  operationId: string;
  version: string;
}
export type OriginalCronRestoreResult =
  | { success: true; receipt: OriginalCronRestoreReceipt }
  | { success: false; error: string };

/** Accept only the acknowledgement for this main-process owner/profile operation.
 * Child stderr and source paths/contents are never exposed as renderer error text.
 */
export function parseOriginalCronRestoreResult(
  stdout: string,
  request: OriginalCronRestoreRequest,
): OriginalCronRestoreResult {
  try {
    const result = JSON.parse(stdout);
    if (result.success === true && result.receipt) {
      const receipt = result.receipt;
      if (
        Object.keys(result).length === 2 &&
        Object.keys(receipt).length === 4 &&
        receipt.owner === request.owner &&
        receipt.profile === request.profile &&
        receipt.operationId === request.operationId &&
        typeof receipt.version === "string" &&
        /^[a-f0-9]{64}$/.test(receipt.version) &&
        (request.sourceText === undefined ||
          receipt.version ===
            createHash("sha256")
              .update(request.sourceText, "utf8")
              .digest("hex"))
      )
        return { success: true, receipt };
      throw Error("identity");
    }
    const messages: Record<string, string> = {
      busy: "Schedule execution is active; synchronization is deferred",
      conflict: "Schedule source changed; refresh before synchronization",
      identity: "Schedule workspace identity changed",
      runtime: "Schedule execution claims cannot be copied between replicas",
      ownership: "Schedule execution requires the original device binding",
      operation: "Schedule operation requires review",
      inventory: "Schedule inventory requires review; original file retained",
      unsafe: "Schedule source unavailable; original file retained",
      oversize: "Schedule source exceeds synchronization capacity",
    };
    if (result.success === false && typeof result.error === "string")
      return {
        success: false,
        error: Object.hasOwn(messages, result.error)
          ? messages[result.error]
          : "Schedule restoration unavailable",
      };
  } catch {
    // Includes malformed output and receipts belonging to another workspace.
  }
  return { success: false, error: "Schedule restoration unavailable" };
}
