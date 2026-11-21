# Guided functional review: every emote in the picker

## What you are checking

The emote picker lists the 66 emotes it was missing (mostly Seasons 1 and 2), and in Chinals mode the five emotes
without an icon of their own sit under Uncategorised. This catches a missing season, a broken tile or prop, or an
old link that no longer opens its emote.

- PR / originating issue: Shocka's feedback item 1 (`_docs/feedback-shocka-2026-11/README.md`); the PR is linked from the README.
- Test this revision: branch `claude/all-emotes-2026-11-21`, the PR's head commit, with the staged animations
  deployment `scripts/generated/all-emotes-2026-11-21/upload/anim-20261121a` (not uploaded yet).
- Open: http://127.0.0.1:5204/?reconstructed=1 (a local preview; the live site is unchanged until the upload and merge).
- Prerequisites: none beyond this worktree. Models come from the live asset hosts; animations from the staged folder.
- Approximate hands-on time: 5 minutes.
- Agent checks (21 Nov, details in README.md "Verification"): census PASS (229/229 old items read as on 5 Nov); clip,
  face-curve and sound pipelines PASS (byte-identical to the live files they overlap); `tsc -b` PASS; `npm test`
  899 pass, 8 known failures (gitignored model files); picker sections and two prop emotes PASS by eye (headless Chrome).
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

PowerShell, in `E:\Coding\the-finals-outfit\.claude\worktrees\heuristic-darwin-d076c9` (skip this if the agent's
server on port 5204 is still running: the page opens):

```powershell
$env:VITE_RECONSTRUCTION_ROUTES_FILE = 'src/data/reconstruction-routes.json'; $env:VITE_ASSETS_BASE = 'https://f4a8e069.the-finals-outfit-assets.pages.dev/'; $env:VITE_MODELS_BASE = 'https://a029b249.the-finals-outfit-assets.pages.dev/'; $env:VITE_RECONSTRUCTION_BASE = 'https://c062af24.the-finals-outfit-assets.pages.dev/'; $env:VITE_CHINALS_ANIMATIONS_BASE = 'https://59209741.the-finals-outfit-chinals-assets.pages.dev/'; node _docs/chinals-mode-2026-11-12/serve-preview.mjs --set=scripts/generated/all-emotes-2026-11-21/upload/anim-20261121a --port=5204
```

Stop it with Ctrl+C. Nothing is written outside `scripts/generated/`.

## Try it yourself

- [ ] **1. Start:** open http://127.0.0.1:5204/?reconstructed=1. Expected: the default outfit loads and plays its idle.
- [ ] **2. The new seasons:** click **Emotes**. Expected: the tab reads **Emotes 295**. Scroll to the bottom:
  **Season 2 · 16** and **Season 1 · 41**, each tile with its game icon (Carrot Crusher, Make It Rain, Tama Kickoff...).
- [ ] **3. Play two of them:** click **Coop Caper**, then **Gimme Five**. Expected: Coop Caper has a chicken plushie
  running around the feet; Gimme Five shows the translucent stand-in partner for the high five. Sound plays after your
  first click (if the speaker is on).
- [ ] **4. Renamed, not lost:** search `what's up` and play **What's Up?** (it was "Wave" under More). Then open **More**.
  Expected: it plays the wave; More's "Unlisted emote animations" now holds only **Tap Dance** (an animation no item plays).
- [ ] **5. Chinals Uncategorised:** switch to **Chinals**, open **Emotes**, scroll to the end. Expected:
  **Uncategorised · 5** ("No icon of their own in the game files"): Gacha_01 and four with Chinese names; clicking one plays it.

If something fails, stop at that step and report its number and what happened. Reply "1-5 pass", or e.g.
"3 fails: no chicken".

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending (also waits on the upload of `anim-20261121a` and the `ANIMATIONS_BASE` bump)
- Merge authorization: not yet given
