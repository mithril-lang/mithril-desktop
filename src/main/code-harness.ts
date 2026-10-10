// @lat: [[mithril-code#Mithril Code#Native execution]]
import { codeCredential } from "./code-credential";
import { profileHome } from "./utils";
import { codeServiceRun, codeServiceStatus } from "./code-api";
import {
  parseCodeHarnessResponse,
  type CodeHarnessResponse,
} from "../shared/code-harness";

const running = new Set<string>();
/** Owned Mithril generation needs no separately installed Hermes CLI. */
export async function codeHarness(
  action: unknown,
  goal: unknown,
  profile?: string,
): Promise<CodeHarnessResponse> {
  if (action !== "status" && action !== "run")
    return { ok: false, error: "invalid_action" };
  if (
    action === "run" &&
    (typeof goal !== "string" || !goal.trim() || goal.length > 2000)
  )
    return { ok: false, error: "invalid_goal" };
  let home: string;
  try {
    home = profileHome(profile);
  } catch {
    return { ok: false, error: "invalid_profile" };
  }
  if (running.has(home)) return { ok: false, error: "runner_busy" };
  running.add(home);
  try {
    // Only the initiating profile's stored credential can authorize inference.
    // The renderer, sandbox, launch environment and other profiles never receive it.
    const token = await codeCredential(profile);
    if (!token || !/^mf_/.test(token))
      return { ok: false, error: "mithril_connection_required" };
    if (action === "status") {
      const response = await codeServiceStatus();
      if (!response.ok) return response;
      const status = response.value as { ready?: boolean };
      return status?.ready === true
        ? { ok: true, ready: true, busy: false, template: "mithril-app" }
        : { ok: false, error: "runner_unavailable" };
    }
    // One POST only. An uncertain result must never trigger fallback or replay.
    const response = await codeServiceRun(goal, { provider: token });
    if (!response.ok) return response;
    return parseCodeHarnessResponse(
      JSON.stringify({ ok: true, result: response.value }),
    );
  } catch {
    return {
      ok: false,
      error: action === "run" ? "run_outcome_unknown" : "runner_unavailable",
    };
  } finally {
    running.delete(home);
  }
}
