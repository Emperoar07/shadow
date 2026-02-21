param(
  [switch]$DeployDevnet
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$anchorExe = Join-Path $repoRoot ".tools\anchor-0.32.1.exe"
$solanaBin = Join-Path $repoRoot ".tools\solana-v2.3.13-extracted\solana-release\bin"
$sbfSdk = Join-Path $solanaBin "platform-tools-sdk\sbf"

if (-not (Test-Path $anchorExe)) {
  throw "Anchor binary not found: $anchorExe"
}
if (-not (Test-Path $solanaBin)) {
  throw "Solana local bin not found: $solanaBin"
}
if (-not (Test-Path $sbfSdk)) {
  throw "SBF SDK path not found: $sbfSdk"
}

$env:HOME = $env:USERPROFILE
$env:PATH = "$solanaBin;$env:PATH"
$env:SBF_SDK_PATH = $sbfSdk

Push-Location $repoRoot
try {
  & $anchorExe build
  if ($DeployDevnet) {
    & $anchorExe deploy --provider.cluster devnet
  }
} finally {
  Pop-Location
}
