# Proof 3′ run on the active index (26 Nov 2026): patch ready, not applied

**Asked by:** the coordinator, 26 Nov. After #108 merged (`19ee6bd`), run the builder with `--same-surface-permuted` on
the active index `e7cd0b2f` as one patch, with the delta check, captures and shas.

**Rules:** the standing rules plus proof 3′ exactly as merged. The coordinator's review is recorded in #108. Nothing
here wrote `public/models` or the active index.

## Build

```
M=scripts/generated/archetypes   # in the main checkout
python -I scripts/archetypes/build-archetype-index.py --staging $M/light-bulk-v2 --live-equal-medium \
    --same-surface-permuted --proven $M/light-bulk-v2/inputs/nov17-proof-v1.json \
    --out $M/proof3prime-build --publish-dir reconstructed-archetypes-v1
```

Print line: `{"light": 100, "heavy": 0} class meshes; 298 refused; 1764 skipped; classes: ['light']`.

The output is byte-identical to the pre-merge dry run on the same index (assets and publish list).

## Patch pins

| Pin | sha256 |
| --- | --- |
| Active `assets.json` (reviewed; copy kept as `scripts/generated/archetypes/proof3prime-build/reviewed-active.json`) | `e7cd0b2fb0c2e5e4845fd9094a5873518ca5c807e4634327535e58795e4ccfd2` |
| Active `skin-pairs.json`: keep it, never copy the build's re-serialized `4d167fb8…` | `f15a73a2a5dfc2f61c3bbd20bf1ea4b9c9e735a64f856ba12310f1e50e1c00a4` |
| Result `proof3prime-build/assets.json` | `9f5dd6d20cb10ba8072e0e1ed2e784299233ab1dcd206b27d9d42e33142c3adb` |
| `proof3prime-build/publish-list.tsv` (100 rows) | `0267310af4ec77614f1cdae013a41d1463851225b9cd3a866d5ce2bc9c6370f6` |
| Run record `light-bulk-v2/run.json` | `3a3cc3f47f27d59ad69300f2c04045deac5d924ba163f48cc6edbc16eeb54213` |
| 17 Nov proof `light-bulk-v2/inputs/nov17-proof-v1.json` | `6406580f9ebb433936f0629a0d7157e412a9a1e40061ec1a9bd5c1e8055d8615` |

**The change** (`delta.json`, `compare-apply-delta.py`):
- **Meshes:** 100 new Light entries. All are skeletal, all served from `reconstructed-archetypes-v1/meshes/`, and 51
  carry their Medium's `bodyMaskUrl`.
- **Item masks:** 26 items gain Light keys in `itemBodyMasks`. Each points at its Medium's existing mask file, so no
  new mask files.
- **Totals:** 605 added leaves, nothing altered or removed.
- **Unchanged:** the `archetypes` record and the top-level keys.

**Apply:** as [APPLY.md](../APPLY.md) "Bulk apply", with these pins. `M=scripts/generated/archetypes`.
1. Rebuild with the same command and `--out $M/proof3prime-apply`.
2. Run `compare-apply-delta.py $M/proof3prime-build/reviewed-active.json $M/proof3prime-build/assets.json <active>
   $M/proof3prime-apply/assets.json`. It must print `"ok": true` with `meshesAdded: 100`.
3. The publish list must equal `0267310a…`.
4. Copy the 100 meshes, check their hashes, write the index and record it.

## What proof 3′ decided (Light)

[proof3-prime.tsv](proof3-prime.tsv) lists every attempt, of both classes. For Light, 191 attempts reached proof 3′:

| Verdict | Rows |
| --- | ---: |
| **pass** | **104** |
| weights differ by joint name under the mapping | 33 |
| joints listed on one side only are not body-skeleton bones | 13 |
| normals differ under the mapping | 12 |
| no vertex bijection on UV0 | 11 |
| positions are not the ×0.85 Medium's under the mapping | 10 (the T-shirt among them: 3.10 mm) |
| UV sets or indices missing or differ in number | 5 |
| a flipped quad is not planar | 3 (CatEars at 0.108 mm, kept strict) |

No Light attempt was named in a side registry.

**Of the 104 passes, 100 are added.** The other 4 pass proof 3′ but fail currency, with "not current in the 17 Nov
containers: no proof row":
- `SK_Casual_HeadPhonesAntennaPart_L`
- `SK_Casual_HippieNecklaceChainLong_L`
- `SK_Racing_Gloves_L`: the Alliance fencer's gloves
- `SK_Sport_ClimbingBandolier_L`

They come from the 18 Oct staging, and the 17 Nov proof has no row for their packages. A fresh read of those 4 (and
their Mediums) makes them current, the way b10 did for the starter rows. The coordinator approved that on 26 Nov as a
separate follow-up patch (see "Next"), so this patch keeps its shas.

**Among the added rows:**
- **Re-triangulated:** 21 rows.
  - The largest share is 0.75% of a mesh's triangles: SpaceBeltUltimate, 32 triangles.
  - The largest diagonal gap is 0.056 mm (SkeletalFingers), against the 0.1 mm rule.
- **UV1 differences:** 2 rows, AnubisMaskRegular_L (0.00098) and HoodWrap_L (0.00049).

### Rows that passed only through the position tie-break

As asked: [tiebreak.tsv](tiebreak.tsv), made by [tiebreak.py](tiebreak.py) from `report.json`.
- **Where the position decides:** where several vertices share one exact UV0 at different positions (mirrored
  islands), the pairing among them is decided by position.
- **Why that can't admit a wrong pair:** every pair is then re-verified on positions, normals, all UV sets and weights
  by joint name.
- **Light:** 36 of the 104 passes, 35 of them added. ClimbingBandolier is the one not added.
- **Heavy:** 37 (not added: no Heavy body).
- **Largest:** ChristmasLights_L (1,692 tied vertices) and SkeletonWarriorTorso_L (1,499).

Light rows decided by the tie-break:
- AcePilotTop, AnubisMaskRegular, AstronautHelmet, BandolierCowboy, BellSleeves
- ChristmasLights, ConicalHatSciFi, DragonSlayerTorso, EngimoJacketHologram02, LooseJacket
- MilitaryDress, MuscleSuitUpper, Municipal_Torso_l, NRHarness, OpenJacket
- OpenTop, PaddedPants, RancheroHolster, RobotWarriorLegs, RoyalTop
- SciFiKnightTop, ScallywagPants, ShinobiJacket, SkeletonWarriorTorso, SniperBoots
- SpaceBracersUltimate, SpaceHeroineTop, SpaceSuitTopUltimate, TacticalBandolier, TacticalHarness
- TacticalTrousersNoPouch, TacticalVestMagBandolier, UpperBody02, WitchDressTop, CroppedPufferJacket
- ClimbingBandolier (not added)

## Which items the patch makes buildable on Light

[items_on_light.py](items_on_light.py) applies the viewer's mesh rule (`OutfitPass.ts` `classUnavailableItems`) to the
item definitions: every part must resolve, under the Light tag, to a mesh the index holds. Table:
[items-on-light.tsv](items-on-light.tsv). The captures are the viewer's own answer; this is a census.
- **148 items newly build on Light.**
- **77 of the 100 new meshes appear in at least one of them.**
- **23 meshes are inert for now:** every item that uses them still lacks another Light mesh. They change nothing
  visible until those parts join. The 23:
  - ChristmasLights; NRHarness; VikingTrinkets, VikingTunic; HoltowPantsHologram
  - KnightLeftPauldronUltimate, KnightNeckCloth; RoyalTop; SkeletonWarriorBracers, SkeletonWarriorTorso; TechKnightTorso
  - DedeHeadphones; TacticalHarness, TacticalVestMagBandolier, TacticalVestSeparated; MuscleSuitUpperNoSleeves
  - SpaceBelt(Ultimate), SpaceBracers(Ultimate), SpaceGorget, SpaceSuitTop(Ultimate)

## Captures (unapplied patch, viewed through a read-only overlay)

[capture.mjs](capture.mjs):
- **Setup:** the app runs from a worktree. A read-only overlay server answers for the main checkout's `public/`, except
  the patched `assets.json` (`9f5dd6d2…`) and the 100 new meshes. Edge headless, `archetypes=on`, 1500×1100.
- **What each shot is:** the starting outfit with one item swapped in, on Light and on Medium.
- **Where the files are:** the PNGs are local in `scripts/generated/archetypes/proof3prime-build/captures-run2/` and
  `captures-standins/`. Light|Medium pairs at native pixels are in `pairs-run2/` and `pairs-standins/`.
- **The first, partial run** stopped at a usage limit. It was discarded and rerun from scratch.

**First pass (52 shots, 0 console errors except one):** the KnightNeckCloth Light head shot logged one
`ERR_CONNECTION_REFUSED`, from a host outside the overlay. It rendered normally, as in the starter captures.

| Row | Why it was picked | Light, read at full size against Medium |
| --- | --- | --- |
| T-shirt (refused) | the refused row | Left off on Light ("Not on Light yet: SPECTATOR STANDARD"), so the torso is bare. Jeans and sneakers are in place. As expected. |
| ElegantKnightHood (front, head side) | re-triangulated, 6 triangles | The same hood, chainmail, plate, gold trim, belts and "32" pauldron print. No gaps at the neck or face opening. |
| RancheroJacket (front, back) | re-triangulated, 12 | The same fringe, yoke, buttons, pockets, cuffs and neckerchief. Nothing pokes through. |
| ConsoleBackpack (back, side) | re-triangulated, 4 | The same screen, D-pad, buttons and logo. On Light it sits on the bare back (the T-shirt is off), with the strap resting on the skin. |
| AcePilotTop (front, back) | position tie-break, 34 vertices | The same harness, shoulder pads with "3", sleeve stripes and shirt print. |
| AviatorJacket (front, back) | reorder only | The same jacket, collar, knit hem and cuffs. |
| AnubisMaskRegular (head, head side) | UV1 within 0.00098; tie-break | The same gold trim, turquoise studs and cobra. The neck fabric ends cleanly on the shoulders, with no hole or hidden-skin edge. |
| HoodWrap (head, head side) | UV1 within 0.00049 | The same "32", face mask and drawstrings. The hem rests on the shoulders, with no hole at the neck. |
| SpaceBeltUltimate, SkeletonWarriorTorso, ChristmasLights, KnightNeckCloth, VikingTunic | sampled | **Not visible:** each item still lacks another Light mesh, so the viewer leaves the whole item off on Light (bare torso, notice names the item). These are among the 23 inert meshes above, so the second pass replaced them. |

**Second pass, stand-ins** (`node capture.mjs <out> standins`, 24 shots, 0 console errors). Every item is shown on
Light; only the T-shirt is left off.

| Row | Why it was picked | Light, read at full size against Medium |
| --- | --- | --- |
| RobotWarriorLegs (front, back) | re-triangulated, 12; tie-break, 58 | The same "32" and logo print on the front panel, knee pads and belt. |
| WitchDressTop (front, back) | tie-break, 756 mirrored vertices (the largest added) | The lacing, bow, both rose clusters, bat wings, choker, gloves, back halter bow and straps are all in place and symmetric. No smearing from a mis-paired mirror. |
| MilitaryDress (front, side) | tie-break, 51 | The same bow, buttons, piping, shoulder strap, side bows and tulle. |
| RancheroHolster, in BasicChaps (front, side) | tie-break, 75 | The same holster, bullet belt, buckle and "32" on the chaps. |
| CroppedPufferJacket (front, back) | re-triangulated, 4; tie-break, 28 | The same puffer, zip, tag and corset underneath. |
| HalfFingerGloves (front, side) | re-triangulated, 4 | The same fingerless cut-outs on both hands. |

**Verdict:** no material, UV or skin regression on any visible row:
- the re-triangulated, tie-break and UV1 rows all render as their Medium does, scaled;
- the refused T-shirt and the inert items are left off on Light, as the viewer's rule says.

## Next

1. **The apply, through the main-folder session,** with the pins above. It is not routed until the coordinator says so.
2. **The 4 passes that are not current:** a fresh 17 Nov read of just those packages (request
   `light-fixwave-plan/requests/b11.json`, 12 packages, `8cc4d673…`).
   - It goes into a new run folder with its own control, so `light-bulk-v2/run.json` (`3a3cc3f4…`) and this patch's
     shas stay as they are.
   - Then a small follow-up patch after this one applies.
3. **The T-shirt_L reshaped route:** a code PR, as approved on 26 Nov.
