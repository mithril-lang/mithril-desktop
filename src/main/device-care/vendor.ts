import { safeStorage } from "electron";
import { lstat, readFile, mkdir, writeFile, rename, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import type { VendorReport } from "../../shared/device-care";

export const VISION_REGIONS = {
  us: "https://api.xdr.trendmicro.com",
  jp: "https://api.xdr.trendmicro.co.jp",
  eu: "https://api.eu.xdr.trendmicro.com",
  au: "https://api.au.xdr.trendmicro.com",
  sg: "https://api.sg.xdr.trendmicro.com",
  in: "https://api.in.xdr.trendmicro.com",
} as const;
export const CONSUMER_MAC = "/Applications/Trend Micro Antivirus.app";
export function secureKeyring(): boolean {
  return (
    safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== "basic_text"
  );
}
export function visionRegion(region: unknown): keyof typeof VISION_REGIONS {
  if (typeof region !== "string" || !Object.hasOwn(VISION_REGIONS, region))
    throw Error("Choose a supported Vision One region");
  return region as keyof typeof VISION_REGIONS;
}
export function projectAlerts(value: unknown): VendorReport["alerts"] {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { items?: unknown }).items)
  )
    throw Error("Invalid Vision One response");
  const items = (value as { items: unknown[] }).items;
  return items.slice(0, 10).map((item) => {
    if (!item || typeof item !== "object")
      throw Error("Invalid Vision One alert");
    const row = item as Record<string, unknown>;
    const field = (key: string): string =>
      typeof row[key] === "string" ? (row[key] as string).slice(0, 500) : "";
    if (!field("id")) throw Error("Vision One alert ID missing");
    return {
      id: field("id"),
      severity: field("severity"),
      name: field("model") || field("description"),
      updatedAt: field("updatedDateTime"),
    };
  });
}
export class DeviceCareVendor {
  constructor(
    private directory: string,
    private request: typeof fetch = fetch,
  ) {}
  private path(): string {
    return join(this.directory, "device-care-vision-one.json");
  }
  async status(): Promise<VendorReport> {
    let consumerInstalled = false;
    if (process.platform === "darwin") {
      try {
        const stat = await lstat(CONSUMER_MAC);
        consumerInstalled = stat.isDirectory() && !stat.isSymbolicLink();
      } catch {
        /* not installed */
      }
    }
    let region: string | null = null;
    try {
      const stored = JSON.parse(await readFile(this.path(), "utf8"));
      region = visionRegion(stored.region);
    } catch {
      /* not configured */
    }
    return {
      consumerInstalled,
      consumerProtection: "unknown",
      configured: region !== null,
      region,
      observedAt: new Date().toISOString(),
      alerts: [],
      coverage: "tenant-first-page",
      nextPage: false,
    };
  }
  async configure(region: unknown, token: unknown): Promise<void> {
    const selected = visionRegion(region);
    if (
      typeof token !== "string" ||
      token.length < 16 ||
      token.length > 8192 ||
      /[\r\n\s]/.test(token)
    )
      throw Error("Invalid API token");
    if (!secureKeyring())
      throw Error(
        "An OS-backed keyring is required; plaintext token storage is refused",
      );
    const encrypted = safeStorage.encryptString(token).toString("base64");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path()}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({ region: selected, encrypted }),
      { flag: "wx", mode: 0o600 },
    );
    await rename(temporary, this.path());
  }
  async disconnect(): Promise<void> {
    await unlink(this.path()).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  async alerts(): Promise<VendorReport> {
    if (!secureKeyring()) throw Error("OS keyring unavailable");
    const saved = JSON.parse(await readFile(this.path(), "utf8"));
    const region = visionRegion(saved.region);
    const token = safeStorage.decryptString(
      Buffer.from(saved.encrypted, "base64"),
    );
    const result = await this.request(
      `${VISION_REGIONS[region]}/v3.0/workbench/alerts`,
      {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    ).catch(() => {
      throw Error("Vision One request failed; check region and connectivity");
    });
    if (!result.ok) {
      await result.body?.cancel();
      throw Error(`Vision One returned HTTP ${result.status}`);
    }
    if (!result.body) throw Error("Vision One response body missing");
    const reader = result.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1024 * 1024)
          throw Error(
            "Vision One response exceeds 1 MiB; coverage unavailable",
          );
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw Error("Vision One response is not JSON");
    }
    const alerts = projectAlerts(value);
    return {
      ...(await this.status()),
      region,
      observedAt: new Date().toISOString(),
      alerts,
      nextPage: !!value.nextLink,
    };
  }
}
