/** Desktop inference has one provider; legacy storage is never rewritten on read. */
export const MITHRIL_PROVIDER = "mithril";
export const MITHRIL_PROVIDER_NAME = "Mithril Agent";
export const MITHRIL_PROVIDER_URL = "https://api.mithril.fund/v1";
export const MITHRIL_DEFAULT_MODEL = "qwen/qwen3.8-27b";
export function isMithrilProvider(provider: string, baseUrl = ""): boolean {
  const endpoint = baseUrl.replace(/\/+$/, "");
  return (
    (provider === "mithril" ||
      provider === "custom:mithril" ||
      (provider === "custom" && endpoint === MITHRIL_PROVIDER_URL)) &&
    (!endpoint || endpoint === MITHRIL_PROVIDER_URL)
  );
}
export function requireMithrilProvider(provider: string, baseUrl = ""): void {
  if (!isMithrilProvider(provider, baseUrl))
    throw new Error("Mithril Desktop supports only Mithril Agent.");
}
export function mithrilModelConfig(config: {
  provider: string;
  model: string;
  baseUrl: string;
}): { provider: string; model: string; baseUrl: string } {
  return {
    provider: MITHRIL_PROVIDER,
    baseUrl: MITHRIL_PROVIDER_URL,
    model:
      isMithrilProvider(config.provider, config.baseUrl) && config.model
        ? config.model
        : MITHRIL_DEFAULT_MODEL,
  };
}
