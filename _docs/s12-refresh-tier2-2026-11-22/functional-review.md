# Guided functional review: S12 item refresh, tier 2 batch A (105 garments)

## What you are checking

Batch A swaps 105 garments to their Season 12 files (no app change). You are checking that they look right on the
production body types (Masculine and Androgynous), that nothing clips against the pre-S12 items they are worn with,
and that the garments whose skinning changed still bend cleanly in an emote.

- Branch `claude/s12-refresh-tier2-2026-11-22` (the PR names the commit). Data under test: the garments-only index
  `scripts/generated/s12-refresh-tier2-v1/merge-out-batchA-v7/assets.json` (`d9eaaf7d…`), built on the active index
  `3f64b2e6…`.
- Open: two local dev servers from the tier-2 worktree. **5241** is live data, **5243** batch A. Never the main
  session's 5174.
- Prerequisites: none beyond this machine. Nothing is downloaded; the game is not touched.
- Approximate hands-on time: 10 minutes.
- Agent checks: see "Recorded result".
- User checks: **waived** for all PRs (standing waiver, 22 Nov). The agent ran the steps below itself.

## Get it running

**PowerShell**, in `E:\Coding\the-finals-outfit\.claude\worktrees\angry-darwin-c51aab`:

```powershell
$env:VITE_ANIMATIONS_BASE = "https://fd946744.the-finals-outfit-assets.pages.dev/"; node scripts/body-types/serve-preview.mjs --port 5241
```

```powershell
$env:VITE_ANIMATIONS_BASE = "https://fd946744.the-finals-outfit-assets.pages.dev/"; node scripts/body-types/serve-preview.mjs --port 5243 --preview ../../../public/models/s12-bodytype-refresh-v1 --index scripts/generated/s12-refresh-tier2-v1/merge-out-batchA-v7 --live-body
```

Each prints `Local: http://127.0.0.1:<port>/`; the first load takes about a minute. Stop with Ctrl+C. Neither writes
to `public/`. Outfit links below are built by `capture-review.mjs` from `review-outfits-batchA.json` (same slots); the agent run used `review-outfits-batchA-functional.json`, `-emote.json` and `-rework.json`.

## Try it yourself

- [ ] **1. Start:** open 5243, pick Masculine, wear the outfit `o01-rainjacket-combat` (rain jacket, scallywag pants,
  sniper boots, hand cloth, tactical bandolier, racing helmet). Expected: everything loads, no "Preview paused", no
  console error.
- [ ] **2. Changed shapes:** orbit o01 and `o07-marine-viking` front and back on 5243 and 5241. Expected: the S12
  garments are slightly slimmer in places on Masculine; straps, belts and pouches stay on top; nothing pokes through.
- [ ] **3. Skinning under motion:** play the Flex emote on `o03-techcrop-holster` and `o05-robotwarrior`. Expected:
  sleeves, cuffs, the waist pouches and the elf boots bend without spikes, tears or stretched triangles.
- [ ] **4. Cross-slot:** `x12-pres12tee-over-s12pants` (pre-S12 basic tee over S12 Viking pants) and
  `x13-s12jacket-over-pres12jeans`. Expected: hems and waistbands layer as on live.
- [ ] **5. Androgynous:** switch o01, o06 and o10 to Androgynous. Expected: identical to 5241 (no body-type morph
  applies there).

## Recorded result

- Tested revision/build: (filled in below)
- Agent run: (filled in below)
- User checks: waived (standing waiver on all PRs, 22 Nov; recorded in memory `standing-check-waiver`).
- Merge authorization: tools/docs PR merges on agent pass; the index apply and the GLB upload are separate
  coordinator approvals.
