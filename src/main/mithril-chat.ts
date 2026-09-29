// @lat: [[mithril-migration#Mithril desktop migration#First-run connect#In-app chat]]
/** Chat with the Mithril API using only the stored mf_ bearer. */
import { mithrilApiOrigin } from "./mithril-token";
import { readMithrilToken } from "./mithril-token-store";
import type { MithrilChatResult } from "../shared/account";

export const MITHRIL_CHAT_MODEL = "qwen/qwen3.8-27b";
// Prod may answer with `reasoning` and empty `content` when the budget is tiny.
export const MITHRIL_CHAT_MAX_TOKENS = 1024;

type ChatMessage = { role: "user" | "assistant"; content: string };

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export function parseChatReply(body: unknown): MithrilChatResult {
  const choice = (
    body as {
      choices?: {
        message?: {
          content?: unknown;
          reasoning?: unknown;
          reasoning_content?: unknown;
        };
      }[];
      model?: unknown;
    } | null
  )?.choices?.[0]?.message;
  const model =
    typeof (body as { model?: unknown } | null)?.model === "string"
      ? String((body as { model: string }).model)
      : MITHRIL_CHAT_MODEL;
  const content = text(choice?.content);
  const reasoning = text(choice?.reasoning) || text(choice?.reasoning_content);
  if (content)
    return {
      ok: true,
      text: content,
      model,
      ...(reasoning ? { reasoning } : {}),
    };
  // Tolerate reasoning-only replies rather than showing nothing.
  if (reasoning) return { ok: true, text: reasoning, model, reasoning };
  return { ok: false, error: "empty_reply" };
}

export async function mithrilChat(
  messages: ChatMessage[],
  profile?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MithrilChatResult> {
  const token = readMithrilToken(profile);
  if (!token) return { ok: false, error: "not_connected" };
  const clean = (Array.isArray(messages) ? messages : [])
    .filter(
      (m) =>
        (m?.role === "user" || m?.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (clean.length === 0) return { ok: false, error: "empty_prompt" };
  try {
    const response = await fetchImpl(
      `${mithrilApiOrigin()}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          model: MITHRIL_CHAT_MODEL,
          messages: clean,
          max_tokens: MITHRIL_CHAT_MAX_TOKENS,
          stream: false,
        }),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      },
    );
    const body: unknown = await response.json().catch(() => null);
    if (response.status !== 200) {
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      return {
        ok: false,
        error: typeof code === "string" ? code : `HTTP ${response.status}`,
      };
    }
    return parseChatReply(body);
  } catch {
    // No exception text: it could embed request headers.
    return { ok: false, error: "mithril_api_unavailable" };
  }
}
