import { execFile } from "node:child_process";
import type { OriginalScheduleAgentRuntime } from "./original-schedule-agent-binding";

export interface OriginalCronRunRequest {
  owner: string;
  profile: string;
  operationId: string;
  jobId: string;
  expectedVersion: string;
}
export type OriginalCronRunResult =
  | {
      success: true;
      receipt: OriginalCronRunRequest & {
        status: "completed" | "rejected" | "unknown";
      };
    }
  | { success: false; error: string };
const unavailable = (): OriginalCronRunResult => ({
  success: false,
  error: "Schedule execution result unconfirmed",
});

export function validOriginalCronRunRequest(
  value: unknown,
): value is OriginalCronRunRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    Object.keys(request).sort().join(",") ===
      "expectedVersion,jobId,operationId,owner,profile" &&
    [request.owner, request.profile, request.operationId, request.jobId].every(
      (part) => typeof part === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(part),
    ) &&
    (request.profile as string).length <= 64 &&
    typeof request.expectedVersion === "string" &&
    /^[a-f0-9]{64}$/.test(request.expectedVersion)
  );
}

export function parseOriginalCronRunResult(
  output: string,
  request: OriginalCronRunRequest,
): OriginalCronRunResult {
  try {
    if (
      !validOriginalCronRunRequest(request) ||
      Buffer.byteLength(output) > 4096
    )
      return unavailable();
    const result = JSON.parse(output);
    const receipt = result.receipt;
    if (
      result.success === true &&
      Object.keys(result).sort().join(",") === "receipt,success" &&
      receipt &&
      Object.keys(receipt).sort().join(",") ===
        "expectedVersion,jobId,operationId,owner,profile,status" &&
      Object.entries(request).every(([key, value]) => receipt[key] === value) &&
      ["completed", "rejected", "unknown"].includes(receipt.status)
    )
      return { success: true, receipt };
  } catch {
    // No raw native output, exception or private filesystem path reaches UI.
  }
  return unavailable();
}

/** Main-only exact-source run. Replays use the Agent's private durable marker.
 * The caller must verify selected-device custody before entering this port.
 */
export async function callOriginalCronRun(
  input: OriginalCronRunRequest,
  runtime: OriginalScheduleAgentRuntime,
  assertActive: () => Promise<void>,
): Promise<OriginalCronRunResult> {
  if (!validOriginalCronRunRequest(input)) return unavailable();
  const request = structuredClone(input);
  try {
    await assertActive();
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        runtime.executable,
        [...runtime.cliArgs, "-p", request.profile, "cron", "source-run"],
        {
          cwd: runtime.cwd,
          env: runtime.env,
          // Execution follows the original Agent watchdog, not a parser timeout.
          timeout: 0,
          maxBuffer: 65536,
          windowsHide: true,
          encoding: "utf8",
        },
        (error, stdout) =>
          error ? reject(Error("unconfirmed")) : resolve(stdout),
      );
      child.stdin?.on("error", () => reject(Error("unconfirmed")));
      if (!child.stdin) {
        child.kill();
        reject(Error("unconfirmed"));
        return;
      }
      child.stdin.end(JSON.stringify(request));
    });
    await assertActive();
    return parseOriginalCronRunResult(output, request);
  } catch {
    return unavailable();
  }
}
