# Drives the INSTALLED copy of Emquad through Windows UI Automation, the way a person would:
# open a recent project from the start screen, compile, then double-click a bundle while the
# app is open. It never sends keystrokes, so it cannot type into other windows. The user's
# settings file is backed up first and put back afterwards, byte for byte.
#
# Usage, after installing the app with the installer (Windows PowerShell 5 or PowerShell 7):
#   powershell -ExecutionPolicy Bypass -File scripts\installed-test.ps1 -Project <a project folder> -Bundle <an .emquad file exported from it> [-Shot <png path>]
# The project must compile; the bundle must be one its History already holds, so that opening
# it reports that it is already part of the project.
param([string]$Project, [string]$Bundle, [string]$Shot)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$Tree = [System.Windows.Automation.TreeScope]
$Type = [System.Windows.Automation.ControlType]
$any = [System.Windows.Automation.Condition]::TrueCondition
$step = 0
function Ok($cond, $what) { $script:step++; if (-not $cond) { throw "check $($script:step) failed: $what" }; "ok $($script:step) - $what" }
function AppProcess { Get-Process emquad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
function AppWindow { $p = AppProcess; if ($p) { $AE::FromHandle($p.MainWindowHandle) } }
# First element in the app window of the given type whose name matches the wildcard.
function Find([string]$like, $type, [int]$seconds = 20) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) {
    $w = AppWindow
    if ($w) {
      $el = $w.FindAll($Tree::Descendants, $any) | Where-Object { $_.Current.ControlType -eq $type -and $_.Current.Name -like $like } | Select-Object -First 1
      if ($el) { return $el }
    }
    Start-Sleep -Milliseconds 400
  }
  return $null
}
# A button that is pressed or not (aria-pressed) is toggled rather than invoked.
function Press($el) {
  $pattern = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() }
  else { $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle() }
}

$cfgDir = Join-Path $env:APPDATA "app.emquad.desktop"
$cfg = Join-Path $cfgDir "settings.json"
$backup = if (Test-Path $cfg) { [System.IO.File]::ReadAllBytes($cfg) } else { $null }
# UTF-8 without a byte-order mark, whichever PowerShell runs this.
$utf8 = New-Object System.Text.UTF8Encoding $false
try {
  Get-Process emquad -ErrorAction SilentlyContinue | Stop-Process -Force
  # A name and one recent project are set up front, so nothing in the run needs typing or a
  # native file dialog.
  New-Item -ItemType Directory -Force $cfgDir | Out-Null
  $info = Get-Content (Join-Path $Project ".emquad\project.json") -Raw | ConvertFrom-Json
  $settings = @{ authorId = "00000000-0000-4000-8000-000000000001"; displayName = "Installed Test"; compileOnSave = $true; editorFontSize = 13
     recent = @(@{ id = $info.projectId; name = $info.name; path = $Project }) }
  [System.IO.File]::WriteAllText($cfg, ($settings | ConvertTo-Json -Depth 4), $utf8)
  Remove-Item (Join-Path $Project ".emquad\build") -Recurse -Force -ErrorAction SilentlyContinue

  Start-Process (Join-Path $env:LOCALAPPDATA "Emquad\emquad.exe")
  $recent = Find "$($info.name)*" $Type::Button 40
  Ok ($null -ne $recent) "the installed app starts and lists the recent project"
  Press $recent
  $recompile = Find "Recompile" $Type::Button 40
  Ok ($null -ne $recompile) "the project opens in the editor"
  Press $recompile
  Ok ($null -ne (Find "Compiled" $Type::Text 300)) "Recompile in the installed app reaches Compiled"
  # A project opens in the page view; the Code view's status line names the compiler.
  Press (Find "Code" $Type::Button 10)
  Ok ($null -ne (Find "Tectonic engine" $Type::Text 10)) "using the Tectonic that the installer put in place"
  Ok (Test-Path (Join-Path $Project ".emquad\build\main.pdf")) "and a PDF was written"
  if ($Shot) { & (Join-Path $PSScriptRoot "shot.ps1") -Out $Shot | Out-Null }

  # Double-clicking a bundle while the app is open must reuse the open window.
  Start-Process $Bundle
  $told = Find "*already part of your project*" $Type::Text 30
  Ok (@(Get-Process emquad).Count -eq 1) "double-clicking a bundle does not open a second copy"
  Ok ($null -ne $told) "the open window receives the bundle and reports it is already merged"
  "PASS: all $step checks passed"
}
catch { "FAIL: $($_.Exception.Message)" }
finally {
  Get-Process emquad -ErrorAction SilentlyContinue | Stop-Process -Force
  if ($null -ne $backup) { [System.IO.File]::WriteAllBytes($cfg, $backup) } else { Remove-Item $cfg -ErrorAction SilentlyContinue }
}
