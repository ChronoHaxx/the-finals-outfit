# Guided functional review: copy a screenshot to the clipboard

## What you are checking

The screenshot panel's new Copy button puts the PNG on the clipboard instead of downloading it; this catches a copy
that the browser refuses, an image that pastes without its transparency, or a paste that differs from the saved file.

- PR / originating issue: your request of 15 Nov ("options to copy to clipboard too"); the PR link is in the PR
- Test this revision: branch `claude/screenshot-copy-2026-11-15`, the commit named in the PR
- Open: a local production build (commands below) in your usual desktop browser
- Prerequisites: this worktree's `node_modules`; Discord (or another chat) and Paint to paste into. No secrets.
- Approximate hands-on time: 5 minutes
- Agent checks: `README.md` in this folder, "Copy to the clipboard": copy section 11/11, other sections 52/52
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

PowerShell, in `E:\Coding\the-finals-outfit\.claude\worktrees\recursing-jennings-bbf9ae`:

```powershell
$env:VITE_BASE="/"; $env:VITE_ASSETS_BASE="https://f4a8e069.the-finals-outfit-assets.pages.dev/"; $env:VITE_MODELS_BASE="https://a029b249.the-finals-outfit-assets.pages.dev/"; $env:VITE_RECONSTRUCTION_BASE="https://c062af24.the-finals-outfit-assets.pages.dev/"; $env:VITE_ANIMATIONS_BASE="https://e5250f94.the-finals-outfit-assets.pages.dev/"; $env:VITE_CHINALS_ANIMATIONS_BASE="https://dcb131a5.the-finals-outfit-chinals-assets.pages.dev/"; $env:VITE_RECONSTRUCTION_ROUTES_FILE="src/data/reconstruction-routes.json"; npx vite build
```

```powershell
npx vite preview --base / --port 5215 --strictPort
```

Open http://localhost:5215/ (localhost counts as a secure page, which the clipboard needs). Stop with Ctrl+C. Copying
replaces whatever is on your clipboard.

## Try it yourself

- [ ] **1. Copy with the backdrop:** camera button, Backdrop, Copy. Expected: "Copied W × H to the clipboard"; paste
      into Discord's message box: the picture as on screen, backdrop included.
- [ ] **2. Copy transparent:** camera button, Transparent, Copy, then paste into Discord. Expected: only the character,
      no grey box, on Discord's own background (try dark and light theme if you can).
- [ ] **3. Paste into Paint:** paste the same transparent copy into Paint. Expected: the character; tell me what the
      background looks like (black, white or something else); this records what Windows apps without transparency get.
- [ ] **4. Save still works:** Save PNG. Expected: a file downloads as before.

If something fails, stop at that step and report its number and what happened.
Reply "1-4 pass" (using the actual step numbers), or e.g. "2 fails: grey box behind the character".

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given
