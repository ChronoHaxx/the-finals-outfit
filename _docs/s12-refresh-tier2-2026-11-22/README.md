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
  12 tests.
- `refresh-route-census.py` (new): route stage per refused mesh and S12 items per stage through the item rule's
  fixpoint.
- `build-preview-index.py`: `settle()` (the fixpoint, shared), `--admit-surface`, `--admit-rework`,
  `--package-proof`, a material-slot guard. 17 tests.
- `scripts/shader-probe`: `package-hashes` mode (package bytes only, no mapping).
- `skin-by-name-proof.py`: 4 vs 8 influences is judged by weights ("influences"), not a loader refusal. 11 tests.
- `serve-preview.mjs`: finds the nearest `node_modules` (no junction); `--overlay` serves a worktree mirror of
  `public/`.

## Package proof: the 17 Nov game update (23 Nov)

The rebuilds come from the 6 Nov read of the 12.00 build. The game updated on 17 Nov, and there is no mapping for the
new build yet. The coordinator's condition (22 Nov, the same rule the user set for w177): use a 6 Nov read only where
the package is byte-identical in today's containers, and hold the rest.

- The 6 Nov read already recorded each package's sha256 (`s12-read/assets.json`, AssetExport hashes
  `GameFile.Read()`). The probe gains a `package-hashes` mode (`scripts/shader-probe/PackageHashes.cs`) that hashes
  the same bytes without loading the package, so the mapping is never used. It also hashes companion bulk files
  (`.ubulk`, `.uptnl`); **none of the 937 mesh packages has one**, so the package bytes are the whole mesh.
- Today's containers (32 mounted, 399,699 files, 23 Nov): **824 of 937 packages identical, 113 changed.**
  `SK_Sport_Glasses_M` has no package on either build. Per-mesh record: `package-proof-1117-v1.json` (`batchA` rows
  for the 113 of v5, `all` for every read mesh).
- `build-preview-index.py --package-proof` repoints only proven meshes. A stale mesh keeps its live file. In the
  item rule it still counts as Season 12 when its live file already has the read's body-type morphs (it is as
  consistent with its partners as before); otherwise it holds the items that show it. Tested in
  `test_a_package_changed_since_the_read_stays_live_and_holds_its_items`.
- A first build that treated every stale mesh as pre-S12 (v6) held 7 more meshes and fell to 1,181 items. That rule
  holds garments for no consistency gain, so v7 uses the narrower rule above.

Effect on batch A (v5 → **v7**): 113 → **105** garments, 1,422 → **1,411** items.
- Stale, so held: `SK_FromTencent_AsianSpiritGloves_M`, `SK_Historic_NeckCape_M`, `SK_Medieval_DragonSlayerSkirt_M`,
  `SK_Medieval_JesterNeckCape_M`, `SK_Medieval_JesterSkirt_M`.
- Held by their items, which show a stale mesh with changed morphs: `SK_Historic_MonkTop_M`,
  `SK_Medieval_JesterJacket_M`, `SK_Medieval_WizardPants_M`.
- Also stale among later-batch meshes: LongCoat, SkiMask, Tie, the Lunar bolero/cape/dress. Batch B and C must
  rerun the package proof, and C waits for a 17 Nov mapping anyway.

## Tier-1 batch 2

Tier 1's plan (step 7) left "the rest of tier 1" after the pilot. The coordinator handed it to this session on 22 Nov,
and batch A covers it on the active `3f64b2e6`. Of tier 1's 67 meshes:

| | Meshes |
|---|---:|
| pilot, live since 15 Nov (PR #52) | 8 |
| repointed by batch A v7 | 40 |
| admitted, held by the item rule | 10 |
| package changed on 17 Nov (LongCoat, AsianSpiritGloves, NeckCape, Tie) | 4 |
| held for batch B (masks): Cleats, SuitJacket, CordBelt, TechPants | 4 |
| held for a review defect: CropTopHoodie | 1 |

## Rebuild on a moved index

Git Bash, from the root checkout. Every step only reads the active index and refuses an existing output.

```bash
W=.claude/worktrees/angry-darwin-c51aab
O=$W/scripts/generated/s12-refresh-tier2-v1   # or the copied public/models/s12-refresh-tier2-v1
A=public/models/reconstructed-assemblies-v1
P=public/models/s12-bodytype-refresh-v1
N=v8    # a new suffix each time (v7 is the hand-off)
PY="/c/ProgramData/anaconda3/python.exe -X utf8 -I"
node $W/_docs/body-types-2026-11-06/scripts/morph-census.mjs $A/assets.json $O/morph-census-$N.json
$PY $W/scripts/body-types/morph-only-proof.py $A/assets.json $P/meshes $O/morph-only-proof-$N.json
$PY $W/scripts/body-types/skin-by-name-proof.py $A/assets.json $O/morph-only-proof-$N.json $P/meshes public/models/body/SK_Body_M.glb $O/skin-by-name-proof-$N.json
$PY $W/scripts/body-types/surface-match-proof.py $A/assets.json $O/skin-by-name-proof-$N.json $P/meshes public/models/body/SK_Body_M.glb $O/surface-match-proof-$N.json
$PY $W/scripts/body-types/build-preview-index.py $A/assets.json $O/morph-only-proof-$N.json $P/meshes $O/index-batchA-$N/assets.json \
    public/models/reconstructed-assembly-v2/customization.json --census $O/morph-census-$N.json --changed-only \
    --admit $O/skin-by-name-proof-$N.json --admit-surface $O/surface-match-proof-$N.json \
    --admit-only $(cat $O/batchA-admit-only-final.txt) --admit-reviewed $(cat $O/batchA-admit-reviewed-final.txt) \
    --admit-rework $(cat $O/batchA-admit-rework-final.txt) --package-proof $O/package-proof-$N.json
$PY $W/scripts/body-types/make-merge-patch.py $A/assets.json $O/index-batchA-$N/assets.json $O/merge-patch-batchA-$N.json
```

The package proof comes first, whenever the game may have updated since the last one (about a minute; the
probe build goes to an ignored folder; the FModel settings supply the archive key, which is never printed):

```bash
dotnet build $W/scripts/shader-probe -c Release -o $O/probe-bin
cat $W/_docs/body-types-s12-refresh-2026-11-06/s12-read/requests.json   # + requests-02.json, as one JSON list:
#   $O/package-hash-requests.json
dotnet $O/probe-bin/ShaderProbe.dll package-hashes "C:\Program Files (x86)\Steam\steamapps\common\The Finals\Discovery\Content\Paks" \
    <12.00 usmap, sha e5b29e28…; unused by this mode> <FModel .data/oodle-data-shared.dll> $(cygpath -w $O/package-hashes-$N) \
    $(cygpath -w $O/package-hash-requests.json) "$APPDATA\FModel\AppSettings.json"
$PY $W/scripts/body-types/package-proof.py $O/package-proof-$N.json $O/package-hashes-$N/package-hashes.json \
    $W/_docs/body-types-s12-refresh-2026-11-06/s12-read/assets.json \
    scripts/generated/shader-probe/s12-bodytype-refresh-v1/read-02/assets.json
```

v7 was built with `package-proof-1117-v1.json`, which an inline predecessor of `package-proof.py` wrote.
`package-proof-1117-v2.json`, from the script, has the same identical set (824 of 937).

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

### Batch B: per-mesh body masks regenerated (`run-masks.py`, `batchB-mask-compare.json`)

Each mask was regenerated from the live mesh and from the S12 mesh with `build-companion-masks.mjs`, and compared
with the published mask (texels set):
- Regenerating from the live mesh reproduces the published mask exactly (0 texels differ) for all 9 that produced a
  mask, so the generator is a valid reference.
- **S12 regeneration matches the live mask exactly for 8:** FrogShoes, AnubisMaskRegular, DiscoBotGloves, Cleats,
  SuitJacket, TechPants, DoubleHolsterPants, EmpressShoes. These can keep their published masks.
- `SK_Samurai_ClothTop_M`: 1 texel more hidden out of 550,436. Negligible, but it is a different file, so either
  admit it with the S12 mask or keep the published one and record why.
- `SK_Space_PioneerTechConsole_M` and `SK_Robots_CordBelt_M` first came out blank. The cause was the generator,
  not the masks. Each item shows two meshes. The report step hashes every mesh from this worktree's `public/`, where
  those files did not exist, so the run crashed after writing the first mesh's mask. After copying the GLBs the items
  need into the worktree's ignored `public/models`: **CordBelt 255 texels live and S12, 0 differ. PioneerTechConsole
  covers 0 texels in both**, and its published mask is empty too. Neither changes.
  (Shipping the S12 mask for the one-texel ClothTop: coordinator, 23 Nov, game-faithful.)
- Still to do: item masks (`run-item-masks.py`). SuitJacket's item mask is a w161 part-hide mask, a different
  system, and stays held. The builder also needs a path that admits a reworked or mask-stale mesh whose masks are
  proven unchanged.

### v7 (the hand-off), 23 Nov

Fresh captures of v7 on 5243 against live on 5241 (`captures-v7/`), for the guided checklist steps, the rework
outfits and footwear. Results, step by step, are in `functional-review.md`. In short:
- Androgynous matches live within noise everywhere, still and idle, the reworked bracelet and hood wrap included.
- Masculine: S12 garments slightly slimmer, layers on top, cross-slot hems as on live.
- Flex (the five outfits with reviewed weights, Masculine): clean. Earlier set: `TechCropTopNoBags` opens a small
  underarm slot in the raised-arm extreme (`captures/zoom/o04-flex-back-underarm-x3.png`); live opens a sliver
  there too, and idle is clean. Accepted as the S12 weights.
- **Footwear was out of frame** in every earlier camera (they frame head to thigh). `capture-review.mjs` gains
  `feet`, `feetback`, `feetside`, and the feet pass covers every footwear mesh admitted by review: FEETSUMMARY

### Found and fixed during the review

- **Material slot**: the first smoke shot threw "Missing source material slot: CombatPants_Cloth" (S12 moved the
  combat pants' cloth into a new slot). Fixed in the proof and the builder; the combat pants moved to batch C (its
  item skins would need S12 overrides for the new slot).
- **UV1**: CrystalHeadband and PopBraceletSet re-laid UV1 only; "same UVs" now needs every UV set. Both held.
- **Tile index**: several programs read `floor(uv0.x)`; tile-shift meshes moved to batch C.
