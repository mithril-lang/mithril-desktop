import { useMemo } from "react";
import toast from "react-hot-toast";
import { useI18n } from "../../components/useI18n";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import RemoteNotice from "../../components/RemoteNotice";
import type { CapabilityPlatformValue } from "@mithril/workspace/desktop-capability";

/** Native execution and secrets stay in the native adapter, outside shared UI bodies. */
export function useCapabilityPorts(): CapabilityPlatformValue {
  const { t } = useI18n();
  return useMemo(
    () => ({
      api: window.hermesAPI,
      t,
      confirm: (message) => window.confirm(message),
      notify: (kind, message) => {
        toast[kind](message);
      },
      Markdown: AgentMarkdown,
      RemoteNotice,
    }),
    [t],
  );
}
