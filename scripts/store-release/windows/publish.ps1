param(
  [Parameter(Mandatory = $true)]
  [string]$Package,
  [Parameter(Mandatory = $true)]
  [string]$AppId,
  [switch]$Commit
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Package -PathType Leaf)) {
  throw "MSIX package does not exist: $Package"
}

foreach ($name in @(
  "PARTNER_CENTER_TENANT_ID",
  "PARTNER_CENTER_SELLER_ID",
  "PARTNER_CENTER_CLIENT_ID",
  "PARTNER_CENTER_CLIENT_SECRET"
)) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "Missing required environment variable: $name"
  }
}

if (-not (Get-Command msstore -ErrorAction SilentlyContinue)) {
  throw "Microsoft Store Developer CLI (msstore) is not installed"
}

msstore reconfigure `
  --tenantId $env:PARTNER_CENTER_TENANT_ID `
  --sellerId $env:PARTNER_CENTER_SELLER_ID `
  --clientId $env:PARTNER_CENTER_CLIENT_ID `
  --clientSecret $env:PARTNER_CENTER_CLIENT_SECRET

$publishArgs = @("publish", ".", "--inputFile", $Package, "--appId", $AppId)
if (-not $Commit) {
  $publishArgs += "--noCommit"
}

& msstore @publishArgs
if ($LASTEXITCODE -ne 0) {
  throw "Microsoft Store submission failed with exit code $LASTEXITCODE"
}
