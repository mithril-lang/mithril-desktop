// @vitest-environment node
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  verifiedInstallerCommand,
  verifiedWindowsInstallerScript,
  INSTALLER_VERIFICATION_FAILED,
  MITHRIL_AGENT_REPO_URL,
  PINNED_INSTALL_COMMIT,
  PINNED_INSTALL_URL,
  PINNED_WINDOWS_INSTALL_URL,
} from "../src/main/installer-download";

describe.skipIf(process.platform === "win32")("verified Unix installer", () => {
  // @lat: [[desktop-security#Runtime security#Verified Agent bootstraps]]
  it.each(["valid", "tampered", "download-error", "installer-error"])(
    "%s downloads execute only after verification and always clean up",
    (scenario) => {
      const directory = mkdtempSync(join(tmpdir(), "hermes-bootstrap-"));
      try {
        const bin = join(directory, "bin");
        const temporary = join(directory, "temporary");
        mkdirSync(bin);
        mkdirSync(temporary);
        const script =
          'printf "%s\\n" "$HERMES_REPO_URL" "$@" > "$EXECUTION_MARKER"\nexit "${INSTALL_EXIT:-0}"\n';
        const fixture = join(directory, "fixture.sh");
        writeFileSync(
          fixture,
          scenario === "tampered" ? script + "# modified\n" : script,
        );
        // Stub only network I/O; the generated shell, checksum utilities and
        // downloaded fixture execute for real, without an actual installation.
        writeFileSync(
          join(bin, "curl"),
          '#!/bin/bash\n[ "$DOWNLOAD_ERROR" = 1 ] && exit 22\ncp "$DOWNLOAD_FIXTURE" "$3"\n',
          { mode: 0o755 },
        );
        const marker = join(directory, "executed");
        const result = spawnSync(
          "bash",
          [
            "-c",
            verifiedInstallerCommand(
              "https://example.invalid/install.sh",
              createHash("sha256").update(script).digest("hex"),
              {
                hermesHome: "/tmp/hermes home",
                installDir: "/tmp/hermes home/hermes-agent",
              },
            ),
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              TMPDIR: temporary,
              DOWNLOAD_FIXTURE: fixture,
              EXECUTION_MARKER: marker,
              DOWNLOAD_ERROR: scenario === "download-error" ? "1" : "0",
              INSTALL_EXIT: scenario === "installer-error" ? "23" : "0",
            },
          },
        );
        expect(result.error).toBeUndefined();
        const verified = scenario === "valid" || scenario === "installer-error";
        expect(result.status).toBe(
          verified
            ? scenario === "valid"
              ? 0
              : 23
            : INSTALLER_VERIFICATION_FAILED,
        );
        expect(existsSync(marker)).toBe(verified);
        if (verified) {
          expect(readFileSync(marker, "utf8").split("\n")).toEqual([
            MITHRIL_AGENT_REPO_URL,
            "--skip-setup",
            "--branch",
            "main",
            "--commit",
            PINNED_INSTALL_COMMIT,
            "--hermes-home",
            "/tmp/hermes home",
            "--dir",
            "/tmp/hermes home/hermes-agent",
            "",
          ]);
        }
        expect(readdirSync(temporary)).toEqual([]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("pins both platform bootstraps and the checkout to one Mithril Agent revision", () => {
    expect(PINNED_INSTALL_URL).toContain(
      `mithril-lang/mithril-agent/${PINNED_INSTALL_COMMIT}/scripts/install.sh`,
    );
    expect(PINNED_WINDOWS_INSTALL_URL).toContain(
      `mithril-lang/mithril-agent/${PINNED_INSTALL_COMMIT}/scripts/install.ps1`,
    );
    const windows = verifiedWindowsInstallerScript({
      hermesHome: "C:\\Hermes Home",
      installDir: "C:\\Hermes Home\\hermes-agent",
    });
    expect(windows).toContain("Get-FileHash -Algorithm SHA256");
    expect(windows).toContain(`$repoUrl = '${MITHRIL_AGENT_REPO_URL}'`);
    expect(windows).toContain(`$commit = '${PINNED_INSTALL_COMMIT}'`);
    expect(windows).toContain("-Branch main -Commit $commit");
    expect(windows.indexOf("Get-FileHash")).toBeLessThan(
      windows.indexOf("& $installer"),
    );
  });
});
