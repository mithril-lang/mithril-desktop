import "@mithril/workspace/approval-card.css";
import { memo } from "react";
import { SharedApprovalCard } from "@mithril/workspace/approval-card-react";
import type { ApprovalChoice } from "../../../../shared/chat-approval";
import { useI18n } from "../../components/useI18n";
import type { ApprovalMessage } from "./types";
interface ApprovalCardProps {
  msg: ApprovalMessage;
  isActive?: boolean;
  onRespond: (msg: ApprovalMessage, choice: ApprovalChoice) => Promise<boolean>;
  onResolved: (msg: ApprovalMessage, choice: ApprovalChoice) => void;
}
// @lat: [[mithril-action-plane#Desktop approval projection]]
export const ApprovalCard = memo(function ApprovalCard(
  props: ApprovalCardProps,
): React.JSX.Element {
  const { t } = useI18n();
  return <SharedApprovalCard {...props} translate={t} />;
});
