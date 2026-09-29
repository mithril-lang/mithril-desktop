import { memo, useState } from "react";
import {
  APPROVAL_CHOICES,
  type ApprovalChoice,
} from "../../../../shared/chat-approval";
import { useI18n } from "../../components/useI18n";
import type { ApprovalMessage } from "./types";

interface ApprovalCardProps {
  msg: ApprovalMessage;
  isActive?: boolean;
  onRespond: (msg: ApprovalMessage, choice: ApprovalChoice) => Promise<boolean>;
  onResolved: (msg: ApprovalMessage, choice: ApprovalChoice) => void;
}

export const ApprovalCard = memo(function ApprovalCard({
  msg,
  isActive = true,
  onRespond,
  onResolved,
}: ApprovalCardProps): React.JSX.Element {
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [confirmAlways, setConfirmAlways] = useState(false);
  const [error, setError] = useState(false);
  const resolved = !!msg.resolved;
  const unavailable = !!msg.unavailable;
  const choices = APPROVAL_CHOICES.filter((choice) =>
    msg.choices.includes(choice),
  );
  const choiceLabel = (choice: ApprovalChoice): string =>
    t(`chat.approval.${choice}`);

  const submit = async (choice: ApprovalChoice): Promise<void> => {
    if (
      resolved ||
      unavailable ||
      submitting ||
      !isActive ||
      !choices.includes(choice)
    )
      return;
    setSubmitting(true);
    setError(false);
    try {
      const ok = await onRespond(msg, choice);
      if (!ok) {
        setError(true);
        return;
      }
      setConfirmAlways(false);
      onResolved(msg, choice);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`chat-clarify chat-approval-card${
        resolved ? " chat-clarify--resolved" : ""
      }`}
    >
      <div className="chat-approval-heading">{t("chat.approval.title")}</div>
      <div className="chat-clarify-question">{msg.description}</div>
      {/* @lat: [[mithril-action-plane#Desktop approval projection]] */}
      {msg.action && (
        <dl
          className={`chat-action-summary chat-action-summary--${msg.action.risk}`}
        >
          <div>
            <dt>{t("chat.approval.actionRisk")}</dt>
            <dd>{t(`chat.approval.risk.${msg.action.risk}`)}</dd>
          </div>
          <div>
            <dt>{t("chat.approval.actionOperation")}</dt>
            <dd>{msg.action.operation}</dd>
          </div>
          <div>
            <dt>{t("chat.approval.actionTarget")}</dt>
            <dd>{msg.action.target}</dd>
          </div>
          <div>
            <dt>{t("chat.approval.actionEvidence")}</dt>
            <dd>{msg.action.evidenceCount}</dd>
          </div>
          {msg.action.maximumCostMicroUsd !== null && (
            <div>
              <dt>{t("chat.approval.actionMaximumCost")}</dt>
              <dd>
                ${(msg.action.maximumCostMicroUsd / 1_000_000).toFixed(6)}
              </dd>
            </div>
          )}
          {msg.action.expiresAt && (
            <div>
              <dt>{t("chat.approval.actionExpires")}</dt>
              <dd>{msg.action.expiresAt}</dd>
            </div>
          )}
          {msg.action.digest && (
            <div className="chat-action-summary__wide">
              <dt>{t("chat.approval.actionDigest")}</dt>
              <dd className="chat-action-summary__digest">
                {msg.action.digest}
              </dd>
            </div>
          )}
        </dl>
      )}
      <pre className="chat-approval-command">
        <code>{msg.command}</code>
      </pre>

      {unavailable ? (
        <div className="chat-clarify-error" role="alert">
          {t("chat.approval.unavailable")}
        </div>
      ) : resolved ? (
        <div className="chat-clarify-answer">
          {msg.choice ? choiceLabel(msg.choice) : t("chat.approval.responded")}
        </div>
      ) : (
        <>
          <div className="chat-clarify-choices chat-approval-choices">
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                className={`chat-clarify-choice chat-approval-choice--${choice}`}
                disabled={submitting || !isActive}
                onClick={() => {
                  if (choice === "always") {
                    setError(false);
                    setConfirmAlways(true);
                    return;
                  }
                  setConfirmAlways(false);
                  void submit(choice);
                }}
              >
                {choiceLabel(choice)}
              </button>
            ))}
          </div>

          {!isActive && (
            <div className="chat-clarify-answer">
              {t("chat.approval.queued")}
            </div>
          )}

          {confirmAlways && (
            <div className="chat-approval-confirm">
              <span>{t("chat.approval.confirm")}</span>
              <div className="chat-approval-confirm-actions">
                <button
                  type="button"
                  className="chat-clarify-choice"
                  disabled={submitting}
                  onClick={() => setConfirmAlways(false)}
                >
                  {t("chat.approval.cancel")}
                </button>
                <button
                  type="button"
                  className="chat-clarify-send"
                  disabled={submitting}
                  onClick={() => void submit("always")}
                >
                  {t("chat.approval.confirmAlways")}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="chat-clarify-error" role="alert">
          {t("chat.approval.error")}
        </div>
      )}
    </div>
  );
});
