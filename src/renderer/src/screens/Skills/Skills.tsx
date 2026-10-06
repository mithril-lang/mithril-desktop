import { DesktopSkills } from "@mithril/workspace/desktop-capability";
import { useCapabilityPorts } from "../Tools/useCapabilityPorts";
import type { ComponentProps } from "react";

export default function Skills(
  props: Omit<ComponentProps<typeof DesktopSkills>, "platform" | "locale">,
): React.JSX.Element {
  const platform = useCapabilityPorts();
  return <DesktopSkills platform={platform} {...props} />;
}
