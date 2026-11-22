# Season 12 item refresh, tier 2 onward (22 Nov 2026)

Goal (user, 22 Nov: "do s12 clothing refresh"): refresh the garments Season 12 reworked so they fit the body they were
made for, continuing after tier 1 (PR #52, 9 meshes, 81 items). The plan is `PLAN.md`; the hand-off for the active
index is `APPLY.md`. This file records what was built, the review, and what is left.

## Files

| File | What |
|---|---|
| `PLAN.md` | inputs, census, route stages, batches A/B/C |
| `APPLY.md` | batch A: the merge recipe for a main-folder session, publish list, checks, rollback |
| `review-outfits-batchA*.json` | the review outfits (13 + emote subset + 2 for the reworks) |
| `functional-review.md` | the guided checklist, run by the agent under the standing waiver |

Data (ignored, this worktree): `scripts/generated/s12-refresh-tier2-v1/` — proofs, census, indexes, patches, captures.
`APPLY.md` step 0 copies it to the root checkout's `public/models/s12-refresh-tier2-v1/`.

## Tools (`scripts/body-types/`)

- `surface-match-proof.py` (new): for "surface differs" meshes, permuted vs reworked; texture fit; material slots.
  11 tests.
- `refresh-route-census.py` (new): route stage per refused mesh and S12 items per stage through the item rule's
  fixpoint.
- `build-preview-index.py`: `settle()` (the fixpoint, shared), `--admit-surface`, `--admit-rework`, a material-slot
  guard. 16 tests.
- `skin-by-name-proof.py`: 4 vs 8 influences is judged by weights ("influences"), not a loader refusal. 11 tests.
- `serve-preview.mjs`: finds the nearest `node_modules` (no junction); `--overlay` serves a worktree mirror of
  `public/`.

## Rebuild on a moved index

Git Bash, from the root checkout. Every step only reads the active index and refuses an existing output.

```bash
W=.claude/worktrees/angry-darwin-c51aab
O=$W/scripts/generated/s12-refresh-tier2-v1   # or the copied public/models/s12-refresh-tier2-v1
A=public/models/reconstructed-assemblies-v1
P=public/models/s12-bodytype-refresh-v1
N=v5    # a new suffix each time
PY="/c/ProgramData/anaconda3/python.exe -X utf8 -I"
node $W/_docs/body-types-2026-11-06/scripts/morph-census.mjs $A/assets.json $O/morph-census-$N.json
$PY $W/scripts/body-types/morph-only-proof.py $A/assets.json $P/meshes $O/morph-only-proof-$N.json
$PY $W/scripts/body-types/skin-by-name-proof.py $A/assets.json $O/morph-only-proof-$N.json $P/meshes public/models/body/SK_Body_M.glb $O/skin-by-name-proof-$N.json
$PY $W/scripts/body-types/surface-match-proof.py $A/assets.json $O/skin-by-name-proof-$N.json $P/meshes public/models/body/SK_Body_M.glb $O/surface-match-proof-$N.json
$PY $W/scripts/body-types/build-preview-index.py $A/assets.json $O/morph-only-proof-$N.json $P/meshes $O/index-batchA-$N/assets.json \
    public/models/reconstructed-assembly-v2/customization.json --census $O/morph-census-$N.json --changed-only \
    --admit $O/skin-by-name-proof-$N.json --admit-surface $O/surface-match-proof-$N.json \
    --admit-only $(cat $O/batchA-admit-only-final.txt) --admit-reviewed $(cat $O/batchA-admit-reviewed-final.txt) \
    --admit-rework $(cat $O/batchA-admit-rework-final.txt)
$PY $W/scripts/body-types/make-merge-patch.py $A/assets.json $O/index-batchA-$N/assets.json $O/merge-patch-batchA-$N.json
```

The anaconda Python is required (`python` in Git Bash is 3.7). Run Python from the root checkout so data paths
resolve there; Git Bash converts `/e/...` arguments for native programs, but not paths inside `-c` strings.

## Review (batch A)

Servers (this worktree's code, never 5174): 5241 live index, 5242 the batch-A merged index (`--live-body`, as the
garments-only merge). Captures: `scripts/generated/s12-refresh-tier2-v1/captures/`; diffs with `diff-captures.py`,
then the pair images looked at full size.

Sets: still pose Androgynous (front, back, side; `anim=0&sway=0`), idle Masculine + Androgynous (front, back,
sideleft, waist; `anim=outfit-idle&animTime=6`), the Flex emote on the five outfits with reviewed weights (Masculine,
`anim=flex&animTime=3`), Feminine idle for information, and a repeat of live for the noise floor.

### Still pose, Androgynous (39 shots per server, 0 console errors)

- **10 of 13 outfits match live within noise** (≤ 150 px, max level ≤ 7): every proof-admitted swap (re-encoded,
  permuted) renders as live, which confirms the two proofs. (`still-diff/`)
- o02, o03 and o04 differ where the reviewed skinning changed: the tech crop tops' sleeves (9,280 / 7,368 vertices
  reweighted), the crop hoodie, the twisted bracelet's shading (normals up to 54°). Looked at full size:
  - tech crop tops (o03 side, o04 back): different wrinkle shading, clean;
  - **crop hoodie (`SK_Streetwear_CropTopHoodie_M`, 3,581 vertices reweighted): a stretched, smeared wedge of
    triangles at the underarm in our pose** (`zoom/o02-side-underarm.png`). Held out of batch A.

### Idle, Masculine and Androgynous

- Androgynous idle o01 matches live (≤ 150 px).
- Full idle set (104 shots, `idle-diff/`): Androgynous o01 and o05–x13 match live within noise (max level ≤ 22, small
  spots). Androgynous o02–o04 differ across the torso where the reviewed skinning changed. Looked at o03 front at
  full size: the S12 tech crop top's sleeves fold a little differently, and the pink belt and holster pouch sit
  slightly differently. Clean, with no spikes or tears. Masculine differs everywhere S12 garments re-sculpted
  `medium_male`, which is expected. Pairs still to look at: o02/o04 Androgynous, Masculine o04–x13.
- Masculine changes where S12 re-sculpted `medium_male` (expected): o01 the rain jacket is slightly slimmer, harness,
  pouches and belt stay on top; o02 hoodie and Dede tights; o03 waist pouches and the cloud bag sit slightly
  differently. No clipping, no poke-through. (`idle-part-diff/`)

### Flex emote (Masculine)

- o03: the S12 tech crop top folds slightly differently under the raised arms and stays clean
  (`zoom/o03-flex-shoulders.png`).

### Found and fixed during the review

- **Material slot**: the first smoke shot threw "Missing source material slot: CombatPants_Cloth" (S12 moved the
  combat pants' cloth into a new slot). Fixed in the proof and the builder; the combat pants moved to batch C (its
  item skins would need S12 overrides for the new slot).
- **UV1**: CrystalHeadband and PopBraceletSet re-laid UV1 only; "same UVs" now needs every UV set. Both held.
- **Tile index**: several programs read `floor(uv0.x)`; tile-shift meshes moved to batch C.
