# Season 12 item refresh, tier 2 onward (22 Nov 2026)

Goal (user, 22 Nov: "do s12 clothing refresh"): refresh the garments Season 12 reworked so they fit the body they were
made for, continuing after tier 1 (PR #52, 9 meshes, 81 items). The plan is `PLAN.md`; the hand-off for the active
index is `APPLY.md`. This file records what was built, the review, and what is left.

## Files

| File | What |
|---|---|
| `PLAN.md` | inputs, census, route stages, batches A/B/C |
| `APPLY.md` | v10c (batch B + mask-only fixes for batch A): the merge recipe for a main-folder session, publish list, checks, rollback. Batch A v8 was applied on 23 Nov. |
| `replan.sh` | re-plan on whatever index is active: census, proofs, admission lists, build, patch (Git Bash) |
| `index-diff.py` | what changed between two `assets.json` files, by mesh and field (the index is one compact line now) |
| `review-outfits-batchA*.json` | the review outfits (13 + emote subset + 2 for the reworks) |
| `review-outfits-batchB.json` | batch B review outfits b01–b03 |
| `functional-review.md` | the guided checklist, run by the agent under the standing waiver |

Data (ignored, this worktree): `scripts/generated/s12-refresh-tier2-v1/` — proofs, census, indexes, patches, captures.
`APPLY.md` step 0 copies it to the root checkout's `public/models/s12-refresh-tier2-v1/`.

## Tools (`scripts/body-types/`)

- `surface-match-proof.py` (new): for "surface differs" meshes, permuted vs reworked; texture fit; material slots.
  12 tests.
- `refresh-route-census.py` (new): route stage per refused mesh and S12 items per stage through the item rule's
  fixpoint.
- `build-preview-index.py`: `settle()` (the fixpoint, shared), `--admit-surface`, `--admit-rework`,
  `--package-proof`, a material-slot guard; `--mask-proof` and `--ship-s12-masks` (v10, below). 19 tests.
- `package-proof.py` (new): per mesh, the package sha256 on 6 Nov and today.
- `mask-proof.py` (new): judges every mask that names a mesh from live and S12 regenerations (unchanged,
  body-changed, unproven).
- `make-merge-patch.py` / `apply-merge-patch.py`: carry and verify body mask repoints, with the mesh or mask only. The
  apply keeps the index's own format (2-space CRLF or compact). 11 apply tests.
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

Effect on batch A (v5 → v7): 113 → 105 garments, 1,422 → 1,411 items. (v8 then holds the PopGoth shoes after the
feet review: 104 garments, 1,410 items.)
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
| repointed by batch A v8 | 40 |
| admitted, held by the item rule | 10 |
| package changed on 17 Nov (LongCoat, AsianSpiritGloves, NeckCape, Tie) | 4 |
| held for batch B (masks): Cleats, SuitJacket, CordBelt, TechPants | 4 |
| held for a review defect: CropTopHoodie | 1 |

## Rebuild on a moved index

Git Bash, from the root checkout: `bash $W/_docs/s12-refresh-tier2-2026-11-22/replan.sh SUFFIX` (a new suffix
each time; v10c is the current hand-off). Every step only reads the active index and refuses an existing output.
- It reruns the census and the three proofs (`morph-only`, `skin-by-name`, `surface-match`) on the active index.
  `PROOFS=<earlier suffix>` reuses them when the index has not moved.
- It keeps from the `v9-admit-*.txt` lists only the meshes the new morph-only proof still refuses. An applied mesh is
  live and drops out.
- It builds with the package proof, both mask proofs and `ship-masks-v9.txt`, then writes the merge patch.
- `O=` points it at the copied data folder (`public/models/s12-refresh-tier2-v1`). `TOOLS=` points at main's
  `scripts/body-types` once the v10 tools PR is merged.

Batch A's recipe (v8, applied) used the `batchA-admit-*` lists the same way, without the mask flags.

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
- **Item masks** (`run-item-masks.py`, `batchB-item-mask-compare.json`, 23 Nov): all 8 item masks that name a
  batch-B mesh (Cleats ×5 variants, TechPants, CordBelt, EmpressShoes, DoubleHolsterPants) regenerate identically
  from the live mesh (0 texels off the published mask) **and from the S12 mesh (0 texels differ)**. Two first timed
  out loading the harness while captures held the GPU, and passed on a rerun.
- So every batch-B mask is unchanged in S12 except ClothTop's one texel. SuitJacket's item mask is a w161 part-hide
  mask, a different system, and stays held. Next: a builder path that admits a mesh only when a mask proof shows
  every mask naming it unchanged (or, for ClothTop, repoints its mask), plus the package proof.

### v7 (the hand-off), 23 Nov

Fresh captures of v7 on 5243 against live on 5241 (`captures-v7/`), for the guided checklist steps, the rework
outfits and footwear. Results, step by step, are in `functional-review.md`. In short:
- Androgynous matches live within noise everywhere, still and idle, the reworked bracelet and hood wrap included.
- Masculine: S12 garments slightly slimmer, layers on top, cross-slot hems as on live.
- Flex (the five outfits with reviewed weights, Masculine): clean. Earlier set: `TechCropTopNoBags` opens a small
  underarm slot in the raised-arm extreme (`captures/zoom/o04-flex-back-underarm-x3.png`); live opens a sliver
  there too, and idle is clean. Accepted as the S12 weights.
- **Footwear was out of frame** in every earlier camera (they frame head to thigh). `capture-review.mjs` gains
  `feet`, `feetback`, `feetside`, and the feet pass covers every footwear mesh admitted by review. Tech, elf, wizard and Lunar boots and the Trentila overlay
  are clean. **`SK_Streetwear_PopGothShoes_M` is held**: its S12 weights stretch the lower lacing and eyelets
  (`captures/zoom/o03-feet-popgoth-andro-right.png`). Rebuilt without it as **v8, the hand-off: 104 garments,
  1,410 items**, built with the script-written `package-proof-1117-v2.json`.

### v9 → v10c: batch B and the batch-A mask fixes, on the Light index (23 Nov)

**Batch A's masks.** v8 admitted 13 masked meshes by review (weights or normals changed), but their masks were never
regenerated.
- Each was regenerated from its live and its S12 file (`run-masks-a.py`, `batchA-mask-compare-v2.json`,
  `mask-proof-batchA-v1.json`). The live regeneration reproduces every published mask.
- From S12, **8 are unchanged**: ElfBoots, KnightGlovesSpikesL, WizardBoots, WaistPouches, EasternDemonGauntlet,
  RobotWarriorTop, TechBoots, LunarBoots.
- **5 changed** (texels):

  | Garment | Texels |
  |---|---:|
  | Bandolier | 1 |
  | SciFi_Gloves | 10 |
  | CloudBag | 23 |
  | TechCropTop | 1,512 |
  | TechCropTopNoBags | 1,503 |

  The crop tops' changes are slivers at creases and the upper arm. None is badly off, so v8 stays with no rollback
  (coordinator, 23 Nov). The S12 masks ship as mask-only repoints, because the meshes are already their S12 files.
- Eight more review-admitted meshes carry masks that were never proven: DemonPants, JesterJacket,
  TacticalKnightBracers, ChainNecklace, CroppedTshirtOversize, PopLanyardArmbandLeft/Right and LunarDressTop. None was
  applied in v8; all still serve pre-S12 files on `425023bb`. They leave the admission lists until their masks are
  regenerated (`v9-admit-reviewed-with-unproven-masks.txt` keeps the old list).

**Builder gate** (`--mask-proof`, `--ship-s12-masks`). A review-admitted mesh that carries any mask needs a mask-proof
row for exactly its live and S12 files. The row must cover every mask the index names for that mesh now, and its
status must be either "unchanged", or "body-changed" with the mesh named in `--ship-s12-masks`. A mesh that is
already its S12 file gets a mask-only repoint. Tests:
- `test_a_masked_mesh_is_admitted_only_when_its_masks_are_proven_unchanged`;
- `test_a_changed_body_mask_ships_the_s12_mask_only_when_named`;
- the apply's mask and compact-format tests.

**The index moved.** The Light apply landed on top of v8: 63 `_L` meshes, and the index is now compact JSON
(`425023bb…`). `replan.sh` reran the census and proofs there as v10.
- A trailing newline in a list file dropped EmpressShoes. Fixed with `.strip()` and rebuilt as **v10c** from v10's
  proofs. (v10b is a duplicate run of the old script; ignore it.)
- v10c repoints 11 meshes and 6 masks (`APPLY.md`): patch `2fd127a1…`, expected result `b164180c…`, 16 mesh entries
  changed (`index-diff.py`).
- Cleats (9 items) and DoubleHolsterPants (1) are admitted but still held by the item rule: those items also show a
  pre-S12 mesh.

**Review** (`captures-v10/`). 5241 serves live `425023bb…` and 5245 serves v10c (`--live-body --overlay public` for the
new masks). Outfits b01–b03 (`review-outfits-batchB.json`) and the batch-A mask outfits o01–o06. Diffs are in
`*-diff/`, pairs looked at full size, zooms in `zoom/`.
- **Still, Androgynous:**
  - b01 and b03 are within noise.
  - b02 shows a one-pixel line along the alpha-cut outer edge of `SK_Samurai_WornCape_M`, which this patch does not
    touch. The cape loads the same file with the same morphs, and the joints it shares with ClothTop have identical
    bind poses in the live and S12 ClothTop. At 3× its outline is the same shape (`zoom/b02-front-cape-x3.png`), so
    the difference is sub-pixel. Accepted.
- **Idle, Masculine and Androgynous, with the feet cameras:**
  - TechPants, kneepads, the thigh pouch and the Pioneer upper shift slightly, cleanly.
  - Frog shoes are unchanged; Empress shoes change only at the opening.
  - DadJeans: sub-pixel shading over the whole jeans on Masculine (the S12 `medium_male`). The rolled hem and the
    pre-S12 cleats sit as on live (`b-idle-diff/b02…masculine-feet*`).
  - **CordBelt:** the cords hang straighter and closer together in idle (its S12 weights), with no stretching
    (`zoom/b02m-waist-jeans.png`).
  - ClothTop: sub-pixel shading only.
  - Androgynous b03 is identical; b02's feet are identical.
- **Flex, Masculine:** ClothTop's raised sleeves match by eye, including the underarm (`zoom/b02m-flex-sleeves.png`).
  The Pioneer upper, its console and the pants are clean.
- **Mask-only (`masks-idle-diff/`, o02–o06, idle, both body types, 40 shots):** no visible change. 5245 served the
  new mask files (hashes checked through the server).
  - o02 (SciFi gloves): the waist shots, which frame the hands, are pixel-identical. Front and side differ only by
    speckle on the Phantom mask's translucent visor, which is accumulation noise on a mesh the patch does not touch.
  - o03 (TechCropTop, CloudBag): at most 281 px of speckle at the gauntlet edge.
  - o04 (TechCropTopNoBags, Bandolier): pixel-identical.
  - o05 and o06 match within noise.

  The changed texels lie under the garments, where the skin is hidden either way.

### Found and fixed during the review

- **Material slot**: the first smoke shot threw "Missing source material slot: CombatPants_Cloth" (S12 moved the
  combat pants' cloth into a new slot). Fixed in the proof and the builder; the combat pants moved to batch C (its
  item skins would need S12 overrides for the new slot).
- **UV1**: CrystalHeadband and PopBraceletSet re-laid UV1 only; "same UVs" now needs every UV set. Both held.
- **Tile index**: several programs read `floor(uv0.x)`; tile-shift meshes moved to batch C.
