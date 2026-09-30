#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript entry point uses JSDoc return types. */
/**
 * Build or merge a macOS electron-updater feed (preview-mac.yml / latest-mac.yml).
 *
 * Preview publishes often land one architecture at a time. Uploading the
 * electron-builder feed from a single-arch job with --clobber drops the other
 * arch. This script keeps both:
 *   - --merge a.yml b.yml …  → union file entries by url (later wins on conflict)
 *   - --artifacts <dir>      → hash every *-mac.zip (and optional .dmg) in dir
 *
 * Usage:
 *   node scripts/merge-mac-update-feed.mjs --merge existing.yml incoming.yml -o out.yml
 *   node scripts/merge-mac-update-feed.mjs --artifacts ./all-artifacts --version 0.8.0-preview.3 -o preview-mac.yml
 *   node scripts/merge-mac-update-feed.mjs --artifacts ./all-artifacts --version 0.8.0-preview.3 --product mithril-desktop -o preview-mac.yml
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ url: string, sha512: string, size: number }} FeedFile
 * @typedef {{ version: string, files: FeedFile[], path?: string, sha512?: string, releaseDate?: string }} MacFeed
 */

/** @param {string} text @returns {MacFeed} */
export function parseMacUpdateFeed(text) {
  const versionMatch = text.match(/^version:\s*(.+)$/m);
  if (!versionMatch) throw new Error("feed missing version:");
  const version = versionMatch[1].trim();
  /** @type {FeedFile[]} */
  const files = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const url = line.match(/^\s+-\s+url:\s*(.+)$/);
    if (url) {
      current = { url: url[1].trim(), sha512: "", size: 0 };
      files.push(current);
      continue;
    }
    const sha = line.match(/^\s+sha512:\s*(.+)$/);
    if (sha && current && !current.sha512) {
      current.sha512 = sha[1].trim();
      continue;
    }
    const size = line.match(/^\s+size:\s*(\d+)\s*$/);
    if (size && current) {
      current.size = Number(size[1]);
      continue;
    }
  }
  if (files.length === 0) throw new Error("feed has no files:");
  for (const file of files) {
    if (!file.sha512 || !file.size) {
      throw new Error(`incomplete file entry for ${file.url}`);
    }
  }
  const pathMatch = text.match(/^path:\s*(.+)$/m);
  const topSha = text.match(/^sha512:\s*(.+)$/m);
  const dateMatch = text.match(/^releaseDate:\s*'?([^'\n]+)'?\s*$/m);
  return {
    version,
    files,
    path: pathMatch?.[1]?.trim(),
    sha512: topSha?.[1]?.trim(),
    releaseDate: dateMatch?.[1]?.trim(),
  };
}

/** @param {MacFeed[]} feeds @returns {MacFeed} */
export function mergeMacUpdateFeeds(feeds) {
  if (feeds.length === 0) throw new Error("no feeds to merge");
  const version = feeds[0].version;
  for (const feed of feeds) {
    if (feed.version !== version) {
      throw new Error(
        `refusing to merge feeds with different versions: ${version} vs ${feed.version}`,
      );
    }
  }
  /** @type {Map<string, FeedFile>} */
  const byUrl = new Map();
  for (const feed of feeds) {
    for (const file of feed.files) {
      byUrl.set(file.url, { ...file });
    }
  }
  const files = sortFeedFiles([...byUrl.values()]);
  const primary = pickPrimary(files);
  const releaseDate =
    feeds.map((f) => f.releaseDate).find(Boolean) || new Date().toISOString();
  return {
    version,
    files,
    path: primary.url,
    sha512: primary.sha512,
    releaseDate,
  };
}

/** @param {FeedFile[]} files */
function sortFeedFiles(files) {
  return [...files].sort((a, b) => {
    const rank = (url) => {
      const arm = url.includes("-arm64") ? 1 : 0;
      const dmg = url.endsWith(".dmg") ? 1 : 0;
      return arm * 2 + dmg;
    };
    const diff = rank(a.url) - rank(b.url);
    return diff !== 0 ? diff : a.url.localeCompare(b.url);
  });
}

/** @param {FeedFile[]} files */
function pickPrimary(files) {
  return (
    files.find((f) => f.url.includes("-x64-") && f.url.endsWith("-mac.zip")) ||
    files.find((f) => f.url.endsWith("-mac.zip")) ||
    files[0]
  );
}

/** @param {MacFeed} feed @returns {string} */
export function formatMacUpdateFeed(feed) {
  const primary = pickPrimary(feed.files);
  const releaseDate = feed.releaseDate || new Date().toISOString();
  const lines = [
    `version: ${feed.version}`,
    "files:",
    ...feed.files.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`,
    ]),
    `path: ${primary.url}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ];
  return lines.join("\n");
}

/**
 * @param {string} artifactsDir
 * @param {string} version
 * @param {{ product?: string, includeDmg?: boolean }} [opts]
 * @returns {MacFeed}
 */
export function buildMacUpdateFeedFromArtifacts(
  artifactsDir,
  version,
  opts = {},
) {
  const product = opts.product || "mithril-desktop";
  const includeDmg = opts.includeDmg !== false;
  const names = readdirSync(artifactsDir).filter((name) => {
    if (!name.startsWith(`${product}-${version}-`)) return false;
    if (name.endsWith("-mac.zip")) return true;
    if (includeDmg && name.endsWith(".dmg") && !name.endsWith(".blockmap")) {
      return /-(?:x64|arm64)\.dmg$/.test(name);
    }
    return false;
  });
  if (names.length === 0) {
    throw new Error(
      `no ${product}-${version}-*-mac.zip (or arch .dmg) in ${artifactsDir}`,
    );
  }
  const hasX64 = names.some(
    (n) => n.includes("-x64-") && n.endsWith("-mac.zip"),
  );
  const hasArm64 = names.some(
    (n) => n.includes("-arm64-") && n.endsWith("-mac.zip"),
  );
  if (!hasX64 && !hasArm64) {
    throw new Error(
      `expected at least one arch *-mac.zip, found: ${names.join(", ")}`,
    );
  }
  const files = sortFeedFiles(
    names.map((name) => {
      const filePath = join(artifactsDir, name);
      const body = readFileSync(filePath);
      return {
        url: name,
        sha512: createHash("sha512").update(body).digest("base64"),
        size: statSync(filePath).size,
      };
    }),
  );
  return {
    version,
    files,
    path: pickPrimary(files).url,
    sha512: pickPrimary(files).sha512,
    releaseDate: new Date().toISOString(),
  };
}

/** @param {MacFeed} feed */
export function assertBothMacArches(feed) {
  const zips = feed.files.filter((f) => f.url.endsWith("-mac.zip"));
  const hasX64 = zips.some((f) => f.url.includes("-x64-"));
  const hasArm64 = zips.some((f) => f.url.includes("-arm64-"));
  if (!hasX64 || !hasArm64) {
    throw new Error(
      `feed must list both x64 and arm64 mac zips, found: ${zips.map((f) => f.url).join(", ")}`,
    );
  }
}

function printUsage() {
  console.error(`Usage:
  node scripts/merge-mac-update-feed.mjs --merge <yml>... -o <out.yml>
  node scripts/merge-mac-update-feed.mjs --artifacts <dir> --version <ver> [-o <out.yml>] [--require-both]
  node scripts/merge-mac-update-feed.mjs --artifacts <dir> --version <ver> --product mithril-desktop`);
}

function main(argv) {
  const args = [...argv];
  /** @type {string[]} */
  const mergePaths = [];
  let artifactsDir = null;
  let version = null;
  let product = "mithril-desktop";
  let output = null;
  let requireBoth = false;
  let includeDmg = true;

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === "--merge") {
      while (args[0] && !args[0].startsWith("-")) mergePaths.push(args.shift());
    } else if (flag === "--artifacts") {
      artifactsDir = args.shift();
    } else if (flag === "--version") {
      version = args.shift();
    } else if (flag === "--product") {
      product = args.shift();
    } else if (flag === "-o" || flag === "--output") {
      output = args.shift();
    } else if (flag === "--require-both") {
      requireBoth = true;
    } else if (flag === "--zips-only") {
      includeDmg = false;
    } else if (flag === "-h" || flag === "--help") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`unknown argument: ${flag}`);
      printUsage();
      process.exit(1);
    }
  }

  /** @type {MacFeed} */
  let feed;
  if (mergePaths.length > 0) {
    feed = mergeMacUpdateFeeds(
      mergePaths.map((p) =>
        parseMacUpdateFeed(readFileSync(resolve(p), "utf8")),
      ),
    );
  } else if (artifactsDir && version) {
    feed = buildMacUpdateFeedFromArtifacts(resolve(artifactsDir), version, {
      product,
      includeDmg,
    });
  } else {
    printUsage();
    process.exit(1);
  }

  if (requireBoth) assertBothMacArches(feed);
  const text = formatMacUpdateFeed(feed);
  if (output) {
    writeFileSync(resolve(output), text);
    console.log(
      `wrote ${basename(output)} with ${feed.files.length} file(s): ${feed.files.map((f) => f.url).join(", ")}`,
    );
  } else {
    process.stdout.write(text);
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main(process.argv.slice(2));
}
