import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IDENTITY,
  TEAM,
  sha256,
  assertSource,
  buildEnvironment,
  notarizationArgs,
  verifySignatureMetadata,
  artifactRecord,
  verifyReceipt,
} from "./core.mjs";

const sha = "a".repeat(40),
  version = "0.8.0-preview.71",
  lockSha256 = "b".repeat(64);
const now = Date.parse("2026-10-09T12:00:00Z");
const signature = `Authority=${IDENTITY}\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTeamIdentifier=${TEAM}\nflags=0x10000(runtime)\nTimestamp=Oct 9, 2026`;

test("keeps provider and notarization credentials out of build/test children", () => {
  const env = buildEnvironment(
    {
      HOME: "/fixture/home",
      PATH: "/usr/bin",
      OPENROUTER_API_KEY: "fixture-provider",
      APPLE_API_KEY: "/private/key.p8",
      CSC_LINK: "fixture-p12",
      CSC_KEY_PASSWORD: "fixture-password",
      NODE_OPTIONS: "--require=/unexpected/module",
    },
    "/fixture/node/bin/node",
  );
  assert.equal(env.HOME, "/fixture/home");
  assert.equal(env.PATH, "/fixture/node/bin:/usr/bin");
  for (const key of [
    "OPENROUTER_API_KEY",
    "APPLE_API_KEY",
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "NODE_OPTIONS",
  ])
    assert.equal(env[key], undefined);
  assert.equal(env.CSC_NAME, IDENTITY);
});

test("refuses a dirty, stale, invalid-version or unqualified-runtime source", () => {
  const source = {
    sha,
    remoteMain: sha,
    dirty: "",
    version,
    nodeVersion: "v24.19.0",
  };
  assert.doesNotThrow(() => assertSource(source));
  for (const patch of [
    { dirty: " M file" },
    { remoteMain: "c".repeat(40) },
    { sha: "bad" },
    { version: "0.8.0" },
    { nodeVersion: "v26.7.0" },
  ])
    assert.throws(() => assertSource({ ...source, ...patch }));
});

test("refuses ad-hoc, Development, wrong-team, unstamped or non-hardened signatures", () => {
  assert.doesNotThrow(() => verifySignatureMetadata(signature));
  for (const changed of [
    signature.replace(IDENTITY, "Apple Development: Jun Kawasaki"),
    signature.replace(TEAM, "OTHERTEAM"),
    signature.replace("Timestamp=Oct 9, 2026", ""),
    signature.replace("(runtime)", ""),
    signature.replace("Authority=Apple Root CA", ""),
  ])
    assert.throws(() => verifySignatureMetadata(changed));
});

test("requires a complete notarization credential reference and owner-only key", () => {
  assert.deepEqual(notarizationArgs({ MITHRIL_NOTARY_PROFILE: "fixture" }), [
    "--keychain-profile",
    "fixture",
  ]);
  assert.throws(() => notarizationArgs({}));
  const dir = mkdtempSync(join(tmpdir(), "mithril-notary-fixture-"));
  try {
    const key = join(dir, "key.p8");
    writeFileSync(key, "fixture-not-a-key", { mode: 0o600 });
    const env = {
      APPLE_API_KEY: key,
      APPLE_API_KEY_ID: "FIXTURE",
      APPLE_API_ISSUER: "fixture-issuer",
    };
    assert.deepEqual(notarizationArgs(env), [
      "--key",
      key,
      "--key-id",
      "FIXTURE",
      "--issuer",
      "fixture-issuer",
    ]);
    const alias = join(dir, "alias");
    symlinkSync(key, alias);
    assert.throws(() => notarizationArgs({ ...env, APPLE_API_KEY: alias }));
    writeFileSync(join(dir, "readable"), "fixture", { mode: 0o644 });
    assert.throws(() =>
      notarizationArgs({ ...env, APPLE_API_KEY: join(dir, "readable") }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// @lat: [[independent-macos#Independent macOS qualification#Receipt validation]]
test("requires accepted notarization, exact source, fresh launch proof and unchanged DMG/ZIP bytes", () => {
  // realpath avoids macOS /var -> /private/var in the test fixture.
  const dir = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-receipt-fixture-")),
  );
  try {
    const names = [
      `mithril-desktop-${version}-arm64.dmg`,
      `mithril-desktop-${version}-arm64-mac.zip`,
    ];
    names.forEach((name) => writeFileSync(join(dir, name), name));
    const receipt = {
      schemaVersion: 1,
      repository: "mithril-lang/mithril-desktop",
      sha,
      version,
      lockSha256,
      arch: "arm64",
      platform: "darwin",
      team: TEAM,
      status: "qualified",
      notarization: {
        status: "Accepted",
        id: "11111111-1111-4111-8111-111111111111",
        dmgStatus: "Accepted",
        dmgId: "22222222-2222-4222-8222-222222222222",
      },
      signatureVerified: true,
      gatekeeperVerified: true,
      stapleVerified: true,
      launchVerified: true,
      runtime: {
        node: "v24.19.0",
        electron: "44.1.1",
        nodeSha256: sha256("node"),
        executableSha256: sha256("electron"),
        nativeSha256: sha256("native"),
      },
      artifacts: names.map((name) => artifactRecord(join(dir, name))),
      finishedAt: new Date(now).toISOString(),
    };
    const identity = { sha, version, lockSha256, directory: dir, now };
    assert.doesNotThrow(() => verifyReceipt(receipt, identity));
    for (const patch of [
      { sha: "c".repeat(40) },
      { lockSha256: "c".repeat(64) },
      { arch: "universal" },
      { status: "signed-only" },
      { notarization: { ...receipt.notarization, dmgStatus: "Invalid" } },
      { notarization: { status: "Invalid" } },
      { launchVerified: false },
      { signatureVerified: false },
      { stapleVerified: false },
      { gatekeeperVerified: false },
      { finishedAt: new Date(now - 86400001).toISOString() },
      { finishedAt: new Date(now + 1).toISOString() },
      { artifacts: receipt.artifacts.slice(1) },
      { runtime: { node: "v24.19.0", electron: "44.1.1" } },
    ])
      assert.throws(() => verifyReceipt({ ...receipt, ...patch }, identity));
    writeFileSync(join(dir, names[0]), "tampered");
    assert.throws(() => verifyReceipt(receipt, identity), /differs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
