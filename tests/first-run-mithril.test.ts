import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf-8");

describe("Mithril first run", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#First-run connect]]
  it("routes a first launch to the Mithril connect screen, not the install prompt", () => {
    const app = read("src/renderer/src/App.tsx");
    expect(app).toContain('let next: Screen = "mithril"');
    expect(app).toContain("getMithrilFirstRunState");
    // The Hermes install screen is reachable only through the explicit opt-in.
    expect(app).toContain("openWorkspace");
    const welcome = read("src/shared/i18n/locales/en/welcome.ts");
    expect(welcome).not.toMatch(/Kotoba|Hermes One/);
  });

  it("contains no kotoba.cloud / kc_pat_ account, sync, or wallet modules", () => {
    const main = [
      "src/main/ipc/register.ts",
      "src/preload/index.ts",
      "src/main/mithril-chat.ts",
    ]
      .map(read)
      .join("\n");
    expect(main).not.toMatch(
      /kotoba\.cloud|kc_pat_|hermes-account|hermesone-provision/,
    );
  });
});

describe("Auto-update feed naming", () => {
  // @lat: [[desktop-updates#Preview update feed naming]]
  it("derives the preview channel from the prerelease version and publishes preview*.yml", () => {
    const version = (JSON.parse(read("package.json")) as { version: string })
      .version;
    expect(version).toMatch(/-preview\.\d+$/);
    const workflow = read(".github/workflows/preview-platforms.yml");
    for (const feed of [
      "preview.yml",
      "preview-mac.yml",
      "preview-linux.yml",
      "preview-linux-arm64.yml",
    ]) {
      expect(workflow).toContain(feed);
    }
    expect(workflow).not.toMatch(/dist\/latest/);
    // No code path overrides the channel electron-builder bakes in.
    expect(read("src/main/app/updater.ts")).not.toMatch(/\.channel\s*=/);
    expect(read("electron-builder.yml")).toMatch(
      /url: https:\/\/app\.mithril\.fund\/download\//,
    );
  });
});
