#!/usr/bin/env bash
# Git Bash, from the worktree root: the dev viewer against the production asset hosts (values from
# .github/workflows/deploy.yml on 22 Nov 2026, after the merge of main). Open http://localhost:5190/?reconstructed=1
set -euo pipefail
export MSYS_NO_PATHCONV=1
VITE_ASSETS_BASE=https://f4a8e069.the-finals-outfit-assets.pages.dev/ \
VITE_MODELS_BASE=https://a029b249.the-finals-outfit-assets.pages.dev/ \
VITE_RECONSTRUCTION_BASE=https://c062af24.the-finals-outfit-assets.pages.dev/ \
VITE_SHARE_PREVIEW_BASE=https://the-finals-outfit-share.chronohaxx.workers.dev \
VITE_ANIMATIONS_BASE=https://fd946744.the-finals-outfit-assets.pages.dev/ \
VITE_CHINALS_ANIMATIONS_BASE=https://dcb131a5.the-finals-outfit-chinals-assets.pages.dev/ \
VITE_RECONSTRUCTION_ROUTES_FILE=src/data/reconstruction-routes.json \
npx vite --port 5190 --strictPort
