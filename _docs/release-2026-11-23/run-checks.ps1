# 24 Nov: tsc, tests, production build (deploy.yml env, no public copy), routed browser scenarios on the release hosts.
$ErrorActionPreference = 'Continue'
$WT = 'E:\Coding\the-finals-outfit\.claude\worktrees\loving-napier-b93181'
$G = "$WT\scripts\generated\release-2026-11-23"
$T = "$WT\_docs\release-2026-11-23\tools"
Set-Location $WT
function Log($m) { Add-Content -Path "$G\run-checks.log" -Value ("{0} {1}" -f (Get-Date -Format HH:mm:ss), $m) }
cmd /c "npx tsc -b > `"$G\release-tsc-v2.log`" 2>&1"; Log "tsc exit $LASTEXITCODE"
cmd /c "npm test > `"$G\release-tests-v2.log`" 2>&1"; Log ("tests exit $LASTEXITCODE " + ((Select-String -Path "$G\release-tests-v2.log" -Pattern '^# (pass|fail) ' | ForEach-Object { $_.Line }) -join ' '))
$env:VITE_BASE = '/the-finals-outfit/'
$env:VITE_ASSETS_BASE = 'https://2cbead71.the-finals-outfit-assets.pages.dev/'
$env:VITE_MODELS_BASE = 'https://a029b249.the-finals-outfit-assets.pages.dev/'
$env:VITE_RECONSTRUCTION_BASE = 'https://dfe1d5e8.the-finals-outfit-assets.pages.dev/'
$env:VITE_SHARE_PREVIEW_BASE = 'https://the-finals-outfit-share.chronohaxx.workers.dev'
$env:VITE_ANIMATIONS_BASE = 'https://fd946744.the-finals-outfit-assets.pages.dev/'
$env:VITE_CHINALS_ANIMATIONS_BASE = 'https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/'
$env:VITE_SCENES_BASE = 'https://1d367244.the-finals-outfit-assets.pages.dev/'
$env:VITE_RECONSTRUCTION_ROUTES_FILE = 'src/data/reconstruction-routes.json'
$env:RELEASE_WORKTREE = $WT
$build = "$G\production-build-v1"
cmd /c "node `"$T\build-release.mjs`" `"$build`" > `"$G\production-build-v1.log`" 2>&1"; Log "build exit $LASTEXITCODE"
if (-not (Test-Path "$build\index.html")) { Log 'no build; stop'; exit 1 }
$bundle = Get-ChildItem "$build\assets\index-*.js" | Select-Object -First 1
$txt = Get-Content $bundle.FullName -Raw
Log ("bundle {0}: dfe1d5e8={1} f1fa60b6={2} 709a36ca={3} a70ffa7f={4} note={5}" -f $bundle.Name, $txt.Contains('dfe1d5e8'), $txt.Contains('f1fa60b6'), $txt.Contains('709a36ca'), $txt.Contains('a70ffa7f'), $txt.Contains('2026-11-23-season-12-refit'))
$srv = Start-Process node -ArgumentList "`"$T\serve-build.mjs`"", "`"$build`"", '4341' -WorkingDirectory $WT -PassThru -WindowStyle Hidden -RedirectStandardOutput "$G\serve-build-v1.log" -RedirectStandardError "$G\serve-build-v1.err"
$ok = $false; for ($i = 0; $i -lt 60; $i++) { Start-Sleep 2; try { $r = Invoke-WebRequest 'http://127.0.0.1:4341/the-finals-outfit/' -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {} }
Log "server up $ok pid $($srv.Id)"
if ($ok) {
  $env:PRODUCTION_URL = 'http://127.0.0.1:4341/the-finals-outfit/'
  $env:ASSETS_BASE = $env:VITE_ASSETS_BASE; $env:MODELS_BASE = $env:VITE_MODELS_BASE
  $env:RECONSTRUCTION_BASE = $env:VITE_RECONSTRUCTION_BASE
  $env:SHARD_PLAN = "$G\shard-plan-v1.json"; $env:SHARD_HOSTS = "$G\hosts-v1.json"
  $env:PRODUCTION_REPORT_DIR = "$G\hosted-browser-v1"
  cmd /c "node `"$T\check-production-routed.mjs`" > `"$G\hosted-browser-v1.log`" 2>&1"; Log "routed scenarios exit $LASTEXITCODE"
}
taskkill /PID $srv.Id /T /F | Out-Null; Log "server stopped"
Log 'done'
