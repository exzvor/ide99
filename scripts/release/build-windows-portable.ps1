# scripts/ci/build-windows-portable.ps1 — produce a portable .zip of
# ide99 from target/release/ide99.exe.
#
# Why: while a code-signing certificate is not in place, the NSIS .exe
# installer hits two layers of friction:
#   1. browser-level download reputation (Yandex Browser "Неподтверждено",
#      SmartScreen reputation) which can hide the file outright;
#   2. SmartScreen at first launch.
#
# A flat .zip dodges (1) — most browsers don't reputation-gate archives.
# (2) still fires once on the first launch of the bundled .exe and is
# covered by the visual guide on the landing page. Once the EV cert is
# procured, the NSIS installer becomes friction-free and the portable
# zip remains as a "no-admin" alternative.
#
# Usage:
#   build-windows-portable.ps1
#     expects target/release/ide99.exe to exist (cargo tauri build done)
#     emits   target/release/bundle/portable/ide99_${VERSION}_x64-portable.zip

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $RepoRoot
try {
  $exePath = "target\release\ide99.exe"
  if (-not (Test-Path $exePath)) {
    Write-Error "$exePath not found — run ``cargo tauri build`` first."
    exit 1
  }

  $version = node -p "require('./src-tauri/tauri.conf.json').version"
  $outDir  = "target\release\bundle\portable"
  $outZip  = Join-Path $outDir "ide99_${version}_x64-portable.zip"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null

  $staging = Join-Path ([System.IO.Path]::GetTempPath()) "ide99-portable-$([Guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force -Path $staging | Out-Null
  try {
    # The Tauri Windows build embeds the frontend bundle and uses the
    # system-provided WebView2 runtime (Windows 10 1903+), so the single
    # ide99.exe is the entire payload. Sidecar DLLs would be picked up
    # from target/release/ here if we ever add any.
    Copy-Item $exePath $staging

    if (Test-Path $outZip) {
      Remove-Item $outZip
    }
    Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $outZip -CompressionLevel Optimal

    $size = (Get-Item $outZip).Length
    $sizeMb = [Math]::Round($size / 1MB, 1)
    Write-Host "→ portable zip → $outZip"
    Write-Host "  size: $sizeMb MB"
    Write-Host "  version: $version"
    Write-Host ""
    Write-Host "Готово. Portable zip создан."
  } finally {
    Remove-Item -Recurse -Force $staging
  }
} finally {
  Pop-Location
}
