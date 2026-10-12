# Downloads the Tectonic compiler into src-tauri/sidecars so the app can compile LaTeX without a
# TeX installation. Run from the repository root:  pwsh scripts/fetch-sidecars.ps1
#
# It takes the latest Tectonic release from GitHub for 64-bit Windows and prints the SHA-256 of
# what it downloaded, so the version in use can be recorded in the README.
$ErrorActionPreference = "Stop"
$dest = Join-Path $PSScriptRoot "..\src-tauri\sidecars"
New-Item -ItemType Directory -Force $dest | Out-Null

$release = Invoke-RestMethod "https://api.github.com/repos/tectonic-typesetting/tectonic/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like "*x86_64-pc-windows-msvc.zip" } | Select-Object -First 1
if (-not $asset) { throw "No Windows build found in release $($release.tag_name)" }

$zip = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB) from $($release.tag_name)"
Invoke-WebRequest $asset.browser_download_url -OutFile $zip
Expand-Archive $zip -DestinationPath $dest -Force
Remove-Item $zip

$exe = Join-Path $dest "tectonic.exe"
if (-not (Test-Path $exe)) { throw "tectonic.exe was not in the archive" }
Write-Host "Installed $exe"
Write-Host "Release: $($release.tag_name)"
Write-Host "SHA-256: $((Get-FileHash $exe -Algorithm SHA256).Hash)"
