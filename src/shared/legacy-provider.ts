/** Metadata only: provider names, URLs, keys and config bodies are never projected. */
export interface LegacyProviderSnapshot {
  policyVersion: 1;
  userId: string;
  capturedAt: number;
  inferenceOrigin: "https://api.mithril.fund";
  legacyAutomaticUse: false;
  configuration: {
    retained: true;
    present: boolean;
    bytes: number | null;
    modifiedAt: number | null;
  };
}
