import {
  DesktopSshTarget,
  type SshTargetProps,
  type SshTargetPorts,
} from "@mithril/workspace/desktop-settings";
import { useI18n } from "../useI18n";
export type { SshDockerDraft } from "@mithril/workspace/desktop-settings";
const inspectSshHermesTarget = (
  ...args: Parameters<SshTargetPorts["inspectSshHermesTarget"]>
): ReturnType<SshTargetPorts["inspectSshHermesTarget"]> =>
  window.hermesAPI.inspectSshHermesTarget(...args);
const provisionSshDockerTarget = (
  ...args: Parameters<SshTargetPorts["provisionSshDockerTarget"]>
): ReturnType<SshTargetPorts["provisionSshDockerTarget"]> =>
  window.hermesAPI.provisionSshDockerTarget(...args);
export default function SshDockerTargetSection(
  props: SshTargetProps,
): React.JSX.Element {
  return (
    <DesktopSshTarget
      {...props}
      platform={{
        ...useI18n(),
        inspectSshHermesTarget,
        provisionSshDockerTarget,
      }}
    />
  );
}
