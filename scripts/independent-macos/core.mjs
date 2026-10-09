/* eslint-disable @typescript-eslint/explicit-function-return-type -- Independent JavaScript verification helpers. */
import { createHash } from "node:crypto";
import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";

export const ARCHITECTURES = ["arm64", "x64"];
export const TEAM = "3A5CBTEBFP";
export const IDENTITY = `Developer ID Application: Jun Kawasaki (${TEAM})`;
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function assertSource({ sha, remoteMain, dirty, version, nodeVersion }) {
  if (!/^[a-f0-9]{40}$/.test(sha) || sha !== remoteMain || dirty)
    throw Error("A clean checkout of current remote main is required");
  if (!/^0\.8\.0-preview\.[0-9]+$/.test(version))
    throw Error("Expected a preview package version");
  if (!/^v24\./.test(nodeVersion))
    throw Error("Use the qualified Node 24 runtime");
}

export function notarizationArgs(env) {
  if (env.MITHRIL_NOTARY_PROFILE)
    return ["--keychain-profile", env.MITHRIL_NOTARY_PROFILE];
  if (!env.APPLE_API_KEY || !env.APPLE_API_KEY_ID || !env.APPLE_API_ISSUER)
    throw Error(
      "Set MITHRIL_NOTARY_PROFILE or APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER",
    );
  const key = lstatSync(env.APPLE_API_KEY);
  if (!key.isFile() || key.isSymbolicLink() || key.mode & 0o077)
    throw Error("The notarization key must be an owner-only regular file");
  return [
    "--key",
    env.APPLE_API_KEY,
    "--key-id",
    env.APPLE_API_KEY_ID,
    "--issuer",
    env.APPLE_API_ISSUER,
  ];
}

export function verifySignatureMetadata(text) {
  if (
    !text.includes(`Authority=${IDENTITY}`) ||
    !text.includes(`TeamIdentifier=${TEAM}`) ||
    !text.includes("Authority=Apple Root CA") ||
    !/flags=.*\(runtime\)/.test(text) ||
    !/^Timestamp=.+/m.test(text)
  )
    throw Error(
      "Developer ID identity, Apple chain, hardened runtime and secure timestamp are required",
    );
}

export function artifactRecord(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error("Expected a regular artifact file");
  return {
    name: basename(path),
    size: stat.size,
    sha256: sha256(readFileSync(path)),
  };
}

export function verifyReceipt(
  receipt,
  { sha, version, lockSha256, directory, now = Date.now() },
) {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.repository !== "mithril-lang/mithril-desktop" ||
    receipt.sha !== sha ||
    receipt.version !== version ||
    receipt.lockSha256 !== lockSha256 ||
    !ARCHITECTURES.includes(receipt.arch) ||
    receipt.platform !== "darwin" ||
    receipt.team !== TEAM ||
    receipt.status !== "qualified" ||
    receipt.notarization?.status !== "Accepted" ||
    receipt.notarization?.dmgStatus !== "Accepted" ||
    !/^[a-f0-9-]{36}$/.test(receipt.notarization.dmgId || "") ||
    !/^[a-f0-9-]{36}$/.test(receipt.notarization.id || "") ||
    receipt.signatureVerified !== true ||
    receipt.gatekeeperVerified !== true ||
    receipt.stapleVerified !== true ||
    receipt.launchVerified !== true ||
    !/^v24\./.test(receipt.runtime?.node || "") ||
    typeof receipt.runtime?.electron !== "string" ||
    !["nodeSha256", "executableSha256", "nativeSha256"].every((key) =>
      /^[a-f0-9]{64}$/.test(receipt.runtime?.[key] || ""),
    )
  )
    throw Error("Unqualified or mismatched macOS receipt");
  const at = Date.parse(receipt.finishedAt);
  if (!Number.isFinite(at) || now < at || now - at > 86400000)
    throw Error("macOS receipt is stale");
  const expected = [
    `mithril-desktop-${version}-${receipt.arch}.dmg`,
    `mithril-desktop-${version}-${receipt.arch}-mac.zip`,
  ];
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length !== 2)
    throw Error("Both DMG and ZIP are required");
  for (const name of expected) {
    const record = receipt.artifacts.find((entry) => entry.name === name);
    if (!record) throw Error("Missing expected artifact");
    const path = join(directory, name);
    if (realpathSync(path) !== path)
      throw Error("Artifact symlinks are forbidden");
    const actual = artifactRecord(path);
    if (actual.size !== record.size || actual.sha256 !== record.sha256)
      throw Error("Artifact differs from its qualified receipt");
  }
  return receipt;
}
