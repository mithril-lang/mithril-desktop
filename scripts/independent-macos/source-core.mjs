/* eslint-disable @typescript-eslint/explicit-function-return-type */
import {
  readdirSync,
  readFileSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { sha256 } from "./core.mjs";
export const SOURCE_IMAGE =
  "node@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0";
export const SOURCE_PROFILES = Object.freeze({
  "mithril-lang/mithril-desktop": {
    name: "desktop-source-v1",
    setup: [
      ["npm", ["ci", "--ignore-scripts"]],
      ["node", ["node_modules/electron/install.js"]],
      ["npm", ["run", "audit:prod"]],
    ],
    commands: [
      ["npm", ["run", "lint"]],
      ["npm", ["run", "build"]],
      ["node", ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=2"]],
      ["npm", ["run", "check:packaging"]],
      ["npm", ["run", "lat:check"]],
      [
        "node",
        [
          "--test",
          "scripts/independent-macos/core.test.mjs",
          "scripts/independent-macos/launch.test.mjs",
          "scripts/independent-macos/source-core.test.mjs",
        ],
      ],
    ],
  },
  "kotoba-lang/kagi": {
    name: "kagi-sdk-v1",
    setup: [["npm", ["ci", "--ignore-scripts"]]],
    commands: [["npm", ["run", "test:sdk"]]],
  },
  "kotoba-lang/kagitaba": {
    name: "kagitaba-sdk-v1",
    commands: [["npm", ["run", "test:sdk"]]],
  },
});
export const sourceRecipe = (repository) => {
  const profile = SOURCE_PROFILES[repository];
  if (!profile) throw Error("Unsupported source repository");
  return sha256(
    JSON.stringify({
      version: 1,
      image: SOURCE_IMAGE,
      nativeCore: sha256(readFileSync(new URL("./core.mjs", import.meta.url))),
      profile,
      core: sha256(readFileSync(new URL("./source-core.mjs", import.meta.url))),
      cli: sha256(readFileSync(new URL("./source-cli.mjs", import.meta.url))),
    }),
  );
};
export function assertCandidate({
  repository,
  sha,
  dirty,
  nodeVersion,
  mode,
  remoteMain,
}) {
  if (
    !SOURCE_PROFILES[repository] ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    dirty ||
    !/^v24\./.test(nodeVersion)
  )
    throw Error("Clean fixed-repository source and Node 24 required");
  if (
    !["candidate", "current-main"].includes(mode) ||
    (mode === "current-main" && sha !== remoteMain)
  )
    throw Error("Current-main qualification requires exact remote main");
}
export function sourceInventory(directory) {
  const items = [];
  function walk(path, relative = "") {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name),
        rel = relative ? `${relative}/${name}` : name,
        stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw Error("Artifact symlinks are forbidden");
      if (stat.isDirectory()) walk(file, rel);
      else if (stat.isFile())
        items.push({
          path: rel,
          bytes: stat.size,
          sha256: sha256(readFileSync(file)),
        });
    }
  }
  walk(directory);
  return items;
}
export function verifySourcePayload(
  payload,
  { repository, sha, recipe, nodeSha256, owner, mode, now = Date.now() },
) {
  const age = now - Date.parse(payload?.finishedAt);
  if (
    payload?.schemaVersion !== 1 ||
    payload.repository !== repository ||
    payload.image !== SOURCE_IMAGE ||
    payload.sha !== sha ||
    payload.mode !== mode ||
    !["candidate", "current-main"].includes(payload.mode) ||
    payload.recipe !== recipe ||
    payload.nodeSha256 !== nodeSha256 ||
    payload.owner !== owner ||
    payload.status !== "qualified" ||
    payload.releaseEligible !== false ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 86400000 ||
    !SOURCE_PROFILES[repository] ||
    payload.profile !== SOURCE_PROFILES[repository].name ||
    !Array.isArray(payload.artifacts) ||
    !/^[a-f0-9]{64}$/.test(payload.sourceArchiveSha256)
  )
    throw Error("Invalid or stale source qualification");
  return payload;
}

export function importSourceArtifacts(files, directory) {
  if (!Array.isArray(files) || files.length > 4096)
    throw Error("Invalid artifact inventory");
  const seen = new Set();
  let total = 0;
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      file.path.includes("\\") ||
      file.path.includes("\0") ||
      file.path
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      seen.has(file.path) ||
      typeof file.data !== "string" ||
      file.data.length > 32 * 1024 * 1024
    )
      throw Error("Invalid artifact path or bytes");
    seen.add(file.path);
    const bytes = Buffer.from(file.data, "base64");
    total += bytes.length;
    if (
      bytes.toString("base64") !== file.data ||
      bytes.length !== file.bytes ||
      sha256(bytes) !== file.sha256 ||
      total > 64 * 1024 * 1024
    )
      throw Error("Artifact integrity mismatch");
    const path = join(directory, file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
  }
  return sourceInventory(directory);
}
