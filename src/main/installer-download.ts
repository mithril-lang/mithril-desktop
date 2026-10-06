// Bootstrap and checkout are pinned to the reviewed Agent merge that Desktop
// was tested against. Bump the commit and both digests together.
export const PINNED_INSTALL_COMMIT = "806c0a473b9eaba74a97a8c0d5f8e5fe0bc9c30b";
export const PINNED_INSTALL_SHA256 =
  "0fbf2969c12b9ef9c90b81519814865faa9ee4e22056e2a9a4d0b1d5e59966e8";
export const PINNED_WINDOWS_INSTALL_SHA256 =
  "5204fb92ced8b94af58e9ce37151cbbbc489b3b03ca81830a57362362d3d20da";
export const MITHRIL_AGENT_REPO_URL =
  "https://github.com/mithril-lang/mithril-agent.git";
export const PINNED_INSTALL_URL = `https://raw.githubusercontent.com/mithril-lang/mithril-agent/${PINNED_INSTALL_COMMIT}/scripts/install.sh`;
export const PINNED_WINDOWS_INSTALL_URL = `https://raw.githubusercontent.com/mithril-lang/mithril-agent/${PINNED_INSTALL_COMMIT}/scripts/install.ps1`;
export const INSTALLER_VERIFICATION_FAILED = 87;

function validateSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new Error("Invalid installer SHA-256");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface InstallerTarget {
  hermesHome: string;
  installDir: string;
}

export function verifiedInstallerCommand(
  url = PINNED_INSTALL_URL,
  sha256 = PINNED_INSTALL_SHA256,
  target?: InstallerTarget,
): string {
  validateSha256(sha256);
  const args = [
    "--skip-setup",
    "--branch",
    "main",
    "--commit",
    PINNED_INSTALL_COMMIT,
    ...(target
      ? ["--hermes-home", target.hermesHome, "--dir", target.installDir]
      : []),
  ]
    .map(shellQuote)
    .join(" ");
  return [
    "set -eo pipefail",
    `installer_tmp="$(mktemp)" || exit ${INSTALLER_VERIFICATION_FAILED}`,
    `trap 'rm -f "$installer_tmp"' EXIT`,
    `curl -fsSL -o "$installer_tmp" -- ${shellQuote(url)} || exit ${INSTALLER_VERIFICATION_FAILED}`,
    `installer_actual="$( (sha256sum "$installer_tmp" 2>/dev/null || shasum -a 256 "$installer_tmp") | awk '{print $1}' )" || exit ${INSTALLER_VERIFICATION_FAILED}`,
    `if [ "$installer_actual" != "${sha256}" ]; then echo "Hermes installer checksum mismatch; refusing to execute." >&2; exit ${INSTALLER_VERIFICATION_FAILED}; fi`,
    `HERMES_REPO_URL=${shellQuote(MITHRIL_AGENT_REPO_URL)} bash "$installer_tmp" ${args}`,
  ].join("\n");
}

/** Build a verified Windows bootstrap wrapper for the same Agent revision. */
export function verifiedWindowsInstallerScript(
  target: InstallerTarget,
  url = PINNED_WINDOWS_INSTALL_URL,
  sha256 = PINNED_WINDOWS_INSTALL_SHA256,
): string {
  validateSha256(sha256);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$hermesHome = ${psQuote(target.hermesHome)}`,
    `$installDir = ${psQuote(target.installDir)}`,
    `$repoUrl = ${psQuote(MITHRIL_AGENT_REPO_URL)}`,
    `$commit = ${psQuote(PINNED_INSTALL_COMMIT)}`,
    "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}",
    `$url = ${psQuote(url)}`,
    `$expectedSha256 = ${psQuote(sha256)}`,
    `$download = Join-Path $env:TEMP ("mithril-agent-install-download-" + [guid]::NewGuid().ToString() + ".ps1")`,
    `$installer = Join-Path $env:TEMP ("mithril-agent-install-script-" + [guid]::NewGuid().ToString() + ".ps1")`,
    "$exit = 1",
    "try {",
    "  Invoke-WebRequest -Uri $url -UseBasicParsing -OutFile $download",
    "  $actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash.ToLowerInvariant()",
    `  if ($actualSha256 -ne $expectedSha256) { Write-Error 'Hermes installer checksum mismatch; refusing to execute.'; exit ${INSTALLER_VERIFICATION_FAILED} }`,
    "  $bytes = [System.IO.File]::ReadAllBytes($download)",
    "  $text = [System.Text.Encoding]::UTF8.GetString($bytes)",
    "  if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }",
    "  [System.IO.File]::WriteAllText($installer, $text, (New-Object System.Text.UTF8Encoding $true))",
    "  $env:HERMES_REPO_URL = $repoUrl",
    "  & $installer -SkipSetup -NonInteractive -HermesHome $hermesHome -InstallDir $installDir -Branch main -Commit $commit",
    "  $exit = $LASTEXITCODE",
    "} finally {",
    "  Remove-Item -Force -ErrorAction SilentlyContinue $download, $installer",
    "}",
    "if ($env:HERMES_DESKTOP_SANDBOX -eq '1') {",
    "  $sandboxVenv = Join-Path $installDir 'venv\\Scripts'",
    "  $userHermesHome = [Environment]::GetEnvironmentVariable('HERMES_HOME', 'User')",
    "  if ($userHermesHome -and ($userHermesHome.TrimEnd('\\') -ieq $hermesHome.TrimEnd('\\'))) {",
    "    [Environment]::SetEnvironmentVariable('HERMES_HOME', $null, 'User')",
    "  }",
    "  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "  if ($userPath) {",
    "    $parts = $userPath -split ';' | Where-Object { $_ -and ($_.TrimEnd('\\') -ine $sandboxVenv.TrimEnd('\\')) }",
    "    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')",
    "  }",
    "}",
    "exit $exit",
    "",
  ].join("\r\n");
}
