// @lat: [[mithril-migration#Mithril desktop migration#First-run connect#In-app chat]]
/** Chat with the Mithril API using only the stored mf_ bearer. */
import { mithrilApiOrigin } from "./mithril-token";
import { readMithrilToken } from "./mithril-token-store";
import type { MithrilChatResult } from "../shared/account";

export const MITHRIL_CHAT_MODEL = "qwen/qwen3.8-27b";
// Qwen3.8-27B's native context. A smaller cap is spent on hidden reasoning.
export const MITHRIL_CHAT_MAX_TOKENS = 262144;
/** One recovery attempt when the first reply is empty because reasoning ate the budget. */
export const MITHRIL_CHAT_RETRY_MAX_TOKENS = 262144;

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

/** True when the API spent the completion budget on hidden reasoning (ADR 0025). */
export function isReasoningBudgetExhausted(
  response: Response,
  body: unknown,
): boolean {
  if (
    response.headers.get("x-mithril-notice") === "reasoning_budget_exhausted"
  ) {
    return true;
  }
  const choice = (
    body as {
      choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
    } | null
  )?.choices?.[0];
  const content = text(choice?.message?.content);
  return !content && choice?.finish_reason === "length";
}

async function postChat(
  token: string,
  messages: ChatMessage[],
  maxTokens: number,
  fetchImpl: typeof fetch,
): Promise<{ response: Response; body: unknown }> {
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
        messages,
        max_tokens: maxTokens,
        stream: false,
      }),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  return { response, body };
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
    let { response, body } = await postChat(
      token,
      clean,
      MITHRIL_CHAT_MAX_TOKENS,
      fetchImpl,
    );
    if (response.status !== 200) {
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      return {
        ok: false,
        error: typeof code === "string" ? code : `HTTP ${response.status}`,
      };
    }
    let parsed = parseChatReply(body);
    if (
      !parsed.ok &&
      parsed.error === "empty_reply" &&
      isReasoningBudgetExhausted(response, body)
    ) {
      ({ response, body } = await postChat(
        token,
        clean,
        MITHRIL_CHAT_RETRY_MAX_TOKENS,
        fetchImpl,
      ));
      if (response.status !== 200) {
        const code = (body as { error?: { code?: unknown } } | null)?.error
          ?.code;
        return {
          ok: false,
          error: typeof code === "string" ? code : `HTTP ${response.status}`,
        };
      }
      parsed = parseChatReply(body);
      if (!parsed.ok && parsed.error === "empty_reply") {
        return { ok: false, error: "reasoning_budget_exhausted" };
      }
    }
    return parsed;
  } catch {
    // No exception text: it could embed request headers.
    return { ok: false, error: "mithril_api_unavailable" };
  }
}
