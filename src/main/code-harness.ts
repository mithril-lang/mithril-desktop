// @lat: [[mithril-code#Mithril Code#Native execution]]
import { spawn } from "child_process";
import { homedir } from "os";
import { readEnv } from "./config";
import {
  HERMES_PYTHON,
  HERMES_REPO,
  hermesCliArgs,
  getEnhancedPath,
} from "./installer";
import { profileHome } from "./utils";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import {
  parseCodeHarnessResponse,
  type CodeHarnessResponse,
} from "../shared/code-harness";

const running = new Set<string>();
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
    // Only the selected profile may provide the Mithril API credential. No launch-profile API keys.
    const env: NodeJS.ProcessEnv = {
      PATH: getEnhancedPath(),
      HOME: homedir(),
      HERMES_HOME: home,
    };
    for (const key of [
      "SystemRoot",
      "WINDIR",
      "USERPROFILE",
      "LOCALAPPDATA",
      "APPDATA",
      "TEMP",
      "TMP",
      "TMPDIR",
      "LANG",
    ])
      if (process.env[key]) env[key] = process.env[key];
    const token = readEnv(profile).MITHRIL_API_KEY;
    if (token) env.MITHRIL_API_KEY = token;
    return await new Promise<CodeHarnessResponse>((resolve) => {
      const child = spawn(
        HERMES_PYTHON,
        hermesCliArgs(["mithril-code", action, "--stdin"]),
        {
          cwd: HERMES_REPO,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          ...HIDDEN_SUBPROCESS_OPTIONS,
        },
      );
      let output = "",
        settled = false;
      const finish = (value: CodeHarnessResponse): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(
        () => {
          child.kill();
          finish({
            ok: false,
            error:
              action === "run" ? "run_outcome_unknown" : "runner_unavailable",
          });
        },
        action === "run" ? 195000 : 20000,
      );
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (Buffer.byteLength(output) > 2_100_000) {
          child.kill();
          finish({ ok: false, error: "invalid_runner_response" });
        }
      });
      child.stderr.on("data", () => {});
      child.on("error", () =>
        finish({ ok: false, error: "code_plugin_unavailable" }),
      );
      child.on("close", (code) =>
        finish(
          code === 0
            ? parseCodeHarnessResponse(output)
            : { ok: false, error: "code_plugin_unavailable" },
        ),
      );
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ goal: action === "run" ? goal : "" }));
    });
  } catch {
    return { ok: false, error: "code_plugin_unavailable" };
  } finally {
    running.delete(home);
  }
}
