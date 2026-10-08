import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Signing authority belongs to CI; clients embed only the public key.
const output = resolve(process.argv[2] || "");
if (!process.argv[2])
  throw Error("Provide an isolated feed checkout directory");
const trust = JSON.parse(
  await readFile("resources/endpoint/trust.json", "utf8"),
);
const bytes = await readFile("resources/endpoint/definitions.json");
const pack = JSON.parse(bytes);
if (
  pack.schema !== 1 ||
  !Number.isSafeInteger(pack.version) ||
  pack.version < 1
)
  throw Error("Definition schema or version is invalid");
const key = createPrivateKey(
  process.env.ENDPOINT_DEFINITIONS_SIGNING_KEY || "",
);
if (
  createPublicKey(key).export({ type: "spki", format: "pem" }) !==
  trust.publicKey
)
  throw Error("Signing key does not match the packaged trust anchor");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const base = join(output, "v1");
let previous;
try {
  previous = JSON.parse(
    JSON.parse(await readFile(join(base, "manifest.json"), "utf8")).payload,
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (
  previous &&
  (pack.version < previous.version ||
    (pack.version === previous.version && previous.sha256 !== sha256))
)
  throw Error(
    "Increment definition version before changing content; rollback is forbidden",
  );
await mkdir(join(base, "packs"), { recursive: true });
const target = `packs/${sha256}.json`;
const payload = JSON.stringify({
  schema: 1,
  version: pack.version,
  expires: new Date(Date.now() + 14 * 86400000).toISOString(),
  sha256,
  size: bytes.length,
  target,
});
await writeFile(join(base, target), bytes);
await writeFile(
  join(base, "manifest.json"),
  JSON.stringify({
    payload,
    signature: sign(null, Buffer.from(payload), key).toString("base64"),
  }) + "\n",
);
console.log(`Signed endpoint definition v${pack.version}; digest ${sha256}`);
