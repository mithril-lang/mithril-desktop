// @lat: [[office-cron-presence#Cron presence#Deferring a restart]]
/**
 * Don't restart a profile's gateway out from under its own cron job.
 *
 * Writing a credential — such as an API key in Settings — restarts the local
 * gateway so it picks the value up. That is a
 * convenience, not something the person asked for, and it kills whatever the
 * gateway is running: Hermes reports it as
 * `Gateway shutdown (<phase>) killed the job's tool subprocess before the
 * run finished.` (gateway/run_shutdown.py). Measured 2026-09-22 on this
 * machine's fleet: three profiles lost a daily run to exactly that message,
 * one of them twice, on a day when a key was written while ~10 cron jobs
 * were in flight across the fleet.
 *
 * So an INCIDENTAL restart waits for the profile's cron scheduler to be
 * idle (profile-cron's executions.db read), up to `maxWaitMs`; then it
 * restarts anyway, because a gateway holding a stale key is its own
 * failure and waiting forever would hide it. A restart the person asked
 * for (the Settings button, "restart-gateway") is NOT routed through here —
 * a deliberate restart happens when it is asked for.
 */
import { countRunningExecutions } from "./profile-cron";
import { activeStateDbPath, profilePaths } from "./utils";
import { join } from "path";
import Database from "better-sqlite3";
import { existsSync } from "fs";

/** How long an incidental restart waits for the profile to go idle. */
export const DEFAULT_MAX_WAIT_MS = 10 * 60_000;
/** How often it re-reads executions.db while waiting. */
export const DEFAULT_POLL_MS = 15_000;

export interface DeferResult {
  restarted: boolean;
  /** "idle" — nothing was running; "waited" — a job finished first;
   *  "timeout" — the cap expired and it restarted anyway. */
  reason: "idle" | "waited" | "timeout" | "busy" | "cancelled";
  waitedMs: number;
}

/** One pending deferral per profile: a burst of env writes must not queue
 *  a restart each. */
const pending = new Map<string, Promise<DeferResult>>();
type RestartScope = "gateway" | "mithril-runtime";
type RestartOptions = {
  maxWaitMs?: number;
  pollMs?: number;
  busy?: (profile: string | undefined) => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  forceAfterTimeout?: boolean;
  signal?: AbortSignal;
};

async function sleepUnlessAborted(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!signal) {
    await sleep(ms);
    return false;
  }
  if (signal.aborted) return true;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<true>((resolve) => {
    onAbort = () => resolve(true);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([sleep(ms).then(() => false as const), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function cronBusy(
  profile: string | undefined,
  count: (dir: string) => number = countRunningExecutions,
): boolean {
  try {
    return count(join(profilePaths(profile).home, "cron")) > 0;
  } catch {
    // An unreadable executions.db must not block a credential from taking
    // effect: treat it as idle and restart. The opposite reading would let
    // one broken file freeze every future restart.
    return false;
  }
}

export interface CronExecutionOwner {
  pid: number | null;
  handoff_pending: number;
}

/** Only ESRCH proves an owner is gone; permissions and unknown owners stay busy. */
export function executionOwnerMayBeActive(
  row: CronExecutionOwner,
  probe: (pid: number) => void = (pid) => {
    process.kill(pid, 0);
  },
): boolean {
  if (
    row.handoff_pending ||
    !Number.isSafeInteger(row.pid) ||
    Number(row.pid) <= 0
  )
    return true;
  try {
    probe(Number(row.pid));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function countActiveCronOwners(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const columns = new Set(
      (
        db.prepare("PRAGMA table_info(executions)").all() as {
          name: string;
        }[]
      ).map((column) => column.name),
    );
    if (columns.size === 0) return 0;
    if (!columns.has("status"))
      throw new Error("Unrecognized cron executions schema");
    // Legacy rows without an owner cannot be proved abandoned.
    if (!columns.has("pid")) {
      return Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM executions WHERE status IN ('claimed','running')",
            )
            .get() as { count: number }
        ).count,
      );
    }
    const handoff = columns.has("handoff_pending")
      ? "handoff_pending"
      : "0 AS handoff_pending";
    const rows = db
      .prepare(
        `SELECT pid, ${handoff} FROM executions WHERE status IN ('claimed','running')`,
      )
      .all() as CronExecutionOwner[];
    return rows.filter((row) => executionOwnerMayBeActive(row)).length;
  } finally {
    db.close();
  }
}

/** A fail-closed cron probe for credential-triggered process recreation. */
export function cronBusyStrict(
  profile: string | undefined,
  count: (dbPath: string) => number = (dbPath) => {
    return countActiveCronOwners(dbPath);
  },
  exists: (dbPath: string) => boolean = existsSync,
): boolean {
  const dbPath = join(profilePaths(profile).home, "cron", "executions.db");
  if (!exists(dbPath)) return false;
  try {
    return count(dbPath) > 0;
  } catch (error) {
    return /no such table:\s*executions/i.test(
      error instanceof Error ? error.message : String(error),
    )
      ? false
      : true;
  }
}

/** Active dashboard turns hold a short, renewable lease in state.db. */
export function dashboardTurnBusy(
  profile: string | undefined,
  count: (dbPath: string, nowSeconds: number) => number = (
    dbPath,
    nowSeconds,
  ) => {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db
        .prepare(
          "SELECT COUNT(*) AS count FROM session_turn_leases WHERE expires_at > ?",
        )
        .get(nowSeconds) as { count?: number } | undefined;
      return Number(row?.count ?? 0);
    } finally {
      db.close();
    }
  },
  exists: (dbPath: string) => boolean = existsSync,
): boolean {
  const dbPath = activeStateDbPath(profile);
  if (!exists(dbPath)) return false;
  try {
    return count(dbPath, Date.now() / 1000) > 0;
  } catch (error) {
    // Older Hermes versions may not have the lease table yet. Any other read
    // failure is an unknown safety state, so preserve running work.
    return /no such table:\s*session_turn_leases/i.test(
      error instanceof Error ? error.message : String(error),
    )
      ? false
      : true;
  }
}

/**
 * Restart `profile`'s gateway once its cron scheduler is idle. Returns what
 * happened, so the caller can log it by name rather than guessing.
 */
function restartWhenIdle(
  scope: RestartScope,
  profile: string | undefined,
  restart: (profile?: string) => Promise<unknown>,
  opts: RestartOptions = {},
): Promise<DeferResult> {
  const profileKey = profile?.trim() || "default";
  const key = `${scope}:${profileKey}`;
  const existing = pending.get(key);
  if (existing) return existing;

  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const busy = opts.busy ?? ((p: string | undefined) => cronBusy(p));
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const forceAfterTimeout = opts.forceAfterTimeout ?? true;
  const signal = opts.signal;

  const run = (async (): Promise<DeferResult> => {
    const t0 = now();
    if (signal?.aborted) {
      return { restarted: false, reason: "cancelled", waitedMs: 0 };
    }
    if (!busy(profile)) {
      if (signal?.aborted) {
        return { restarted: false, reason: "cancelled", waitedMs: 0 };
      }
      await restart(profile);
      return { restarted: true, reason: "idle", waitedMs: 0 };
    }
    console.log(
      "gateway-restart-deferred",
      profileKey,
      "a cron attempt is in flight; waiting up to",
      maxWaitMs,
      "ms",
    );
    while (now() - t0 < maxWaitMs) {
      if (await sleepUnlessAborted(sleep, pollMs, signal)) {
        return {
          restarted: false,
          reason: "cancelled",
          waitedMs: now() - t0,
        };
      }
      if (!busy(profile)) {
        const waitedMs = now() - t0;
        console.log(
          "gateway-restart-resumed",
          profileKey,
          "after",
          waitedMs,
          "ms",
        );
        if (signal?.aborted) {
          return { restarted: false, reason: "cancelled", waitedMs };
        }
        await restart(profile);
        return { restarted: true, reason: "waited", waitedMs };
      }
    }
    const waitedMs = now() - t0;
    if (!forceAfterTimeout) {
      console.warn(
        "gateway-restart-still-busy",
        profileKey,
        "after",
        waitedMs,
        "ms — leaving the running work intact",
      );
      return { restarted: false, reason: "busy", waitedMs };
    }
    console.warn(
      "gateway-restart-forced",
      profileKey,
      "still busy after",
      waitedMs,
      "ms — restarting anyway so the new value takes effect",
    );
    await restart(profile);
    return { restarted: true, reason: "timeout", waitedMs };
  })();

  const tracked = run.finally(() => {
    if (pending.get(key) === tracked) pending.delete(key);
  });
  pending.set(key, tracked);
  return tracked;
}

export function restartGatewayWhenIdle(
  profile: string | undefined,
  restart: (profile?: string) => Promise<unknown>,
  opts: RestartOptions = {},
): Promise<DeferResult> {
  return restartWhenIdle("gateway", profile, restart, opts);
}

/** Coalesce secure-account refreshes without colliding with gateway-only writes. */
export function restartMithrilRuntimeWhenIdle(
  profile: string | undefined,
  restart: (profile?: string) => Promise<unknown>,
  opts: RestartOptions = {},
): Promise<DeferResult> {
  return restartWhenIdle("mithril-runtime", profile, restart, {
    ...opts,
    forceAfterTimeout: opts.forceAfterTimeout ?? false,
  });
}

/** Test hook: forget any pending deferral. */
export function resetGatewayRestartDeferrals(): void {
  pending.clear();
}
