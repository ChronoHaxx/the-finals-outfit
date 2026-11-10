#!/usr/bin/env bash
# Git Bash, from the worktree root: build the app against the production asset hosts, with the share-preview Worker
# pointed at a local `wrangler dev` (workers/share-preview/README.md, port 8787). MSYS_NO_PATHCONV stops Git Bash
# rewriting /the-finals-outfit/ into C:/Program Files/Git/the-finals-outfit/ (it did, silently, on the first try).
set -euo pipefail
export MSYS_NO_PATHCONV=1
VITE_BASE=/the-finals-outfit/ \
VITE_ASSETS_BASE=https://f4a8e069.the-finals-outfit-assets.pages.dev/ \
VITE_MODELS_BASE=https://a029b249.the-finals-outfit-assets.pages.dev/ \
VITE_RECONSTRUCTION_BASE=https://bbbde965.the-finals-outfit-assets.pages.dev/ \
VITE_SHARE_PREVIEW_BASE=http://127.0.0.1:8787 \
VITE_ANIMATIONS_BASE=https://cd858839.the-finals-outfit-assets.pages.dev/ \
VITE_RECONSTRUCTION_ROUTES_FILE="$(pwd -W)/src/data/reconstruction-routes.json" \
npx vite build
grep -q 'src="/the-finals-outfit/assets/' dist/index.html && echo "base ok"
