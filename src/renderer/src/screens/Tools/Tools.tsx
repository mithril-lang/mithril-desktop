import { DesktopCapability } from "@mithril/workspace/desktop-capability";
import { useCapabilityPorts } from "./useCapabilityPorts";
import type { ComponentProps } from "react";

export default function Tools(
  props: Omit<ComponentProps<typeof DesktopCapability>, "platform" | "locale">,
): React.JSX.Element {
  const platform = useCapabilityPorts();
  return <DesktopCapability platform={platform} {...props} />;
}
