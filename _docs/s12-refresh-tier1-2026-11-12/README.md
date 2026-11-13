# Season 12 item refresh, tier 1: pilot (12-13 Nov 2026)

The plan is in `PLAN.md`. On 12 Nov the user answered the hands-on gate with "You do all 8", so the agent ran the
pilot. This file records how the pilot was built, how to rebuild it, and the review.

## Files

| File | What |
|---|---|
| `PLAN.md` | the re-census, the tiers, the tier-1 classes, derived data, route, Fable review |
| `tier1-census-v1.json` | per-mesh tier, items showing, unlocks, and the tier-1 classes against the driver skeleton |
| `skin-by-name-proof-v1.json` | `skin-by-name-proof.py` on all 242 refused meshes (active index `7678e698…`) |
| `merge-patch-pilot-v2.json` | the pilot as a patch pinned to `7678e698…` / `f15a73a2…` |
| `publish-list-pilot-v2.txt` | the 9 GLBs a merge must publish |
| `HANDOFF.md` | the merge recipe for the main session |
| `functional-review.md` | the user's guided checklist |

Data that is not committed lives in the root checkout:
- `public/models/s12-refresh-tier1-v1/`: census v3, proof v3, `index-base`, `index-pilot` (superseded; the long coat
  was held), `index-pilot-v2`, `index-pilot-v2-garments`;
- `.claude/evidence/s12-refresh-tier1-2026-11-12-local/`: the captures, diffs and pair images.

## Tools (`scripts/body-types/`)

- `skin-by-name-proof.py`: judges each refused mesh as the rig renders it, by joint name, against the driver skeleton
  (`public/models/body/SK_Body_M.glb`). 11 tests.
- `build-preview-index.py --admit/--admit-only/--admit-reviewed`: admitted meshes count as proven, so the item rule
  runs unchanged. 4 new tests (11 in all).
- `make-merge-patch.py`: preview index → pinned patch for `apply-merge-patch.py`.
- `diff-captures.py`: live vs pilot shot diffs, with full-size pair images.
- `capture-review.mjs`: `--query` for paused clip frames (`anim=<clip>&animTime=<s>`), plus `back` and `sideleft`
  cameras.

## Rebuild on a moved index

Run in Git Bash, from the root checkout. Every step only reads the active index and refuses an existing output.

```bash
W=.claude/worktrees/loving-napier-b93181
A=public/models/reconstructed-assemblies-v1
P=public/models/s12-bodytype-refresh-v1
O=public/models/s12-refresh-tier1-v1
N=v4   # a new suffix each time
node $W/_docs/body-types-2026-11-06/scripts/morph-census.mjs $A/assets.json $O/morph-census-$N.json
python -I $W/scripts/body-types/morph-only-proof.py $A/assets.json $P/meshes $O/morph-only-proof-$N.json
python -I $W/scripts/body-types/skin-by-name-proof.py $A/assets.json $O/morph-only-proof-$N.json $P/meshes public/models/body/SK_Body_M.glb $O/skin-by-name-proof-$N.json
python -I $W/scripts/body-types/build-preview-index.py $A/assets.json $O/morph-only-proof-$N.json $P/meshes $O/index-pilot-$N/assets.json public/models/reconstructed-assembly-v2/customization.json --census $O/morph-census-$N.json --changed-only --admit $O/skin-by-name-proof-$N.json --admit-only SK_Casual_Tshirt_M,SK_Streetwear_TechGloves_M,SK_Streetwear_VarsityJacket_M,SK_Casual_Sweater_M,SK_Military_SniperPants_M --admit-reviewed SK_StarterSet_TShirt_M,SK_Streetwear_SingleSleeveTop_M,SK_Streetwear_HipBag_M
python -I $W/scripts/body-types/make-merge-patch.py $A/assets.json $O/index-pilot-$N/assets.json $O/merge-patch-pilot-$N.json
```

Use the Anaconda Python (`/c/ProgramData/anaconda3/python.exe -X utf8`); the bare `python` in Git Bash is 3.7.

## Preview servers (this worktree, never 5174)

The worktree's `node_modules` is a junction to `scripts/generated/release-2026-11-05/node_modules` (same lockfile).
`VITE_ANIMATIONS_BASE` must be the deploy's `ANIMATIONS_BASE`, since there is no local clip copy.

```bash
export VITE_ANIMATIONS_BASE=https://e5250f94.the-finals-outfit-assets.pages.dev/
node scripts/body-types/serve-preview.mjs --port 5231
node scripts/body-types/serve-preview.mjs --port 5232 --preview ../../../public/models/s12-bodytype-refresh-v1 --index ../../../public/models/s12-refresh-tier1-v1/index-pilot-v2-garments --live-body
```

Ports 5185-5199 were all taken by other sessions on 12 Nov. Check `netstat -ano -p TCP` first.

## Review

Evidence: `.claude/evidence/s12-refresh-tier1-2026-11-12-local/` (root checkout).

### Still pose, Androgynous (done 13 Nov 00:30)

Captured with `anim=0&sway=0`: 8 outfits x 3 cameras, on live (5231) and pilot (5232). There were 0 console errors in
48 shots. A repeat of the live set gives the noise floor (`noise-still/`).

- **Class A (a1-a4: tee, sniper pants, varsity jacket + tech gloves, sweater): identical to live within noise in every
  shot.** For example, a3 front is 1,443 px against 1,411 px of noise, which is skin speckle at the neckline. This
  confirms the proof. In a posed idle frame, the T-shirt's 2/255 weight rounding moves at most 730 px by 7 levels or
  less, which is invisible (`smoke/diff-idle-a1-x30.png`).
- **d2, the USA biker vest: a live defect fixed.** On live, the eagle-print tee pokes through the vest's left panel.
  On the pilot, the S12 tee's new `shrink_under_vest` keeps it under the vest
  (`zero-still-diff/d2-bikervest-usa__androgynous-front.png`).
- **c2, the hip bag (re-baked normals):** slightly different shading on the flap and strap clip, with no artifacts
  (`zero-still-diff/zoom-c2-hipbag-back-live-pilot.png`).
- **c1, the single-sleeve top (weights):** a few wrinkle highlights move along the sleeve, and it is clean.
- d1, the starter tee under the long coat: no visible change (the coat covers it).

### Still to do (cut off by the usage limit, 13 Nov)

- Idle, flex emote and Feminine-info sets: `run-captures.sh` was still running. Diff each with `diff-captures.py`
  and look at Masculine at full size.
- `functional-review.md`, then push the branch and open the PR (stacked on PR #38) with the checklist.
