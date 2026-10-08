import {
  bindOriginalScheduleAgent,
  prepareOriginalScheduleAgent,
  validOriginalScheduleAgentPreparation,
  type OriginalScheduleAgentPreparation,
  validOriginalScheduleAgentBinding,
  type OriginalScheduleAgentBinding,
} from "./original-schedule-agent-binding";
import { projectLocalSchedules } from "./local-schedule-preview";
import {
  captureOriginalCronFile,
  type OriginalCronFile,
} from "./cron-source-files";
import type { NativeScheduleDraft } from "@mithril/workspace/schedules";
import {
  parseOriginalCronRestoreResult,
  type OriginalCronRestoreRequest,
  validOriginalCronRestoreRequest,
  type OriginalCronRestoreResult,
} from "./cron-source-restore";
import {
  validOriginalCronPrepareRequest,
  parseOriginalCronPrepareResult,
  type OriginalCronPrepareRequest,
  type OriginalCronPrepareResult,
} from "./cron-source-prepare";
import {
  validOriginalCronTransitionRequest,
  parseOriginalCronTransitionResult,
  type OriginalCronTransitionRequest,
  type OriginalCronTransitionResult,
} from "./cron-source-transition";
import {
  callOriginalCronRun,
  callOriginalCronInspect,
  validOriginalCronRunRequest,
  type OriginalCronRunRequest,
  type OriginalCronRunResult,
  type OriginalCronInspectResult,
} from "./cron-source-run";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { HERMES_HOME, HERMES_PYTHON, hermesCliArgs } from "./installer";
import { profileHome } from "./utils";
import {
  isRemoteMode,
  getApiUrl,
  getRemoteAuthHeader,
  normaliseRemoteUrl,
} from "./hermes";
import { getConnectionConfig, secureSpawnEnv } from "./config";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import { sshRunCron } from "./ssh-remote";
import type { SshConfig } from "./ssh-tunnel";

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  state: "active" | "paused" | "completed";
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  repeat: { times: number | null; completed: number } | null;
  deliver: string[];
  skills: string[];
  script: string | null;
}

function jobsFilePath(profile?: string): string {
  return join(profileHome(profile), "cron", "jobs.json");
}

function normalizeJob(job: Record<string, unknown>): CronJob | null {
  if (!job.id) return null;
  const enabled = job.enabled !== false;
  let state: CronJob["state"] = "active";
  if (job.state === "completed") state = "completed";
  else if (job.state === "paused" || !enabled) state = "paused";
  const schedule = job.schedule as { value?: string } | string | undefined;
  return {
    id: String(job.id),
    name: (job.name as string) || "(unnamed)",
    schedule:
      (job.schedule_display as string) ||
      (typeof schedule === "object" ? schedule?.value : schedule) ||
      "?",
    prompt: (job.prompt as string) || "",
    state,
    enabled,
    next_run_at: (job.next_run_at as string) || null,
    last_run_at: (job.last_run_at as string) || null,
    last_status: (job.last_status as string) || null,
    last_error: (job.last_error as string) || null,
    repeat: (job.repeat as CronJob["repeat"]) || null,
    deliver: Array.isArray(job.deliver)
      ? (job.deliver as string[])
      : job.deliver
        ? [job.deliver as string]
        : ["local"],
    skills:
      (job.skills as string[]) || (job.skill ? [job.skill as string] : []),
    script: (job.script as string) || null,
  };
}

function parseCronState(raw: string | undefined): CronJob["state"] {
  const state = (raw || "").trim().toLowerCase();
  if (state === "paused") return "paused";
  if (state === "completed") return "completed";
  return "active";
}

function parseRepeat(value: string | undefined): CronJob["repeat"] {
  const raw = (value || "").trim();
  if (!raw) return null;
  if (raw === "∞" || raw.toLowerCase() === "infinite") {
    return { times: null, completed: 0 };
  }
  const fraction = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    return {
      completed: Number(fraction[1]),
      times: Number(fraction[2]),
    };
  }
  const times = Number(raw);
  return Number.isFinite(times) ? { times, completed: 0 } : null;
}

function splitCsvish(value: string | undefined): string[] {
  const raw = (value || "").trim();
  if (!raw) return [];
  return raw
    .split(/,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseLastRun(value: string | undefined): {
  last_run_at: string | null;
  last_status: string | null;
} {
  const raw = (value || "").trim();
  if (!raw) return { last_run_at: null, last_status: null };
  const match = raw.match(/^(.+?)(?:\s{2,}(\S.*))?$/);
  return {
    last_run_at: match?.[1]?.trim() || raw,
    last_status: match?.[2]?.trim() || null,
  };
}

export function parseCronListOutput(output: string): CronJob[] {
  const jobs: CronJob[] = [];
  let current: {
    id: string;
    state: CronJob["state"];
    fields: Record<string, string>;
  } | null = null;

  function flush(): void {
    if (!current) return;
    const lastRun = parseLastRun(current.fields["Last run"]);
    const state = current.state;
    const deliver = splitCsvish(current.fields.Deliver);
    jobs.push({
      id: current.id,
      name: current.fields.Name || "(unnamed)",
      schedule: current.fields.Schedule || "?",
      prompt: current.fields.Prompt || "",
      state,
      enabled: state === "active",
      next_run_at: current.fields["Next run"] || null,
      last_run_at: lastRun.last_run_at,
      last_status: lastRun.last_status,
      last_error: current.fields.Error || null,
      repeat: parseRepeat(current.fields.Repeat),
      deliver: deliver.length > 0 ? deliver : ["local"],
      skills: splitCsvish(current.fields.Skills),
      script: current.fields.Script || null,
    });
    current = null;
  }

  for (const line of output.split(/\r?\n/)) {
    const jobMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s+\[([^\]]+)\]\s*$/);
    if (jobMatch) {
      flush();
      current = {
        id: jobMatch[1],
        state: parseCronState(jobMatch[2]),
        fields: {},
      };
      continue;
    }

    if (!current) continue;
    const fieldMatch = line.match(/^\s{2,}([^:]+):\s*(.*)$/);
    if (fieldMatch) {
      current.fields[fieldMatch[1].trim()] = fieldMatch[2].trim();
    }
  }

  flush();
  return jobs;
}

function getSshCronConfig(profile?: string): SshConfig | null {
  if (!profile || profile === "default" || !isRemoteMode()) return null;
  const conn = getConnectionConfig();
  return conn.mode === "ssh" && conn.ssh ? conn.ssh : null;
}

async function runNamedProfileSshCron(
  args: string[],
  profile?: string,
): Promise<{ success: boolean; output: string; error?: string } | null> {
  const ssh = getSshCronConfig(profile);
  if (!ssh) return null;
  const res = await sshRunCron(ssh, args, { profile, timeoutMs: 15000 });
  return {
    success: res.success,
    output: res.stdout || "",
    error: res.error,
  };
}

async function remoteFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getRemoteAuthHeader(),
    ...((init.headers as Record<string, string>) || {}),
  };
  const apiUrl = await getCronApiUrl(headers);
  return fetch(`${apiUrl}${path}`, { ...init, headers });
}

async function getCronApiUrl(headers: Record<string, string>): Promise<string> {
  try {
    return getApiUrl();
  } catch (err) {
    const conn = getConnectionConfig();
    if (conn.mode !== "ssh" || !conn.ssh?.localPort) throw err;

    // Schedules/Cron can be opened without first running the Chat path that
    // starts/refreshes the in-process SSH tunnel state. As a narrow fallback for
    // that screen, probe the configured/default local SSH port before using it.
    // This port may be stale if startSshTunnel() had to choose a different free
    // port, so a failed /health check preserves getApiUrl()'s original error
    // instead of sending authenticated API requests to an unrelated service.
    const fallbackUrl = normaliseRemoteUrl(
      `http://127.0.0.1:${conn.ssh.localPort}`,
    );
    if (await isCronFallbackHealthy(fallbackUrl, headers)) return fallbackUrl;
    throw err;
  }
}

async function isCronFallbackHealthy(
  apiUrl: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${apiUrl}/health`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function remoteJsonError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Read cron jobs from the jobs.json file (async to avoid blocking the main process).
 * In remote mode, fetches from the Hermes API server's /api/jobs endpoint instead.
 */
export async function listCronJobs(
  includeDisabled = true,
  profile?: string,
): Promise<CronJob[]> {
  const sshResult = await runNamedProfileSshCron(
    includeDisabled ? ["list", "--all"] : ["list"],
    profile,
  );
  if (sshResult) {
    if (!sshResult.success) {
      console.error("[CRON] remote SSH list failed:", sshResult.error);
      return [];
    }
    const jobs = parseCronListOutput(sshResult.output);
    return includeDisabled ? jobs : jobs.filter((job) => job.enabled);
  }

  if (isRemoteMode()) {
    try {
      const qs = includeDisabled ? "?include_disabled=true" : "";
      const res = await remoteFetch(`/api/jobs${qs}`);
      if (!res.ok) {
        console.error("[CRON] remote list failed:", await remoteJsonError(res));
        return [];
      }
      const body = (await res.json()) as { jobs?: Record<string, unknown>[] };
      const raw = body.jobs || [];
      const jobs: CronJob[] = [];
      for (const job of raw) {
        const normalized = normalizeJob(job);
        if (!normalized) continue;
        if (!includeDisabled && !normalized.enabled) continue;
        jobs.push(normalized);
      }
      return jobs;
    } catch (err) {
      console.error("[CRON] remote list error:", err);
      return [];
    }
  }

  const filePath = jobsFilePath(profile);
  if (!existsSync(filePath)) return [];

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    const raw = Array.isArray(parsed) ? parsed : parsed.jobs || [];
    const jobs: CronJob[] = [];

    for (const job of raw) {
      const normalized = normalizeJob(job);
      if (!normalized) continue;
      if (!includeDisabled && !normalized.enabled) continue;
      jobs.push(normalized);
    }

    return jobs;
  } catch (err) {
    console.error("[CRON] Failed to read jobs file:", err);
    return [];
  }
}

/**
 * Run a hermes cron CLI command and return the result.
 */
function runCronCommand(
  args: string[],
  profile?: string,
  nativeInput?: string,
): Promise<{ success: boolean; output: string; error?: string }> {
  const cliArgs = hermesCliArgs();
  if (profile && (profile !== "default" || nativeInput !== undefined)) {
    cliArgs.push("-p", profile);
  }
  cliArgs.push("cron", ...args);

  return new Promise((resolve) => {
    const child = execFile(
      HERMES_PYTHON,
      cliArgs,
      {
        cwd: join(HERMES_HOME, "hermes-agent"),
        timeout: nativeInput === undefined ? 15000 : 40000,
        // keychain-held keys the agent can no longer read from .env
        env: { ...process.env, ...secureSpawnEnv(profile) },
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            success: false,
            output: stdout || "",
            error: stderr || err.message,
          });
        } else {
          resolve({ success: true, output: stdout || "" });
        }
      },
    );
    // Native source bodies stay on stdin, never in process arguments or logs.
    if (nativeInput !== undefined) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(nativeInput);
    }
  });
}

export async function createCronJob(
  schedule: string,
  prompt?: string,
  name?: string,
  deliver?: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const args = ["create", schedule];
  if (prompt) args.push(prompt);
  if (name) args.push("--name", name);
  if (deliver) args.push("--deliver", deliver);

  const sshResult = await runNamedProfileSshCron(args, profile);
  if (sshResult) {
    return { success: sshResult.success, error: sshResult.error };
  }

  if (isRemoteMode()) {
    try {
      const res = await remoteFetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "",
          schedule,
          prompt: prompt || "",
          deliver: deliver || "local",
        }),
      });
      if (!res.ok) {
        return { success: false, error: await remoteJsonError(res) };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  const result = await runCronCommand(args, profile);
  return { success: result.success, error: result.error };
}

export async function removeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  const sshResult = await runNamedProfileSshCron(["remove", jobId], profile);
  if (sshResult) {
    return { success: sshResult.success, error: sshResult.error };
  }
  if (isRemoteMode()) {
    try {
      const res = await remoteFetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        return { success: false, error: await remoteJsonError(res) };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
  const result = await runCronCommand(["remove", jobId], profile);
  return { success: result.success, error: result.error };
}

async function remoteJobAction(
  jobId: string,
  action: "pause" | "resume" | "run",
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const sshResult = await runNamedProfileSshCron([action, jobId], profile);
  if (sshResult) {
    return { success: sshResult.success, error: sshResult.error };
  }
  try {
    const res = await remoteFetch(
      `/api/jobs/${encodeURIComponent(jobId)}/${action}`,
      { method: "POST" },
    );
    if (!res.ok) {
      return { success: false, error: await remoteJsonError(res) };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function pauseCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "pause", profile);
  const result = await runCronCommand(["pause", jobId], profile);
  return { success: result.success, error: result.error };
}

export async function resumeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "resume", profile);
  const result = await runCronCommand(["resume", jobId], profile);
  return { success: result.success, error: result.error };
}

export async function triggerCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "run", profile);
  const result = await runCronCommand(["run", jobId], profile);
  return { success: result.success, error: result.error };
}

/** Explicit local-only projection: no SSH, external delivery or script is read into the cloud draft. */
export function readOriginalCronSource(
  profile: string,
): OriginalCronFile | null {
  if (isRemoteMode())
    throw Error("Original remote schedule source unavailable");
  return captureOriginalCronFile(profileHome(profile), profile);
}

/** Prepare through the original profile's parser without saving or executing.
 * This main-process port does not expose raw source through renderer IPC.
 */
export async function prepareOriginalCronSource(
  request: OriginalCronPrepareRequest,
): Promise<OriginalCronPrepareResult> {
  if (isRemoteMode() || !validOriginalCronPrepareRequest(request))
    return {
      success: false,
      error: "Original schedule preparation unavailable",
    };
  const captured = structuredClone(request);
  const result = await runCronCommand(
    ["source-prepare"],
    captured.profile,
    JSON.stringify(captured),
  );
  return parseOriginalCronPrepareResult(result.output, captured);
}

/** Read-only original lifecycle bridge; no raw-source renderer IPC. */
export async function prepareOriginalCronTransition(
  request: OriginalCronTransitionRequest,
): Promise<OriginalCronTransitionResult> {
  if (isRemoteMode() || !validOriginalCronTransitionRequest(request))
    return {
      success: false,
      error: "Original schedule transition unavailable",
    };
  const captured = structuredClone(request);
  const result = await runCronCommand(
    ["source-transition"],
    captured.profile,
    JSON.stringify(captured),
  );
  return parseOriginalCronTransitionResult(result.output, captured);
}

/** Exact-source main-only execution after selected-device custody validation. */
export async function runOriginalCronSource(
  request: OriginalCronRunRequest,
  assertActive: () => Promise<void>,
): Promise<OriginalCronRunResult> {
  if (isRemoteMode() || !validOriginalCronRunRequest(request))
    return { success: false, error: "Original schedule execution unavailable" };
  return callOriginalCronRun(
    request,
    {
      executable: HERMES_PYTHON,
      cliArgs: hermesCliArgs(),
      cwd: join(HERMES_HOME, "hermes-agent"),
      env: { ...process.env, ...secureSpawnEnv(request.profile) },
    },
    assertActive,
  );
}

/** Main-only read-only retained-result recovery; no renderer IPC. */
export async function inspectOriginalCronSource(
  request: OriginalCronRunRequest,
  assertActive: () => Promise<void>,
): Promise<OriginalCronInspectResult> {
  if (isRemoteMode() || !validOriginalCronRunRequest(request))
    return {
      success: false,
      error: "Original schedule inspection unavailable",
    };
  return callOriginalCronInspect(
    request,
    {
      executable: HERMES_PYTHON,
      cliArgs: hermesCliArgs(),
      cwd: join(HERMES_HOME, "hermes-agent"),
      env: { ...process.env, ...secureSpawnEnv(request.profile) },
    },
    assertActive,
  );
}

/** Local restore after resource/execution binding. No raw-source renderer IPC. */
export async function restoreOriginalCronSource(
  request: OriginalCronRestoreRequest,
): Promise<OriginalCronRestoreResult> {
  if (isRemoteMode())
    return {
      success: false,
      error: "Original remote schedule restoration unavailable",
    };
  if (!validOriginalCronRestoreRequest(request))
    return { success: false, error: "Invalid original schedule restoration" };
  const captured = structuredClone(request);
  const input = JSON.stringify(captured);
  if (Buffer.byteLength(input) > 80 * 1024 * 1024)
    return {
      success: false,
      error: "Schedule source exceeds synchronization capacity",
    };
  const result = await runCronCommand(
    ["source-restore"],
    captured.profile,
    input,
  );
  return parseOriginalCronRestoreResult(result.output, captured);
}

/** Existing preview remains read-only; complete capture precedes its restricted projection. */
export async function previewLocalSchedules(
  profile: string,
): Promise<NativeScheduleDraft[]> {
  const raw =
    captureOriginalCronFile(profileHome(profile), profile)?.file ?? [];
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && "jobs" in raw
      ? (raw as { jobs: unknown }).jobs
      : [];
  if (!Array.isArray(rows) || rows.length > 100)
    throw Error("Local schedule preview capacity exceeded");
  return projectLocalSchedules(
    rows
      .filter((value) => value && typeof value === "object")
      .map((value) => normalizeJob(value as Record<string, unknown>))
      .filter((job): job is CronJob => !!job),
  );
}

/** Main lifecycle producer after exact source/resource publication; never renderer IPC. */
export async function bindOriginalCronExecution(
  request: OriginalScheduleAgentBinding,
  assertActive: () => Promise<void>,
): Promise<{ bindingDigest: string }> {
  if (isRemoteMode() || !validOriginalScheduleAgentBinding(request))
    throw Error("Original schedule binding unavailable");
  return bindOriginalScheduleAgent(
    request,
    {
      executable: HERMES_PYTHON,
      cliArgs: hermesCliArgs(),
      cwd: join(HERMES_HOME, "hermes-agent"),
      env: { ...process.env, ...secureSpawnEnv(request.profile) },
    },
    assertActive,
  );
}

/** Guard original source before the automatic coordinator writes authored enabled/state data. */
export async function prepareOriginalCronExecution(
  request: OriginalScheduleAgentPreparation,
  assertActive: () => Promise<void>,
): Promise<{ bindingDigest: string }> {
  if (isRemoteMode() || !validOriginalScheduleAgentPreparation(request))
    throw Error("Original schedule binding unavailable");
  return prepareOriginalScheduleAgent(
    request,
    {
      executable: HERMES_PYTHON,
      cliArgs: hermesCliArgs(),
      cwd: join(HERMES_HOME, "hermes-agent"),
      env: { ...process.env, ...secureSpawnEnv(request.profile) },
    },
    assertActive,
  );
}
