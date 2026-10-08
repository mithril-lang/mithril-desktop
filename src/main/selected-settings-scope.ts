import {
  getActiveConnection,
  getConnectionConfig,
  type ConnectionConfig,
} from "./config";
import { getActiveProfileNameSync } from "./utils";

export function selectedSettingsScope(profile?: string): {
  connection: ConnectionConfig;
  profile: string;
  check: () => void;
} {
  const implicit = !profile?.trim();
  const selectedProfile = profile?.trim() || getActiveProfileNameSync();
  if (
    selectedProfile === "all" ||
    selectedProfile.length > 128 ||
    selectedProfile.includes("/") ||
    selectedProfile.includes("\\") ||
    [...selectedProfile].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error("A single valid tool-settings profile is required.");
  const connection = structuredClone(getConnectionConfig());
  const stamp = (): string =>
    JSON.stringify([
      getActiveConnection().connectionId,
      getConnectionConfig(),
      implicit ? getActiveProfileNameSync() : selectedProfile,
    ]);
  const owner = stamp();
  return {
    connection,
    profile: selectedProfile,
    check: () => {
      if (stamp() !== owner)
        throw new Error(
          "Tool-settings connection or profile changed. A submitted change may have completed; refresh the original target before retrying.",
        );
    },
  };
}
