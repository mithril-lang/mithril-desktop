import { useEffect, useState } from "react";
import type { SettingsModalContextValue } from "../../components/settings/SettingsModalContext";

/** Keep the settings target explicit without changing the visible Chat's agent. */
export function useWorkspaceSettingsRoute(
  register: SettingsModalContextValue["registerWorkspaceSettings"],
  activeProfile: string,
  open: () => void,
): { profile: string; section?: string; nonce: number } {
  const [request, setRequest] = useState<{
    profile?: string;
    section?: string;
    nonce: number;
  }>({ nonce: 0 });
  useEffect(
    () =>
      register((section, options) => {
        setRequest((previous) => ({
          profile: options?.profile ?? activeProfile,
          section,
          nonce: previous.nonce + 1,
        }));
        open();
        return true;
      }),
    [register, activeProfile, open],
  );
  return { ...request, profile: request.profile ?? activeProfile };
}
