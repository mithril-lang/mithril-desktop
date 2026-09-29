// @lat: [[mithril-migration#Mithril desktop migration#Native Mithril account]]
/** Mirror the stored Mithril token into the agent's provider environment. */
import { readEnvFile, setEnvValue } from "./config";
import { readMithrilToken } from "./mithril-token-store";
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

/**
 * The account sign-in and the Providers key field both write MITHRIL_API_KEY,
 * so the environment can end up holding something other than the stored token
 * (an `sk-` key pasted into Providers, a cleared value, a copied profile).
 * Restore it from the encrypted token. The keychain is only read when the
 * environment does not already hold an `mf_` token.
 */
export function repairMithrilKey(
  profile?: string,
): "unchanged" | "repaired" | "no-token" {
  const current = (readEnvFile(profile)[MITHRIL_API_KEY_ENV] ?? "").trim();
  if (current.startsWith("mf_")) return "unchanged";
  const token = readMithrilToken(profile);
  if (!token?.startsWith("mf_")) return "no-token";
  syncMithrilKey(profile, token);
  return "repaired";
}
