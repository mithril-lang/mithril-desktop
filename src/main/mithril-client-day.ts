import { readMithrilToken } from "./mithril-token-store";
import { MITHRIL_API_ORIGIN } from "./mithril-token";

/** Explicit opt-in usage day; the profile bearer remains in the main process. */
export async function recordMithrilClientDay(
  consented: unknown,
  profile?: string,
): Promise<boolean> {
  if (consented !== true) return false;
  const client = (
    { darwin: "macos", win32: "windows", linux: "linux" } as Record<
      string,
      string
    >
  )[process.platform];
  if (!client) return false;
  const token = readMithrilToken(profile);
  if (!token) return false;
  try {
    const response = await fetch(
      `${MITHRIL_API_ORIGIN}/v1/measurement/client-day`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ client, consented: true }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
