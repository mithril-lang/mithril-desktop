import { createHash, verify } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import bundled from "../../../resources/endpoint/definitions.json";
import trust from "../../../resources/endpoint/trust.json";

export interface Definitions {
  schema: 1;
  version: number;
  content: {
    id: string;
    severity: "medium" | "high";
    hex: string;
    maxBytes: number;
  }[];
  network: {
    fanout: number;
    windowMs: number;
    beaconSamples: number;
    tolerance: number;
  };
  files: { changes: number; windowMs: number };
}
interface SignedManifest {
  payload: string;
  signature: string;
}
export interface Metadata {
  schema: 1;
  version: number;
  expires: string;
  sha256: string;
  size: number;
  target: string;
}
const MAX_PACK = 512 * 1024;
const ORIGIN = "https://raw.githubusercontent.com";
const PREFIX = "/mithril-lang/mithril-desktop/endpoint-definitions/v1/";
export const DEFINITION_FEED = `${ORIGIN}${PREFIX}manifest.json`;

export function validateDefinitions(value: unknown): Definitions {
  const d = value as Definitions;
  if (
    !d ||
    d.schema !== 1 ||
    !Number.isSafeInteger(d.version) ||
    d.version < 1 ||
    !Array.isArray(d.content) ||
    d.content.length > 128 ||
    !d.network ||
    !d.files
  )
    throw Error("Unsupported definition pack");
  const ids = new Set<string>();
  for (const r of d.content) {
    if (
      !r ||
      typeof r.id !== "string" ||
      !/^[a-z0-9-]{1,80}$/.test(r.id) ||
      ids.has(r.id) ||
      !["medium", "high"].includes(r.severity) ||
      typeof r.hex !== "string" ||
      !/^(?:[a-f0-9]{2}){4,256}$/.test(r.hex) ||
      !Number.isInteger(r.maxBytes) ||
      r.maxBytes < 1 ||
      r.maxBytes > 2 * 1024 * 1024
    )
      throw Error("Invalid content rule");
    ids.add(r.id);
  }
  const bounds = [
    [d.network.fanout, 10, 1000],
    [d.network.windowMs, 10000, 3600000],
    [d.network.beaconSamples, 5, 100],
    [d.files.changes, 50, 10000],
    [d.files.windowMs, 10000, 3600000],
  ];
  if (
    bounds.some(
      ([v, min, max]) => !Number.isInteger(v) || v < min || v > max,
    ) ||
    !Number.isFinite(d.network.tolerance) ||
    d.network.tolerance < 0.01 ||
    d.network.tolerance > 0.3
  )
    throw Error("Invalid detection thresholds");
  // Project only admitted data: definitions can never name programs, paths or responses.
  return {
    schema: 1,
    version: d.version,
    content: d.content.map(({ id, severity, hex, maxBytes }) => ({
      id,
      severity,
      hex,
      maxBytes,
    })),
    network: {
      fanout: d.network.fanout,
      windowMs: d.network.windowMs,
      beaconSamples: d.network.beaconSamples,
      tolerance: d.network.tolerance,
    },
    files: { changes: d.files.changes, windowMs: d.files.windowMs },
  };
}

export function verifyManifest(
  envelope: unknown,
  floor: number,
  now = Date.now(),
  publicKey = trust.publicKey,
): Metadata {
  const e = envelope as SignedManifest;
  if (
    !e ||
    typeof e.payload !== "string" ||
    Buffer.byteLength(e.payload) > 8192 ||
    typeof e.signature !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(e.signature) ||
    !verify(
      null,
      Buffer.from(e.payload),
      publicKey,
      Buffer.from(e.signature, "base64"),
    )
  )
    throw Error("Definition signature verification failed");
  const m = JSON.parse(e.payload) as Metadata;
  if (
    m.schema !== 1 ||
    !Number.isSafeInteger(m.version) ||
    m.version < floor ||
    typeof m.expires !== "string" ||
    !Number.isFinite(Date.parse(m.expires)) ||
    Date.parse(m.expires) <= now ||
    Date.parse(m.expires) > now + 15 * 86400000 ||
    typeof m.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(m.sha256) ||
    !Number.isInteger(m.size) ||
    m.size < 1 ||
    m.size > MAX_PACK ||
    m.target !== `packs/${m.sha256}.json`
  )
    throw Error("Expired, rolled-back or invalid definition metadata");
  return m;
}

export function verifyPack(bytes: Buffer, metadata: Metadata): Definitions {
  if (
    bytes.length !== metadata.size ||
    createHash("sha256").update(bytes).digest("hex") !== metadata.sha256
  )
    throw Error("Definition size or digest mismatch");
  const pack = validateDefinitions(JSON.parse(bytes.toString("utf8")));
  if (pack.version !== metadata.version)
    throw Error("Definition version mismatch");
  return pack;
}

async function download(url: string, limit: number): Promise<Buffer> {
  const u = new URL(url);
  if (
    u.origin !== ORIGIN ||
    !u.pathname.startsWith(PREFIX) ||
    u.search ||
    u.hash
  )
    throw Error("Definition origin is not admitted");
  const response = await fetch(u, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    credentials: "omit",
  });
  if (!response.ok || !response.body)
    throw Error(`Definition download failed (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw Error("Definition download exceeds its limit");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

export class DefinitionStore {
  pack = validateDefinitions(bundled);
  source: "bundled" | "signed-update" = "bundled";
  expires: string | null = null;
  private digest: string | null = null;
  private pending: Promise<void> | null = null;
  constructor(
    private directory: string,
    private publicKey = trust.publicKey,
  ) {}
  async load(): Promise<void> {
    try {
      const cached = JSON.parse(
        await readFile(join(this.directory, "current.json"), "utf8"),
      );
      // Expired last-known-good definitions are retained, with freshness shown to the user.
      const signed = JSON.parse(cached.envelope.payload) as Metadata;
      const m = verifyManifest(
        cached.envelope,
        this.pack.version,
        Date.parse(signed.expires) - 1,
        this.publicKey,
      );
      this.pack = verifyPack(Buffer.from(cached.pack, "base64"), m);
      this.source = "signed-update";
      this.expires = m.expires;
      this.digest = m.sha256;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  update(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.performUpdate().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  private async performUpdate(): Promise<void> {
    const envelope = JSON.parse(
      (await download(DEFINITION_FEED, 16384)).toString("utf8"),
    );
    const m = verifyManifest(
      envelope,
      this.pack.version,
      Date.now(),
      this.publicKey,
    );
    if (this.expires && Date.parse(m.expires) < Date.parse(this.expires))
      throw Error("Definition freshness cannot go backwards");
    if (
      this.digest &&
      m.version === this.pack.version &&
      m.sha256 !== this.digest
    )
      throw Error("Same definition version cannot change content");
    const bytes = await download(`${ORIGIN}${PREFIX}${m.target}`, m.size);
    const pack = verifyPack(bytes, m);
    if (
      m.version === this.pack.version &&
      JSON.stringify(pack) !== JSON.stringify(this.pack)
    )
      throw Error("Same definition version cannot change rules");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, "current.json");
    const staged = `${target}.next`;
    await writeFile(
      staged,
      JSON.stringify({ envelope, pack: bytes.toString("base64") }),
      { mode: 0o600 },
    );
    await rename(staged, target);
    this.pack = pack;
    this.source = "signed-update";
    this.expires = m.expires;
    this.digest = m.sha256;
  }
}
