// @lat: [[mithril-migration#Mithril desktop migration#Token-only-in-secure-store]]
/**
 * Environment values that never touch a `.env` file. A source is registered at
 * startup (Mithril's token comes from the keychain / encrypted file) and is
 * overlaid onto `readEnv`, so every spawn site that copies the profile env
 * hands the agent the value in memory only. Kept dependency-free so both
 * config.ts and agent-config-providers.ts can import it without a cycle.
 */
export type SecureEnvSource = (profile?: string) => Record<string, string>;

let source: SecureEnvSource | null = null;

export function registerSecureEnvSource(next: SecureEnvSource | null): void {
  source = next;
}

export function secureEnvFor(profile?: string): Record<string, string> {
  if (!source) return {};
  try {
    return source(profile);
  } catch {
    return {};
  }
}

/** What the renderer sees in place of a connected Mithril token. */
export const MITHRIL_TOKEN_PLACEHOLDER = "mf_••••••••";
