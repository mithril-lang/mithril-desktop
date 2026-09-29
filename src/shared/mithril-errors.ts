// @lat: [[mithril-migration#Mithril desktop migration#Mithril API error surfacing]]
/**
 * Turns a raw agent/API error string into a user-facing Mithril explanation.
 * Pure and dependency-free so both the main process (logs, notifications) and
 * the renderer (chat bubble) can share it. Never echoes the raw string, which
 * may embed request details.
 */
export type MithrilErrorKind =
  | "free_tier_exhausted"
  | "insufficient_credit"
  | "input_too_large"
  | "token_invalid"
  | "insufficient_scope"
  | "research_scope_required"
  | "inference_unavailable";

export type MithrilErrorAction = "open_console" | "open_providers" | "new_chat";

export interface MithrilErrorInfo {
  kind: MithrilErrorKind;
  /** HTTP status the API answered with, when known. */
  status: number | null;
  action: MithrilErrorAction;
  en: { title: string; hint: string };
  ja: { title: string; hint: string };
}

const CODE_RULES: {
  re: RegExp;
  kind: MithrilErrorKind;
  status: number;
  action: MithrilErrorAction;
  en: { title: string; hint: string };
  ja: { title: string; hint: string };
}[] = [
  {
    re: /free_tier_exhausted/i,
    kind: "free_tier_exhausted",
    status: 429,
    action: "open_console",
    en: {
      title: "Daily free limit reached",
      hint: "The free tier allows a limited number of requests per day. Add AI credit in the Mithril console to continue, or try again tomorrow.",
    },
    ja: {
      title: "本日の無料枠を使い切りました",
      hint: "無料枠には 1 日あたりのリクエスト上限があります。Mithril Console で AI クレジットを追加するか、明日までお待ちください。",
    },
  },
  {
    re: /insufficient_credit/i,
    kind: "insufficient_credit",
    status: 402,
    action: "open_console",
    en: {
      title: "Not enough AI credit",
      hint: "Your balance cannot cover this request. Add AI credit in the Mithril console, then send it again.",
    },
    ja: {
      title: "AI クレジットが不足しています",
      hint: "残高がこのリクエストに足りません。Mithril Console でクレジットを追加してから再送してください。",
    },
  },
  {
    re: /input_too_large|exceeds the input limit/i,
    kind: "input_too_large",
    status: 400,
    action: "new_chat",
    en: {
      title: "This conversation is too long for Mithril",
      hint: "The request exceeded the API input limit. Start a new chat, or compress the conversation and try again.",
    },
    ja: {
      title: "会話が長すぎて送信できません",
      hint: "API の入力上限を超えました。新しいチャットを始めるか、会話を圧縮してから再試行してください。",
    },
  },
  {
    re: /mithril_token_required|invalid_mithril_token|token_revoked|invalid_token/i,
    kind: "token_invalid",
    status: 401,
    action: "open_providers",
    en: {
      title: "Mithril token is missing or no longer valid",
      hint: "Reconnect your Mithril account in Providers with a fresh mf_ token.",
    },
    ja: {
      title: "Mithril トークンが無い、または無効です",
      hint: "Providers で新しい mf_ トークンを使ってアカウントを再接続してください。",
    },
  },
  {
    re: /insufficient_scope/i,
    kind: "insufficient_scope",
    status: 403,
    action: "open_providers",
    en: {
      title: "The token is missing a required permission",
      hint: "Reconnect with a token that includes the inference scope.",
    },
    ja: {
      title: "トークンの権限が足りません",
      hint: "inference 権限を含むトークンで再接続してください。",
    },
  },
  {
    re: /research_scope_required/i,
    kind: "research_scope_required",
    status: 403,
    action: "open_providers",
    en: {
      title: "This model is not enabled for your account",
      hint: "Research models need separate access. Pick a different model in Providers.",
    },
    ja: {
      title: "このモデルはアカウントで有効化されていません",
      hint: "リサーチ用モデルには別途権限が必要です。Providers で別のモデルを選んでください。",
    },
  },
  {
    re: /inference_unavailable|inference_not_connected|inference_awaiting_reconciliation/i,
    kind: "inference_unavailable",
    status: 503,
    action: "new_chat",
    en: {
      title: "Mithril inference is temporarily unavailable",
      hint: "This attempt was not billed. Try again in a moment.",
    },
    ja: {
      title: "Mithril の推論が一時的に利用できません",
      hint: "今回の試行は課金されていません。しばらくしてから再試行してください。",
    },
  },
];

/** Returns null for errors that are not a known Mithril API condition. */
export function classifyMithrilError(raw: unknown): MithrilErrorInfo | null {
  if (typeof raw !== "string" || !raw) return null;
  for (const rule of CODE_RULES) {
    if (rule.re.test(raw)) {
      return {
        kind: rule.kind,
        status: rule.status,
        action: rule.action,
        en: rule.en,
        ja: rule.ja,
      };
    }
  }
  return null;
}

/** One-line, secret-free form for logs and OS notifications. */
export function describeMithrilError(
  info: MithrilErrorInfo,
  locale: string,
): string {
  return (locale === "ja" ? info.ja : info.en).title;
}
