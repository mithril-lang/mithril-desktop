import type { LegacyProviderSnapshot } from "../shared/legacy-provider";
/** Stat-only migration record; no configuration contents, credential reads or writes. */
export function legacyProviderSnapshot(
  userId: string,
  now: number,
  stat: () => { size: number; mtimeMs: number } | null,
): LegacyProviderSnapshot {
  const metadata = stat();
  return {
    policyVersion: 1,
    userId,
    capturedAt: now,
    inferenceOrigin: "https://api.mithril.fund",
    legacyAutomaticUse: false,
    configuration: {
      retained: true,
      present: metadata !== null,
      bytes: metadata?.size ?? null,
      modifiedAt: metadata?.mtimeMs ?? null,
    },
  };
}
