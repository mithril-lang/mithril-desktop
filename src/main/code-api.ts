// @lat: [[mithril-code#Mithril Code#GitHub publication]]
import { codeRequestPath, type CodeCredentials } from "@mithril/workspace/code";
/** Fixed-origin publication transport; no profile files, ambient keys or generic URL proxy. */
export async function codeApi(
  path: unknown,
  body: unknown,
  keys: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  if (path === "/api/compile") {
    const value = body as { source?: unknown } | undefined;
    if (
      !value ||
      Object.keys(value).length !== 1 ||
      typeof value.source !== "string" ||
      Buffer.byteLength(value.source) > 8192
    )
      return { ok: false, error: "request_budget" };
    return sendCode(
      path,
      JSON.stringify(value),
      { github: "", provider: "" },
      true,
    );
  }
  if (
    typeof path !== "string" ||
    !codeRequestPath(path) ||
    !path.startsWith("/api/github/")
  )
    return { ok: false, error: "invalid_action" };
  const credentials = validCredentials(keys);
  if (!credentials) return { ok: false, error: "github_connection_required" };
  if (
    body !== undefined &&
    (!body || typeof body !== "object" || Array.isArray(body))
  )
    return { ok: false, error: "invalid_action" };
  const raw = body === undefined ? undefined : JSON.stringify(body);
  if (raw && Buffer.byteLength(raw) > 2100000)
    return { ok: false, error: "request_budget" };
  return sendCode(path, raw, credentials, false);
}
function validCredentials(keys: unknown): CodeCredentials | null {
  if (!keys || typeof keys !== "object") return null;
  const c = keys as CodeCredentials;
  if (
    typeof c.github !== "string" ||
    !c.github ||
    c.github.length > 1024 ||
    (c.provider !== undefined &&
      (typeof c.provider !== "string" || c.provider.length > 1024))
  )
    return null;
  return c;
}
/** Explicit remote execution choice; never a fallback from the profile runner. */
export async function codeServiceRun(
  goal: unknown,
  keys: unknown,
): ReturnType<typeof codeApi> {
  if (typeof goal !== "string" || !goal.trim() || goal.length > 2000)
    return { ok: false, error: "invalid_goal" };
  const c = keys as CodeCredentials | undefined;
  if (
    !c ||
    typeof c.provider !== "string" ||
    !c.provider.trim() ||
    c.provider.length > 1024
  )
    return { ok: false, error: "mithril_connection_required" };
  const credentials = { github: "", provider: c.provider };
  return sendCode(
    "/api/runs",
    JSON.stringify({
      template: "mithril-app",
      goal,
      request_id: crypto.randomUUID(),
    }),
    credentials,
    true,
  );
}
export async function codeServiceStatus(): ReturnType<typeof codeApi> {
  try {
    const r = await fetch("https://code.mithril.fund/api/status", {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    return r.ok
      ? { ok: true, value: await r.json() }
      : { ok: false, error: "runner_unavailable" };
  } catch {
    return { ok: false, error: "runner_unavailable" };
  }
}
async function sendCode(
  path: string,
  raw: string | undefined,
  credentials: CodeCredentials,
  run: boolean,
): ReturnType<typeof codeApi> {
  try {
    const r = await fetch("https://code.mithril.fund" + path, {
      method: raw ? "POST" : "GET",
      redirect: "error",
      headers: {
        ...(run ? {} : { authorization: "Bearer " + credentials.github }),
        origin: "https://code.mithril.fund",
        ...(raw ? { "content-type": "application/json" } : {}),
        ...(run && credentials.provider
          ? { "x-mithril-token": credentials.provider }
          : {}),
      },
      ...(raw ? { body: raw } : {}),
      signal: AbortSignal.timeout(run ? 190000 : 90000),
    });
    const text = await r.text();
    if (Buffer.byteLength(text) > 2100000)
      return { ok: false, error: "response_budget" };
    const value = JSON.parse(text);
    return r.ok
      ? { ok: true, value }
      : {
          ok: false,
          error:
            typeof value.error?.code === "string"
              ? value.error.code
              : "service_unavailable",
        };
  } catch {
    return { ok: false, error: "outcome_unknown" };
  }
}
