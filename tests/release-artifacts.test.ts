import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

describe("Linux release artifacts", () => {
  it("includes the target architecture in every AppImage filename", () => {
    const config = readFileSync(join(ROOT, "electron-builder.yml"), "utf-8");

    expect(config).toMatch(
      /appImage:\s*\n\s+artifactName: \$\{name\}-\$\{version\}-\$\{arch\}\.\$\{ext\}/,
    );
  });

  it.each([
    ["stable", ".github/workflows/release.yml", "latest-linux-arm64.yml"],
    ["beta", ".github/workflows/beta-release.yml", "beta-linux-arm64.yml"],
  ])("publishes the %s arm64 update feed", (_channel, workflow, feed) => {
    const source = readFileSync(join(ROOT, workflow), "utf-8");

    expect(source).toContain(`dist/${feed}`);
  });
});

describe("Mithril preview platform release", () => {
  // @lat: [[mithril-migration#Desktop release gate#Cross-platform preview]]
  it("publishes inspected Windows, Linux, and Intel Mac artifacts together", () => {
    const source = readFileSync(
      join(ROOT, ".github/workflows/preview-platforms.yml"),
      "utf-8",
    );

    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("runs-on: windows-latest");
    expect(source).toContain("runner: ubuntu-latest");
    expect(source).toContain("runner: ubuntu-24.04-arm");
    expect(source).toContain("electron-builder --mac dmg zip --x64");
    expect(source).toContain("run: bash scripts/import-macos-certificate.sh");
    expect(source).toContain("APPLE_API_KEY_ID: ${{ secrets.ASC_KEY_ID }}");
    expect(source).toContain("spctl --assess --type execute");
    expect(source).toContain("electron-builder --win nsis portable --x64");
    expect(source).toContain(
      "electron-builder --linux AppImage deb --${{ matrix.arch }}",
    );
    expect(source).toContain("needs: [prepare, mac_intel, windows, linux]");
    expect(source).toContain("gh release upload");
    expect(source).toContain("SHA256SUMS");
  });

  // @lat: [[desktop-updates#Kotoba fork release channel#Windows preview signing]]
  it("selects a Windows signing route and verifies signatures before publication", () => {
    const source = readFileSync(
      join(ROOT, ".github/workflows/preview-platforms.yml"),
      "utf-8",
    );

    expect(source).toContain("MODE: ${{ vars.WIN_SIGNING }}");
    expect(source).toContain("azure|esigner");
    expect(source).toContain("Unknown WIN_SIGNING value");
    expect(source).toContain("-c.win.azureSignOptions.endpoint=");
    expect(source).toContain("-c.win.sign=scripts/win-sign-esigner.cjs");
    expect(source).toContain("Get-AuthenticodeSignature");
    expect(source).toContain('if ($sig.Status -ne "Valid")');
    expect(source).toContain("if (-not $sig.TimeStamperCertificate)");
  });
});

describe("Release quality gates", () => {
  // @lat: [[desktop-updates#Kotoba fork release channel#Signed and notarized macOS builds]]
  it("requires the Mithril Developer ID identity and Apple notarization", () => {
    const config = readFileSync(join(ROOT, "electron-builder.yml"), "utf-8");

    expect(config).toContain('identity: "Jun Kawasaki (3A5CBTEBFP)"');
    expect(config).toContain("notarize: true");
    expect(config).not.toContain("identity: null");
    expect(config).not.toContain("notarize: false");
  });

  // @lat: [[desktop-updates#Stable and beta release channels#Release security and quality gates]]
  it("blocks CI on high-severity production advisories and lint warnings", () => {
    const packageJson = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf-8"),
    ) as { scripts: Record<string, string> };
    const workflow = readFileSync(
      join(ROOT, ".github/workflows/ci.yml"),
      "utf-8",
    );
    const auditScript = readFileSync(
      join(ROOT, "scripts/audit-production-dependencies.mjs"),
      "utf-8",
    );

    expect(packageJson.scripts["audit:prod"]).toBe(
      "node scripts/audit-production-dependencies.mjs",
    );
    expect(auditScript).toContain('"--omit=dev", "--audit-level=high"');
    expect(packageJson.scripts.lint).toContain("--max-warnings=0");
    expect(packageJson.scripts.test).toContain("--maxWorkers=4");
    expect(packageJson.scripts.postinstall).toContain("install-electron --no");
    expect(workflow).toContain("run: npm run audit:prod");
    expect(workflow).toContain("run: npm run lint");
    expect(workflow).not.toMatch(
      /- name: Lint\s+run: npm run lint\s+continue-on-error: true/,
    );
  });

  // @lat: [[desktop-updates#Stable and beta release channels#macOS signing keychain]]
  it.each([
    ["stable", ".github/workflows/release.yml", "release_mac"],
    ["beta", ".github/workflows/beta-release.yml", "beta_mac"],
  ])(
    "imports the %s macOS certificate into an explicit keychain",
    (_channel, workflow, jobName) => {
      const source = readFileSync(join(ROOT, workflow), "utf-8");
      const packageStep = source.match(
        /- name: Package macOS artifacts[\s\S]*?(?=\n\s+- name:)/,
      )?.[0];

      expect(source).toContain("run: bash scripts/import-macos-certificate.sh");
      expect(source).toContain('security delete-keychain "$CSC_KEYCHAIN"');
      expect(source).toMatch(
        new RegExp(`${jobName}:[\\s\\S]*?strategy:\\s*\\n\\s+fail-fast: false`),
      );
      expect(packageStep).toBeDefined();
      expect(packageStep).not.toContain("CSC_LINK:");
      expect(packageStep).not.toContain("CSC_KEY_PASSWORD:");
    },
  );

  // @lat: [[desktop-updates#Stable and beta release channels#Native module packaging]]
  it.each([
    ["stable", ".github/workflows/release.yml"],
    ["beta", ".github/workflows/beta-release.yml"],
  ])("verifies the %s macOS runtime binary", (_channel, workflow) => {
    const source = readFileSync(join(ROOT, workflow), "utf-8");
    const config = readFileSync(join(ROOT, "electron-builder.yml"), "utf-8");
    const verifier = readFileSync(
      join(ROOT, "scripts/verify-native-module-architecture.sh"),
      "utf-8",
    );

    expect(config).toContain("node_modules/better-sqlite3/prebuilds/*.node");
    expect(source).toContain(
      'bash scripts/verify-native-module-architecture.sh "${{ matrix.arch }}"',
    );
    expect(verifier).toContain("prebuilds/darwin-$ARCH.node");
    expect(verifier).toContain('grep -q "x86_64"');
    expect(verifier).toContain('grep -q "arm64"');
  });
});
