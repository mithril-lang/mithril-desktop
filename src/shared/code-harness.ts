export interface CodeHarnessResult {
  format: "mithril.code-project/v1" | "mithril.language-project/v1";
  verified: true;
  files: Record<string, string>;
  logic: Record<string, unknown>;
  metrics: Record<string, unknown>;
  receipt?: Record<string, unknown>;
}
export type CodeHarnessResponse =
  | { ok: true; ready: true; busy: boolean; template: "todo" | "mithril-app" }
  | { ok: true; result: CodeHarnessResult }
  | { ok: false; error: string };

export function parseCodeHarnessResponse(output: string): CodeHarnessResponse {
  try {
    const value = JSON.parse(output.trim().split("\n").at(-1) ?? "") as Record<
      string,
      unknown
    >;
    if (value.ok === false) {
      const allowed = [
        "invalid_goal",
        "runner_not_configured",
        "mithril_quota_exhausted",
        "invalid_runner_url",
        "runner_authorization_required",
        "runner_busy",
        "harness_verification_failed",
        "runner_request_failed",
        "run_outcome_unknown",
        "runner_unavailable",
        "invalid_runner_response",
        "invalid_action",
      ];
      return {
        ok: false,
        error: allowed.includes(String(value.error))
          ? String(value.error)
          : "invalid_runner_response",
      };
    }
    if (
      value.ok === true &&
      value.ready === true &&
      ["todo", "mithril-app"].includes(String(value.template))
    )
      return {
        ok: true,
        ready: true,
        busy: value.busy === true,
        template: value.template as "todo" | "mithril-app",
      };
    const result = value.result as CodeHarnessResult | undefined;
    if (
      value.ok === true &&
      result?.format === "mithril.language-project/v1" &&
      result.verified === true &&
      result.metrics?.["verification-passed"] === true &&
      result.logic?.format === "https://mithril.fund/artifact/app-agent-v1" &&
      result.receipt?.format === "mithril.language-inference-receipt/v1" &&
      result.receipt?.status === "admitted" &&
      result.receipt?.compiler === "https://app.mithril.fund/api/compile" &&
      result.receipt?.source === result.files?.["application.mith"] &&
      Object.keys(result.files ?? {})
        .sort()
        .join(",") ===
        ".nojekyll,README.md,application.mith,artifact.json,index.html" &&
      Object.values(result.files).every((source) => typeof source === "string")
    )
      return { ok: true, result };
    if (
      value.ok === true &&
      result?.verified === true &&
      result.format === "mithril.code-project/v1" &&
      result.metrics &&
      result.logic &&
      result.files &&
      Object.keys(result.files).sort().join(",") ===
        "src/todo/interaction.cljk,src/todo/summary.cljk" &&
      Object.values(result.files).every((source) => typeof source === "string")
    )
      return { ok: true, result };
  } catch {
    /* A missing/old plugin may emit help instead of JSON. */
  }
  return { ok: false, error: "code_plugin_unavailable" };
}
