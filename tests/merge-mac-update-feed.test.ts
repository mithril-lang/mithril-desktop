import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  assertBothMacArches,
  buildMacUpdateFeedFromArtifacts,
  formatMacUpdateFeed,
  mergeMacUpdateFeeds,
  parseMacUpdateFeed,
} from "../scripts/merge-mac-update-feed.mjs";

const x64Feed = `version: 0.8.0-preview.3
files:
  - url: mithril-desktop-0.8.0-preview.3-x64-mac.zip
    sha512: x64zipsha==
    size: 201909242
  - url: mithril-desktop-0.8.0-preview.3-x64.dmg
    sha512: x64dmgsha==
    size: 202329771
path: mithril-desktop-0.8.0-preview.3-x64-mac.zip
sha512: x64zipsha==
releaseDate: '2026-09-29T13:11:21.947Z'
`;

const arm64Feed = `version: 0.8.0-preview.3
files:
  - url: mithril-desktop-0.8.0-preview.3-arm64-mac.zip
    sha512: armzipsha==
    size: 195153580
  - url: mithril-desktop-0.8.0-preview.3-arm64.dmg
    sha512: armdmgsha==
    size: 195500000
path: mithril-desktop-0.8.0-preview.3-arm64-mac.zip
sha512: armzipsha==
releaseDate: '2026-09-29T12:00:00.000Z'
`;

describe("merge-mac-update-feed", () => {
  it("keeps both arch files when a later Intel feed would otherwise clobber arm64", () => {
    const merged = mergeMacUpdateFeeds([
      parseMacUpdateFeed(arm64Feed),
      parseMacUpdateFeed(x64Feed),
    ]);
    const urls = merged.files.map((f) => f.url);

    expect(merged.version).toBe("0.8.0-preview.3");
    expect(urls).toEqual(
      expect.arrayContaining([
        "mithril-desktop-0.8.0-preview.3-arm64-mac.zip",
        "mithril-desktop-0.8.0-preview.3-x64-mac.zip",
        "mithril-desktop-0.8.0-preview.3-arm64.dmg",
        "mithril-desktop-0.8.0-preview.3-x64.dmg",
      ]),
    );
    expect(merged.path).toBe("mithril-desktop-0.8.0-preview.3-x64-mac.zip");
    expect(merged.sha512).toBe("x64zipsha==");
    assertBothMacArches(merged);

    const text = formatMacUpdateFeed(merged);
    expect(text).toContain("arm64-mac.zip");
    expect(text).toContain("x64-mac.zip");
  });

  it("lets a later arm64 publish refresh arm64 entries without dropping x64", () => {
    const refreshedArm = arm64Feed.replace("armzipsha==", "newarmzipsha==");
    const merged = mergeMacUpdateFeeds([
      parseMacUpdateFeed(x64Feed),
      parseMacUpdateFeed(refreshedArm),
    ]);
    const armZip = merged.files.find((f) => f.url.endsWith("arm64-mac.zip"));

    expect(armZip?.sha512).toBe("newarmzipsha==");
    expect(
      merged.files.some((f) => f.url.endsWith("x64-mac.zip")),
    ).toBe(true);
    assertBothMacArches(merged);
  });

  it("builds a dual-arch feed from artifact zips without dropping either arch", () => {
    const dir = mkdtempSync(join(tmpdir(), "mac-feed-"));
    const version = "0.8.0-preview.3";
    writeFileSync(
      join(dir, `mithril-desktop-${version}-x64-mac.zip`),
      "x64-bytes",
    );
    writeFileSync(
      join(dir, `mithril-desktop-${version}-arm64-mac.zip`),
      "arm64-bytes",
    );
    // Stale single-arch feed present next to the zips must not win.
    writeFileSync(join(dir, "preview-mac.yml"), x64Feed);

    const feed = buildMacUpdateFeedFromArtifacts(dir, version, {
      includeDmg: false,
    });
    assertBothMacArches(feed);
    expect(feed.files).toHaveLength(2);
    expect(readFileSync(join(dir, "preview-mac.yml"), "utf8")).toContain(
      "x64-mac.zip",
    );
  });

  it("rejects merging feeds for different versions", () => {
    expect(() =>
      mergeMacUpdateFeeds([
        parseMacUpdateFeed(x64Feed),
        parseMacUpdateFeed(
          x64Feed.replaceAll("0.8.0-preview.3", "0.8.0-preview.4"),
        ),
      ]),
    ).toThrow(/different versions/);
  });
});
