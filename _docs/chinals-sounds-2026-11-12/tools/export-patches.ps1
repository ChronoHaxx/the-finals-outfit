# Chinals emote sounds (12 Nov 2026), second pass: the two FloatModulo MetaSound patches the emote MetaSounds call
# (/EmbarkScript/... in 22 of them, /Game/Audio/... in MidAutumn and Swimsuit) and BP_AudioSyncManager, to check
# what they compute instead of trusting their names. Read-only, like export-sounds.ps1 beside this file.
#   powershell -NoProfile -ExecutionPolicy Bypass -File <this file>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# Outputs go to the worktree's ignored scripts/generated/, never next to this file.
$research = Join-Path (Resolve-Path (Join-Path $here '..\..\..')) 'scripts\generated\chinals-sounds-2026-11-12\research'
New-Item -ItemType Directory -Force $research | Out-Null
$probe = 'E:\Coding\the-finals-outfit\scripts\generated\chinals\probe-bin\ChinalsProbe.exe'
$oodle = 'C:\Users\ChronoHax\Downloads\c515634f862cc7387d845d327dac2f85a1456104\Output\.data\oodle-data-shared.dll'
$usmap = 'E:\GameSources\chinals\mapping-2026-10-31\503_TheFinalsTencent_31_10_2026.usmap'
$client = Get-ChildItem 'E:\GameSources\chinals\2002270' -Directory | Select-Object -First 1
$paks = Join-Path $client.FullName 'Discovery\Content\Paks'
if (Test-Path -LiteralPath (Join-Path $research 'json-patches-1')) { throw 'research\json-patches-1 already exists: runs are kept, move it aside first' }
$secure = Read-Host -AsSecureString 'Chinals AES key (0x + 64 hex digits; input hidden)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:PROBE_AES_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
  if ($env:PROBE_AES_KEY -notmatch '^0x[0-9A-Fa-f]{64}$') { throw 'That is not 0x followed by 64 hex digits.' }
  & $probe json $paks TheFinalsTencent $oodle (Join-Path $research 'json-patches-1') $usmap ('@' + (Join-Path $research 'targets-patches-1.txt'))
  Write-Host "`nDone (exit $LASTEXITCODE). Tell Claude the second export has finished." -ForegroundColor Green
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:PROBE_AES_KEY -ErrorAction SilentlyContinue
}
