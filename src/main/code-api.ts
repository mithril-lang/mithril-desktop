// @lat: [[mithril-code#Mithril Code#GitHub publication]]
import { codeRequestPath, type CodeCredentials } from "@mithril/workspace/code";
/** Fixed-origin publication transport; no profile files, ambient keys or generic URL proxy. */
export async function codeApi(
  path: unknown,
  body: unknown,
  keys: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  if (
    typeof path !== "string" ||
    !codeRequestPath(path) ||
    !path.startsWith("/api/github/")
  )
    return { ok: false, error: "invalid_action" };
  if (!keys || typeof keys !== "object")
    return { ok: false, error: "github_connection_required" };
  const credentials = keys as CodeCredentials;
  if (
    typeof credentials.github !== "string" ||
    !credentials.github ||
    credentials.github.length > 1024
  )
    return { ok: false, error: "github_connection_required" };
  if (
    body !== undefined &&
    (!body || typeof body !== "object" || Array.isArray(body))
  )
    return { ok: false, error: "invalid_action" };
  const raw = body === undefined ? undefined : JSON.stringify(body);
  if (raw && Buffer.byteLength(raw) > 2100000)
    return { ok: false, error: "request_budget" };
  try {
    const r = await fetch("https://code.mithril.fund" + path, {
      method: raw ? "POST" : "GET",
      redirect: "error",
      headers: {
        authorization: "Bearer " + credentials.github,
        origin: "https://code.mithril.fund",
        ...(raw ? { "content-type": "application/json" } : {}),
      },
      ...(raw ? { body: raw } : {}),
      signal: AbortSignal.timeout(90000),
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
