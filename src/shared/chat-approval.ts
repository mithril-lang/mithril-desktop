import {
  normalizeApprovalRequest as sharedNormalizeApprovalRequest,
  normalizeActionEnvelope as sharedNormalizeActionEnvelope,
  gatewayApprovalRequestId as sharedGatewayApprovalRequestId,
  type ChatApprovalRequest,
  type MithrilActionEnvelope,
} from "@mithril/workspace/chat-approval";
export {
  APPROVAL_CHOICES,
  ACTION_RISKS,
} from "@mithril/workspace/chat-approval";
export type {
  ApprovalChoice,
  ActionRisk,
  ChatApprovalRequest,
  MithrilActionEnvelope,
} from "@mithril/workspace/chat-approval";
export function gatewayApprovalRequestId(payload: unknown): string | null {
  return sharedGatewayApprovalRequestId(payload);
}
// @lat: [[mithril-action-plane#Action envelope]]
export function normalizeActionEnvelope(
  value: unknown,
): MithrilActionEnvelope | undefined {
  return sharedNormalizeActionEnvelope(value);
}
export function normalizeApprovalRequest(
  payload: unknown,
  requestId: string,
): ChatApprovalRequest {
  return sharedNormalizeApprovalRequest(payload, requestId);
}
