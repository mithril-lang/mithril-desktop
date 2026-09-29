// @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account]]
/** Mirror the stored Mithril token into the agent's provider environment. */
import { setEnvValue } from "./config";
import { mirrorFirstPartyAgentProviders } from "./agent-config-providers";

export const MITHRIL_API_KEY_ENV = "MITHRIL_API_KEY";

/**
 * Make `token` the profile's Mithril inference key, so the agent (which reads
 * `.env`, not the encrypted token file) talks to api.mithril.fund with it.
 */
export function syncMithrilKey(
  profile: string | undefined,
  token: string,
): void {
  setEnvValue(MITHRIL_API_KEY_ENV, token, profile);
  // Adds the named `providers: mithril` entry (api.mithril.fund/v1) that the
  // agent routes by slug; it is written only while the key is present.
  mirrorFirstPartyAgentProviders(profile);
}

export function unsyncMithrilKey(profile: string | undefined): void {
  setEnvValue(MITHRIL_API_KEY_ENV, "", profile);
}
