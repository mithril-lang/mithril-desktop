import { DesktopSkills } from "@mithril/workspace/desktop-capability";
import { useCapabilityPorts } from "../Tools/useCapabilityPorts";
import type { ComponentProps } from "react";
import { useI18n } from "../../components/useI18n";

export default function Skills({
  onOpenCleanupSkill,
  ...props
}: Omit<ComponentProps<typeof DesktopSkills>, "platform" | "locale"> & {
  onOpenCleanupSkill?: () => void;
}): React.JSX.Element {
  const platform = useCapabilityPorts();
  const { t } = useI18n();
  return (
    <>
      {onOpenCleanupSkill && (
        <div className="device-care-card">
          <h3>{t("deviceCare.cleanupSkillTitle")}</h3>
          <p>{t("deviceCare.cleanupSkillNote")}</p>
          <button className="btn btn-secondary" onClick={onOpenCleanupSkill}>
            {t("deviceCare.openCleanupSkill")}
          </button>
        </div>
      )}
      <DesktopSkills platform={platform} {...props} />
    </>
  );
}
