export const APPROVAL_CHOICES = ["once", "session", "always", "deny"] as const;

export type ApprovalChoice = (typeof APPROVAL_CHOICES)[number];

export const ACTION_RISKS = [
  "observe",
  "prepare",
  "reversible",
  "consequential",
  "critical",
] as const;

export type ActionRisk = (typeof ACTION_RISKS)[number];

export interface MithrilActionEnvelope {
  actionId: string;
  digest: string;
  evidenceCount: number;
  expiresAt: string;
  maximumCostMicroUsd: number | null;
  operation: string;
  receiptRequired: boolean;
  reversible: boolean | null;
  risk: ActionRisk;
  target: string;
  version: "mithril.action/v1";
}

export interface ChatApprovalRequest {
  requestId: string;
  command: string;
  description: string;
  choices: ApprovalChoice[];
  action?: MithrilActionEnvelope;
}

const VALID_CHOICES = new Set<string>(APPROVAL_CHOICES);
const VALID_ACTION_RISKS = new Set<string>(ACTION_RISKS);

/** Only a gateway-issued ID can safely address a pending approval. */
export function gatewayApprovalRequestId(payload: unknown): string | null {
  const value = record(payload)?.request_id;
  return typeof value === "string" && value.trim() && value.length <= 256
    ? value
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("")
    .trim()
    .slice(0, maxLength);
}

function firstText(
  sources: Array<Record<string, unknown> | null>,
  fields: string[],
  maxLength: number,
): string {
  for (const source of sources) {
    if (!source) continue;
    for (const field of fields) {
      const value = cleanText(source[field], maxLength);
      if (value) return value;
    }
  }
  return "";
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isSafeInteger(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

// @lat: [[mithril-action-plane#Action envelope]]
function normalizeActionEnvelope(
  value: unknown,
): MithrilActionEnvelope | undefined {
  const source = record(value);
  if (!source) return undefined;
  if (cleanText(source.version, 64) !== "mithril.action/v1") return undefined;

  const actionId = cleanText(source.action_id ?? source.actionId, 256);
  const operation = cleanText(source.operation, 256);
  const target = cleanText(source.target, 2048);
  const riskValue = cleanText(source.risk, 32).toLowerCase();
  if (
    !actionId ||
    !operation ||
    !target ||
    !VALID_ACTION_RISKS.has(riskValue)
  ) {
    return undefined;
  }

  const rawCost = source.maximum_cost_micro_usd ?? source.maximumCostMicroUsd;
  const maximumCostMicroUsd =
    typeof rawCost === "number" && Number.isSafeInteger(rawCost) && rawCost >= 0
      ? Math.min(rawCost, Number.MAX_SAFE_INTEGER)
      : null;

  return {
    actionId,
    digest: cleanText(source.digest, 256),
    evidenceCount: boundedInteger(
      source.evidence_count ?? source.evidenceCount,
      0,
      10_000,
    ),
    expiresAt: cleanText(source.expires_at ?? source.expiresAt, 128),
    maximumCostMicroUsd,
    operation,
    receiptRequired:
      (source.receipt_required ?? source.receiptRequired) !== false,
    reversible: optionalBoolean(source.reversible),
    risk: riskValue as ActionRisk,
    target,
    version: "mithril.action/v1",
  };
}

export function normalizeApprovalRequest(
  payload: unknown,
  requestId: string,
): ChatApprovalRequest {
  const root = record(payload);
  const nested = [
    record(root?.approval),
    record(root?.request),
    record(root?.tool_call),
    record(root?.tool),
  ];
  const sources = [root, ...nested];
  const action = normalizeActionEnvelope(
    root?.action_intent ?? root?.actionIntent ?? root?.action,
  );
  const rawChoices = root?.choices;
  const hasExplicitChoices = Array.isArray(rawChoices);
  const choices: ApprovalChoice[] = [];

  if (hasExplicitChoices) {
    for (const rawChoice of rawChoices) {
      if (typeof rawChoice !== "string") continue;
      const choice = rawChoice.trim().toLowerCase();
      if (!VALID_CHOICES.has(choice)) continue;
      if (choice === "always" && root?.allow_permanent === false) continue;
      if (!choices.includes(choice as ApprovalChoice)) {
        choices.push(choice as ApprovalChoice);
      }
    }
  } else if (root?.smart_denied === true) {
    choices.push("once");
  } else {
    choices.push("once");
    if (typeof root?.allow_permanent === "boolean") choices.push("session");
    if (root?.allow_permanent === true) choices.push("always");
  }

  if (!choices.includes("deny")) choices.push("deny");

  // Consequential actions are bound to one exact plan digest. Persisting the
  // approval beyond that single execution would silently widen authority.
  if (action?.risk === "consequential" || action?.risk === "critical") {
    for (let index = choices.length - 1; index >= 0; index -= 1) {
      if (choices[index] !== "once" && choices[index] !== "deny") {
        choices.splice(index, 1);
      }
    }
    if (!choices.includes("once")) choices.unshift("once");
  }

  return {
    requestId,
    command:
      firstText(
        sources,
        ["command", "cmd", "command_line", "input", "args", "action"],
        8192,
      ) || "Command details unavailable",
    description:
      firstText(
        sources,
        [
          "description",
          "reason",
          "message",
          "prompt",
          "summary",
          "pattern_description",
          "warning",
        ],
        2048,
      ) || "Hermes requires approval before continuing.",
    choices,
    ...(action ? { action } : {}),
  };
}
