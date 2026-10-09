const CONSENT = "mithril.measurement.consent.v1";
const CHANGED = "mithril-measurement-consent-changed";
export function getMithrilMeasurementConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT) === "true";
  } catch {
    return false;
  }
}
export function setMithrilMeasurementConsent(enabled: boolean): void {
  try {
    localStorage.setItem(CONSENT, String(enabled));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGED));
}
/** Only foreground opted-in usage. Retries never block account or chat startup. */
export function startMithrilClientDays(profile?: string): () => void {
  let stopped = false,
    pending = false,
    lastDay = "";
  async function report(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    if (
      stopped ||
      pending ||
      document.visibilityState === "hidden" ||
      !getMithrilMeasurementConsent() ||
      day === lastDay
    )
      return;
    pending = true;
    try {
      if (await window.hermesAPI.recordMithrilClientDay(true, profile))
        lastDay = day;
    } catch {
      /* reporting failure does not interrupt the client */
    } finally {
      pending = false;
    }
  }
  const trigger = (): void => {
    void report();
  };
  trigger();
  const timer = setInterval(trigger, 60_000);
  window.addEventListener(CHANGED, trigger);
  document.addEventListener("visibilitychange", trigger);
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener(CHANGED, trigger);
    document.removeEventListener("visibilitychange", trigger);
  };
}
