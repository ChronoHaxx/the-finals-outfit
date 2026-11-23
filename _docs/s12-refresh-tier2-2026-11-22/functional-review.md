# Guided functional review: S12 item refresh, tier 2 batch A (104 garments)

## What you are checking

Batch A swaps 104 garments to their Season 12 files (no app change). You are checking that they look right on the
production body types (Masculine and Androgynous), that nothing clips against the pre-S12 items they are worn with,
and that the garments whose skinning changed still bend cleanly in an emote.

- Branch `claude/s12-refresh-tier2-2026-11-22` (the PR names the commit). Data under test: the garments-only index
  `scripts/generated/s12-refresh-tier2-v1/merge-out-batchA-v8/assets.json` (`b4f28192…`), built on the active index
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
$env:VITE_ANIMATIONS_BASE = "https://fd946744.the-finals-outfit-assets.pages.dev/"; node scripts/body-types/serve-preview.mjs --port 5243 --preview ../../../public/models/s12-bodytype-refresh-v1 --index scripts/generated/s12-refresh-tier2-v1/merge-out-batchA-v8 --live-body
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

- Tested revision/build: tools at `bf67fd6` (this branch); data `merge-out-batchA-v7/assets.json` (`d9eaaf7d…`) on 5243
  against live `3f64b2e6…` on 5241, both `--live-body`. 23 Nov 2026. The hand-off is v8 (`b4f28192…`), which differs
  from v7 only in `SK_Streetwear_PopGothShoes_M` (held after the footwear check below; `git diff --no-index` of the two
  merged indexes: that entry's url and sha256 only). o03, the one outfit wearing it, was recaptured on v8.
- Agent run (`capture-review.mjs`, then `diff-captures.py`, then the pair images looked at full size; captures in
  `scripts/generated/s12-refresh-tier2-v1/captures-v7/`):
  - [x] **1. Start: PASS.** Every shot on 5243 loaded all of the outfit's meshes with 0 console errors (o01 16 meshes,
    Masculine idle, the four cameras).
  - [x] **2. Changed shapes: PASS.** o01 (`func-idle-diff/o01…masculine-front`): the S12 rain jacket is slightly
    slimmer; harness, belt and pouches stay on top. o07 (`…masculine-back`): the S12 shirt under the armour changes
    slightly; armour and grenades stay on top. Nothing pokes through.
  - [x] **3. Skinning under motion: PASS, with one note.** Flex on o03 (`func-flex-diff/o03…`, right underarm zoom
    `captures/zoom/o03-flex-v7-right-underarm.png`) and o05 (`…masculine-back`): sleeves, the robot top's armour, the
    gloves and the waist pouches bend without spikes, tears or stretched triangles. Note, from the earlier set
    (`captures/zoom/o04-flex-back-underarm-x3.png`): in Flex's raised arms, the S12 `TechCropTopNoBags` opens a
    small slot at the underarm where the garment's inside shows. Live opens a similar sliver beside it, and idle is
    clean. Accepted as the S12 weights.
  - [x] **4. Cross-slot: PASS.** x12 (`…masculine-waist`): the pre-S12 tee's hem lies over the S12 Viking pants as
    on live; only the pants' dark side straps move. x13 (`…masculine-front`): the S12 jacket's hem sits over the
    pre-S12 jeans and belt as on live.
  - [x] **5. Androgynous: PASS.** o01, o06, o10 (and x12, x13), still and idle: within the capture noise of live
    (≤ 147 px, max level ≤ 20, all at the face or on noise spots seen in live-vs-live).
  - [x] **Rework and gap outfits** (r01 braided bracelet, r02 hood wrap, r03 Trentila boots): Androgynous still pose
    matches live within noise (≤ 107 px, level ≤ 7). Idle and Flex Masculine: the same pieces, sitting slightly
    differently on the re-sculpted body, with no stretching.
  - [x] **Footwear: PASS on v8, after holding one mesh.** The cameras above frame head to thigh, so a feet pass
    (`feet`, `feetback`, `feetside`, `full`; 9 outfits, Masculine and Androgynous, idle; `feet-idle-diff/`):
    proof-admitted footwear (Viking, vampire, sniper boots) matches live on Androgynous. Reviewed weights: tech boots
    (straps sit slightly higher, clean), elf boots, wizard boots, Lunar boots, Trentila overlay: clean.
    **`SK_Streetwear_PopGothShoes_M` failed:** its S12 weights pull the lower lacing and eyelets into stretched,
    flattened shapes (`captures/zoom/o03-feet-popgoth-andro-right.png`). Held, as v8. o03 on v8
    (`feet-v8-diff/`): within noise of live (≤ 21 px, level ≤ 2).
- User checks: waived (standing waiver on all PRs, 22 Nov; recorded in memory `standing-check-waiver`).
- Merge authorization: tools/docs PR merges on agent pass; the index apply and the GLB upload are separate
  coordinator approvals.
