import { execFile } from "node:child_process";
import { join } from "node:path";

export interface OriginalScheduleAgentBinding {
  owner: string;
  profile: string;
  sourceRevision: number;
  sourceDigest: string;
  datasetGeneration?: number;
  authorityRevision: number;
  nativeVersion: string;
}
export interface OriginalScheduleAgentPreparation {
  owner: string;
  profile: string;
  nativeVersion: string | null;
}
export interface OriginalScheduleAgentRuntime {
  executable: string;
  cliArgs: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validOriginalScheduleAgentBinding(
  input: unknown,
): input is OriginalScheduleAgentBinding {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return (
    Object.keys(value).sort().join(",") ===
      [
        ...[
          "authorityRevision",
          "nativeVersion",
          "owner",
          "profile",
          "sourceDigest",
          "sourceRevision",
        ],
        ...("datasetGeneration" in value ? ["datasetGeneration"] : []),
      ]
        .sort()
        .join(",") &&
    (!("datasetGeneration" in value) ||
      (Number.isSafeInteger(value.datasetGeneration) &&
        Number(value.datasetGeneration) >= 0)) &&
    [value.owner, value.profile].every(
      (part) => typeof part === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(part),
    ) &&
    (value.profile as string).length <= 64 &&
    [value.sourceRevision, value.authorityRevision].every(
      (part) => Number.isSafeInteger(part) && (part as number) > 0,
    ) &&
    digest(value.sourceDigest) &&
    digest(value.nativeVersion)
  );
}

/** Main-only internal producer. Source and secrets stay out of argv and errors.
 * A receipt confirms local policy persistence, not occurrence execution or cloud publication.
 */
async function callOriginalScheduleAgent(
  input: OriginalScheduleAgentBinding | OriginalScheduleAgentPreparation,
  action: "binding" | "prepare",
  runtime: OriginalScheduleAgentRuntime,
  assertActive: () => Promise<void>,
): Promise<{ bindingDigest: string }> {
  const unavailable = (): Error =>
    Error("Original schedule execution binding unconfirmed");
  const request = structuredClone(input);
  await assertActive();
  const { owner, ...binding } = request;
  const output = await new Promise<string>((resolve, reject) => {
    try {
      const child = execFile(
        runtime.executable,
        action === "prepare"
          ? [
              join(runtime.cwd, "plugins", "mithril-schedules", "bootstrap.py"),
              "-p",
              request.profile,
              "--stdin",
            ]
          : [
              ...runtime.cliArgs,
              "-p",
              request.profile,
              "mithril-schedule-custody",
              "--stdin",
            ],
        {
          cwd: runtime.cwd,
          env: runtime.env,
          timeout: 40000,
          maxBuffer: 8192,
          windowsHide: true,
          encoding: "utf8",
        },
        (error, stdout) => (error ? reject(unavailable()) : resolve(stdout)),
      );
      child.stdin?.on("error", () => reject(unavailable()));
      if (!child.stdin) {
        child.kill();
        reject(unavailable());
        return;
      }
      child.stdin.end(JSON.stringify({ owner, [action]: binding }));
    } catch {
      reject(unavailable());
    }
  });
  await assertActive();
  try {
    const result = JSON.parse(output);
    const receipt = result.receipt;
    if (
      Object.keys(result).sort().join(",") !== "ok,receipt" ||
      result.ok !== true ||
      !receipt ||
      typeof receipt !== "object" ||
      Array.isArray(receipt) ||
      Object.keys(receipt).sort().join(",") !==
        [...Object.keys(request), "bindingDigest"].sort().join(",") ||
      !Object.entries(request).every(
        ([key, value]) => receipt[key] === value,
      ) ||
      !digest(receipt.bindingDigest)
    )
      throw unavailable();
    return { bindingDigest: receipt.bindingDigest };
  } catch {
    throw unavailable();
  }
}

export function validOriginalScheduleAgentPreparation(
  input: unknown,
): input is OriginalScheduleAgentPreparation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return (
    Object.keys(value).sort().join(",") === "nativeVersion,owner,profile" &&
    [value.owner, value.profile].every(
      (part) => typeof part === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(part),
    ) &&
    (value.profile as string).length <= 64 &&
    (value.nativeVersion === null || digest(value.nativeVersion))
  );
}

// @lat: [[cloud-workspace#Original schedule Agent binding bridge (draft)]]
export async function bindOriginalScheduleAgent(
  input: OriginalScheduleAgentBinding,
  runtime: OriginalScheduleAgentRuntime,
  assertActive: () => Promise<void>,
): Promise<{ bindingDigest: string }> {
  if (!validOriginalScheduleAgentBinding(input))
    throw Error("Original schedule execution binding unconfirmed");
  return callOriginalScheduleAgent(input, "binding", runtime, assertActive);
}

/** Require a policy lane before source restoration or executor selection; no execution grant. */
export async function prepareOriginalScheduleAgent(
  input: OriginalScheduleAgentPreparation,
  runtime: OriginalScheduleAgentRuntime,
  assertActive: () => Promise<void>,
): Promise<{ bindingDigest: string }> {
  if (!validOriginalScheduleAgentPreparation(input))
    throw Error("Original schedule execution binding unconfirmed");
  return callOriginalScheduleAgent(input, "prepare", runtime, assertActive);
}
