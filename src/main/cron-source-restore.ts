import type { OriginalCronFile } from "./cron-source-files";

export interface OriginalCronRestoreRequest {
  owner: string;
  profile: string;
  operationId: string;
  expectedVersion: string | null;
  file: OriginalCronFile["file"];
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
        /^[a-f0-9]{64}$/.test(receipt.version)
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
