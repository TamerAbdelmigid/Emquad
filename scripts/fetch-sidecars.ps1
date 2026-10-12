# Downloads the helper programs into src-tauri/sidecars: Tectonic, so the app can compile LaTeX
# without a TeX installation, and texlab, the language server. Run from the repository root:  pwsh scripts/fetch-sidecars.ps1
#
# It takes each project's latest release from GitHub for 64-bit Windows and prints the SHA-256
# of what it downloaded, so the versions in use can be recorded in the README.
$ErrorActionPreference = "Stop"
$dest = Join-Path $PSScriptRoot "..\src-tauri\sidecars"
New-Item -ItemType Directory -Force $dest | Out-Null

function Get-Sidecar([string]$Repo, [string]$AssetPattern, [string]$Exe) {
  $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -like $AssetPattern } | Select-Object -First 1
  if (-not $asset) { throw "No Windows build found in $Repo release $($release.tag_name)" }
  $zip = Join-Path $env:TEMP $asset.name
  Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB) from $Repo $($release.tag_name)"
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip
  Expand-Archive $zip -DestinationPath $dest -Force
  Remove-Item $zip
  $path = Join-Path $dest $Exe
  if (-not (Test-Path $path)) { throw "$Exe was not in the archive" }
  Write-Host "Installed $Exe  release: $($release.tag_name)  SHA-256: $((Get-FileHash $path -Algorithm SHA256).Hash)"
}

# The compiler (MIT licence).
Get-Sidecar "tectonic-typesetting/tectonic" "*x86_64-pc-windows-msvc.zip" "tectonic.exe"
# The language server (GPL-3.0; run as a separate program, never linked into the app).
Get-Sidecar "latex-lsp/texlab" "*x86_64-windows.zip" "texlab.exe"
