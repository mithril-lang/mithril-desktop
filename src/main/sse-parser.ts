/**
 * Extracted SSE parsing logic — testable without Electron or HTTP.
 */

import {
  chatToolEventFromPayload,
  chatToolProgressLabel,
  type ChatToolEvent,
} from "../shared/chat-stream";

export interface ParsedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
}

export interface SseCallbacks {
  onChunk: (text: string) => void;
  onToolProgress?: (tool: string) => void;
  onToolEvent?: (event: ChatToolEvent) => void;
  onUsage?: (usage: ParsedUsage) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

/** Tool progress pattern: `emoji tool_name` or `emoji description` */
const toolProgressRe = /^`([^\s`]+)\s+([^`]+)`$/;

/**
 * Process a custom SSE event (e.g. hermes.tool.progress).
 * Returns true if the event was handled.
 */
export function processCustomEvent(
  eventType: string,
  data: string,
  cb: Pick<SseCallbacks, "onToolProgress" | "onToolEvent">,
): boolean {
  if (eventType === "hermes.tool.progress") {
    try {
      const payload = JSON.parse(data) as Record<string, unknown>;
      const toolEvent = chatToolEventFromPayload(payload);
      if (cb.onToolEvent) {
        cb.onToolEvent(toolEvent);
      }
      if (!cb.onToolEvent && cb.onToolProgress) {
        cb.onToolProgress(chatToolProgressLabel(toolEvent));
      }
      return !!cb.onToolProgress || !!cb.onToolEvent;
    } catch {
      /* malformed — skip */
    }
  }
  return false;
}

export interface SseDataResult {
  done: boolean;
  hasContent: boolean;
  error?: string;
}

export interface SseParseState {
  hasContent: boolean;
  hasToolCallDelta?: boolean;
  toolCallFinished?: boolean;
  lastError: string;
}

export type SseTerminalDisposition =
  | { kind: "done" }
  | { kind: "error"; error: string }
  | { kind: "probe" };

export function hasOpenAiToolCallDelta(delta: unknown): boolean {
  if (delta === null || typeof delta !== "object" || Array.isArray(delta)) {
    return false;
  }
  const toolCalls = (delta as Record<string, unknown>).tool_calls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

export function hasOpenAiToolCallFinishReason(choice: unknown): boolean {
  return (
    choice !== null &&
    typeof choice === "object" &&
    !Array.isArray(choice) &&
    (choice as Record<string, unknown>).finish_reason === "tool_calls"
  );
}

export function emptySseTerminalError(
  lastError: string,
  hasToolCallDelta: boolean,
  toolCallFinished = false,
): string {
  if (lastError) return lastError;
  if (hasToolCallDelta && toolCallFinished) {
    return "The provider returned a raw tool call that this transport does not execute. No tool was run.";
  }
  return hasToolCallDelta
    ? "The provider stream ended before a tool call completed. The incomplete tool call was not executed."
    : "";
}

/** Decide exactly one terminal action. Errors and observed raw tool calls must
 * outrank prefix text, otherwise a partial tool stream can be reported as a
 * successful answer and trigger unsafe follow-up behavior. */
export function sseTerminalDisposition(
  state: SseParseState,
): SseTerminalDisposition {
  const error = emptySseTerminalError(
    state.lastError,
    !!state.hasToolCallDelta,
    !!state.toolCallFinished,
  );
  if (error) return { kind: "error", error };
  if (state.hasContent) return { kind: "done" };
  return { kind: "probe" };
}

export function completeSseStream(
  state: SseParseState,
  cb: Pick<SseCallbacks, "onDone" | "onError">,
): SseTerminalDisposition {
  const disposition = sseTerminalDisposition(state);
  if (disposition.kind === "error") cb.onError?.(disposition.error);
  if (disposition.kind === "done") cb.onDone?.();
  return disposition;
}

function safeDiagnosticField(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= 256 && !/[\r\n]/.test(text) ? text : "";
}

/** Preserve correlation metadata without serializing an entire provider error
 * object, which can include request bodies or other unsafe diagnostic fields. */
export function formatSseError(payload: unknown): string {
  const row =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const error =
    row.error !== null &&
    typeof row.error === "object" &&
    !Array.isArray(row.error)
      ? (row.error as Record<string, unknown>)
      : {};
  const message =
    safeDiagnosticField(error.message) ||
    safeDiagnosticField(row.error) ||
    safeDiagnosticField(row.message) ||
    "Provider stream failed";
  const code = safeDiagnosticField(error.code || error.type || row.code);
  const requestId = safeDiagnosticField(
    error.request_id ||
      error.requestId ||
      row.request_id ||
      row.requestId ||
      row.upstream_request_id,
  );
  const codeSuffix = code && !message.includes(code) ? ` [${code}]` : "";
  const requestSuffix =
    requestId && !message.includes(requestId)
      ? ` (Request ID: ${requestId})`
      : "";
  return `${message}${codeSuffix}${requestSuffix}`;
}

/**
 * Process a single SSE data payload (after `data: ` prefix is stripped).
 * Returns parsing result.
 */
export function processSseData(
  data: string,
  cb: SseCallbacks,
  state: SseParseState,
): SseDataResult {
  if (data === "[DONE]") {
    const disposition = completeSseStream(state, cb);
    if (disposition.kind === "error") state.lastError = disposition.error;
    return { done: true, hasContent: state.hasContent, error: state.lastError };
  }

  try {
    const parsed = JSON.parse(data);

    // Capture error responses forwarded through SSE
    if (parsed.error) {
      state.lastError = formatSseError(parsed);
      return { done: false, hasContent: state.hasContent };
    }

    const delta = parsed.choices?.[0]?.delta;
    // Observe raw OpenAI tool-call fragments so a tool-only/partial stream is
    // never mistaken for an empty response and replayed by a diagnostic probe.
    // Desktop deliberately does not parse or execute these arguments.
    if (hasOpenAiToolCallDelta(delta)) {
      state.hasToolCallDelta = true;
    }
    if (hasOpenAiToolCallFinishReason(parsed.choices?.[0])) {
      state.toolCallFinished = true;
    }

    // Extract usage from final chunk
    if (parsed.usage && cb.onUsage) {
      cb.onUsage({
        promptTokens: parsed.usage.prompt_tokens || 0,
        completionTokens: parsed.usage.completion_tokens || 0,
        totalTokens: parsed.usage.total_tokens || 0,
        cost: parsed.usage.cost,
        rateLimitRemaining: parsed.usage.rate_limit_remaining,
        rateLimitReset: parsed.usage.rate_limit_reset,
      });
    }

    if (delta?.content) {
      const content = delta.content.trim();
      // Legacy: Detect tool progress lines injected into content
      const match = toolProgressRe.exec(content);
      if (match && cb.onToolProgress) {
        cb.onToolProgress(`${match[1]} ${match[2]}`);
      } else {
        state.hasContent = true;
        cb.onChunk(delta.content);
      }
    }
  } catch {
    /* malformed chunk — skip */
  }

  return { done: false, hasContent: state.hasContent };
}

/**
 * Parse a full SSE block (may contain `event:` and `data:` lines).
 * Returns { eventType, data } or null if no data line found.
 */
export function parseSseBlock(
  block: string,
): { eventType: string; data: string } | null {
  let eventType = "";
  let dataLine = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLine = line.slice(6);
    }
  }
  if (!dataLine) return null;
  return { eventType, data: dataLine };
}
