# Chinals emote sounds (12 Nov 2026): offline reads of the Chinals client's paks with chinals-probe (CUE4Parse
# 1.2.2.202611, GAME_TheFinalsTencent). Read-only: the probe never writes near the game files, and nothing here runs
# or touches the game.
#
# Run in Windows PowerShell from any folder:
#   powershell -ExecutionPolicy Bypass -File <this file>
# It asks for the Chinals AES key (hidden input; from the FModel thread "THE FINALS (Chinese)"), keeps it in this
# process's environment only for the probe runs, and removes it at the end. The key is never written to disk or printed.
#
# Passes (each into a NEW folder under research\, the probe refuses a non-empty one):
#   1. json   the 46 sequences (45 emotes + the outfit idle)   -> json-seqs-1
#   2. json   the 43 sound assets the emotes' notifies name    -> json-sound-1
#   3. node   wave-targets.mjs: the SoundWaves they reach      -> targets-waves-1.txt
#   4. json   those SoundWaves                                 -> json-waves-1
#   5. sound  those SoundWaves' cooked audio bytes             -> waves-1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# Outputs go to the worktree's ignored scripts/generated/, never next to this file.
$research = Join-Path (Resolve-Path (Join-Path $here '..\..\..')) 'scripts\generated\chinals-sounds-2026-11-12\research'
New-Item -ItemType Directory -Force $research | Out-Null
$probe = 'E:\Coding\the-finals-outfit\scripts\generated\chinals\probe-bin\ChinalsProbe.exe'
$oodle = 'C:\Users\ChronoHax\Downloads\c515634f862cc7387d845d327dac2f85a1456104\Output\.data\oodle-data-shared.dll'
$usmap = 'E:\GameSources\chinals\mapping-2026-10-31\503_TheFinalsTencent_31_10_2026.usmap'
# The client folder's name is Chinese; found by listing so this file stays ASCII (Windows PowerShell reads it as ANSI).
$client = Get-ChildItem 'E:\GameSources\chinals\2002270' -Directory | Select-Object -First 1
$paks = Join-Path $client.FullName 'Discovery\Content\Paks'
foreach ($p in @($probe, $oodle, $usmap, $paks)) { if (-not (Test-Path -LiteralPath $p)) { throw "Missing: $p" } }
foreach ($d in @('json-seqs-1', 'json-sound-1', 'json-waves-1', 'waves-1')) {
  if (Test-Path -LiteralPath (Join-Path $research $d)) { throw "research\$d already exists: runs are kept, move it aside first" }
}

$secure = Read-Host -AsSecureString 'Chinals AES key (0x + 64 hex digits; input hidden)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:PROBE_AES_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
  if ($env:PROBE_AES_KEY -notmatch '^0x[0-9A-Fa-f]{64}$') { throw 'That is not 0x followed by 64 hex digits.' }

  function Probe([string]$mode, [string]$out, [string]$targets) {
    Write-Host "`n== $mode -> research\$out" -ForegroundColor Cyan
    & $probe $mode $paks TheFinalsTencent $oodle (Join-Path $research $out) $usmap ('@' + (Join-Path $research $targets))
    if ($LASTEXITCODE -ne 0) { Write-Host "($mode to $out reported failures, exit $LASTEXITCODE; see the lines above)" -ForegroundColor Yellow }
  }
  Probe json 'json-seqs-1' 'targets-seqs.txt'
  Probe json 'json-sound-1' 'targets-sounds-1.txt'
  Write-Host "`n== wave targets" -ForegroundColor Cyan
  & node (Join-Path $here 'wave-targets.mjs') (Join-Path $research 'json-sound-1') (Join-Path $research 'targets-sounds-1.txt') (Join-Path $research 'targets-waves-1.txt')
  if ($LASTEXITCODE -ne 0) { throw 'wave-targets.mjs failed' }
  Probe json 'json-waves-1' 'targets-waves-1.txt'
  Probe sound 'waves-1' 'targets-waves-1.txt'
  Write-Host "`nDone. Tell Claude the export has finished." -ForegroundColor Green
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:PROBE_AES_KEY -ErrorAction SilentlyContinue
}
