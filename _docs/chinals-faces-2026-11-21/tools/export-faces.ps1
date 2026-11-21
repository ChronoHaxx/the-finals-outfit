# Chinals facial animation (21 Nov 2026): offline reads of the Chinals client's paks with chinals-probe (CUE4Parse
# 1.2.2.202611, GAME_TheFinalsTencent), rebuilt with the current scripts/anim-export/Export.cs so the clips' Face_*
# curve values are written (faceCurveValues). Read-only: the probe never writes near the game files, and nothing here
# runs or touches the game.
#
# Run in Windows PowerShell from any folder:
#   powershell -ExecutionPolicy Bypass -File <this file>
# It asks for the Chinals AES key (hidden input; from the FModel thread "THE FINALS (Chinese)"), keeps it in this
# process's environment only for the probe runs, and removes it at the end. The key is never written to disk or printed.
#
# Passes (each into a NEW folder under research\, the probe refuses a non-empty one):
#   1. anims  the 46 sequences (45 emotes + the outfit idle), same requests as the 10 Nov run-2  -> run-clips-1
#   2. anims  no sequences: the 33 Chinals head meshes' reference skeletons (mesh-SK_*.json)      -> heads-ref-1
#   3. json   the 27 face PoseAssets, the head data assets, the head AnimBP, the 6 face masks     -> json-face-1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# Inputs and outputs live in the worktree's ignored scripts/generated/, never next to this file.
$research = Join-Path (Resolve-Path (Join-Path $here '..\..\..')) 'scripts\generated\chinals-faces-2026-11-21\research'
$probe = 'E:\Coding\the-finals-outfit\scripts\generated\chinals\probe-bin-2026-11-21\ChinalsProbe.exe'
$oodle = 'C:\Users\ChronoHax\Downloads\c515634f862cc7387d845d327dac2f85a1456104\Output\.data\oodle-data-shared.dll'
$usmap = 'E:\GameSources\chinals\mapping-2026-10-31\503_TheFinalsTencent_31_10_2026.usmap'
# The client folder's name is Chinese; found by listing so this file stays ASCII (Windows PowerShell reads it as ANSI).
$client = Get-ChildItem 'E:\GameSources\chinals\2002270' -Directory | Select-Object -First 1
$paks = Join-Path $client.FullName 'Discovery\Content\Paks'
$inputs = @('requests-clips.json', 'requests-heads.json', 'targets-face-json.txt') | ForEach-Object { Join-Path $research $_ }
foreach ($p in @($probe, $oodle, $usmap, $paks) + $inputs) { if (-not (Test-Path -LiteralPath $p)) { throw "Missing: $p" } }
foreach ($d in @('run-clips-1', 'heads-ref-1', 'json-face-1')) {
  if (Test-Path -LiteralPath (Join-Path $research $d)) { throw "research\$d already exists: runs are kept, move it aside first" }
}

$secure = Read-Host -AsSecureString 'Chinals AES key (0x + 64 hex digits; input hidden)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:PROBE_AES_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
  if ($env:PROBE_AES_KEY -notmatch '^0x[0-9A-Fa-f]{64}$') { throw 'That is not 0x followed by 64 hex digits.' }

  function Probe([string]$mode, [string]$out, [string]$selector) {
    Write-Host "`n== $mode -> research\$out" -ForegroundColor Cyan
    & $probe $mode $paks TheFinalsTencent $oodle (Join-Path $research $out) $usmap $selector
    if ($LASTEXITCODE -ne 0) { Write-Host "($mode to $out reported failures, exit $LASTEXITCODE; see the lines above)" -ForegroundColor Yellow }
  }
  Probe anims 'run-clips-1' (Join-Path $research 'requests-clips.json')
  Probe anims 'heads-ref-1' (Join-Path $research 'requests-heads.json')
  Probe json 'json-face-1' ('@' + (Join-Path $research 'targets-face-json.txt'))
  Write-Host "`nDone. Tell Claude the export has finished." -ForegroundColor Green
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:PROBE_AES_KEY -ErrorAction SilentlyContinue
}
