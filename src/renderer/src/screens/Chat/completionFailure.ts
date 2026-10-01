import type { ChatMessage } from "./types";

interface CompletionFailure {
  droppedToolNames: string[];
  message: string;
  requestId: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map(cleanText)
        .filter((name) => name && /^[\w.-]{1,128}$/.test(name)),
    ),
  );
}

function requestIdFromPayload(payload: Record<string, unknown>): string {
  const surface = record(payload.error_surface);
  for (const value of [
    payload.upstream_request_id,
    payload.provider_request_id,
    payload.request_id,
    surface.request_id,
  ]) {
    const candidate = cleanText(value);
    if (candidate && candidate.length <= 256 && !/[\r\n]/.test(candidate)) {
      return candidate;
    }
  }
  return "";
}

function droppedToolNamesFromPayload(
  payload: Record<string, unknown>,
): string[] {
  const surface = record(payload.error_surface);
  for (const value of [
    payload.dropped_tool_names,
    payload.incomplete_tool_names,
    payload._dropped_tool_names,
    surface.dropped_tool_names,
    surface.incomplete_tool_names,
  ]) {
    const names = cleanToolNames(value);
    if (names.length) return names;
  }
  return [];
}

function incompleteToolStreamFailure(
  payload: Record<string, unknown>,
  droppedToolNames: ReadonlyArray<string>,
): boolean {
  if (droppedToolNames.length) return true;
  const surface = record(payload.error_surface);
  const code = cleanText(payload.error_code || surface.code).toLowerCase();
  if (
    code === "stream_closed_tool_call" ||
    code === "incomplete_tool_call" ||
    code === "partial_tool_call"
  ) {
    return true;
  }
  const raw = cleanText(payload.error || payload.text || payload.rendered);
  return /(?:stream|connection).*(?:closed|eof|abort|terminat).*(?:tool|function)|(?:incomplete|partial).*(?:tool|function).*(?:call|arguments?)/i.test(
    raw,
  );
}

/**
 * Convert a terminal dashboard payload into a user-facing failure. Structured
 * partial-tool metadata wins over the legacy continuation-ceiling copy: a
 * dropped call is a transport failure, not proof that reasoning used every
 * output token.
 */
export function dashboardCompletionFailure(
  payload: unknown,
): CompletionFailure {
  const row = record(payload);
  const droppedToolNames = droppedToolNamesFromPayload(row);
  const requestId = requestIdFromPayload(row);
  const raw = cleanText(row.error || row.text || row.rendered).replace(
    /^error\s*:\s*/i,
    "",
  );

  if (incompleteToolStreamFailure(row, droppedToolNames)) {
    const tools = droppedToolNames.length
      ? ` (${droppedToolNames.join(", ")})`
      : "";
    const request = requestId ? ` Request ID: ${requestId}.` : "";
    return {
      droppedToolNames,
      requestId,
      message: `The provider stream closed before the tool-call arguments${tools} completed. The incomplete tool call was not executed.${request}`,
    };
  }

  const request =
    requestId && !raw.includes(requestId)
      ? `${raw ? `${raw} ` : ""}(Request ID: ${requestId})`
      : raw;
  return {
    droppedToolNames,
    requestId,
    message: request || "Hermes reported an error",
  };
}

/** Mark only still-running calls from the failed turn; completed calls/results
 * remain canonical and are never rewritten. */
export function failIncompleteToolCalls(
  messages: ReadonlyArray<ChatMessage>,
  droppedToolNames: ReadonlyArray<string>,
): ChatMessage[] {
  if (!droppedToolNames.length) return [...messages];
  const names = new Set(droppedToolNames);
  let changed = false;
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const message = next[i];
    if (message.role === "user") break;
    if (
      message.kind === "tool_call" &&
      message.status === "running" &&
      names.has(message.name)
    ) {
      next[i] = { ...message, status: "failed" as const };
      changed = true;
    }
  }
  return changed ? next : [...messages];
}
