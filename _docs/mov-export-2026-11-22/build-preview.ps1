# PowerShell, from the worktree root: a production build with the asset hosts in .github/workflows/deploy.yml (values
# of 22 Nov 2026, main 1691441), served by `vite preview` at http://localhost:5196/the-finals-outfit/.
# Run from PowerShell, not Git Bash: MSYS rewrites the --base path.
#   powershell -File _docs/mov-export-2026-11-22/build-preview.ps1            (build, then serve)
#   powershell -File _docs/mov-export-2026-11-22/build-preview.ps1 -ServeOnly
param([switch]$ServeOnly)
$ErrorActionPreference = "Stop"
$env:VITE_BASE = "/the-finals-outfit/"
$env:VITE_ASSETS_BASE = "https://2cbead71.the-finals-outfit-assets.pages.dev/"
$env:VITE_MODELS_BASE = "https://a029b249.the-finals-outfit-assets.pages.dev/"
$env:VITE_RECONSTRUCTION_BASE = "https://a70ffa7f.the-finals-outfit-assets.pages.dev/"
$env:VITE_SHARE_PREVIEW_BASE = "https://the-finals-outfit-share.chronohaxx.workers.dev"
$env:VITE_ANIMATIONS_BASE = "https://fd946744.the-finals-outfit-assets.pages.dev/"
$env:VITE_CHINALS_ANIMATIONS_BASE = "https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/"
$env:VITE_SCENES_BASE = "https://1d367244.the-finals-outfit-assets.pages.dev/"
$env:VITE_RECONSTRUCTION_ROUTES_FILE = "src/data/reconstruction-routes.json"
if (-not $ServeOnly) {
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Copy-Item dist/index.html dist/404.html
}
npx vite preview --base /the-finals-outfit/ --port 5196 --strictPort
