# Season 12 item refresh, tier 1: plan (12 Nov 2026)

Goal: every body-type mesh in an outfit comes from the same season, so that Feminine can be turned on after the S12 body
ships (user's order, 11-12 Nov: picker → refresh in tiers → S12 body → Feminine). Tier 1 = the refused meshes whose
**surface is unchanged** in Season 12 (same positions, indices, UVs, vertex colours and material slots).

Status: **piloted.** On 12 Nov the user answered the gate (section 7) with "You do all 8", so the agent ran the pilot;
see `README.md`. Nothing here touches the live index, the 5174 server or the live worktree.
Data (ignored, root checkout): `public/models/s12-refresh-tier1-v1/`.

## 1. Re-census on the current active index

Inputs, read-only, hashes pinned in `pinned-inputs.sha256`: `assets.json` `7678e698…` (11 Nov 20:16; it was
`5c36c6b6…` after the 6 Nov merge), `skin-pairs.json` `f15a73a2…` (unchanged), `supported-items.json` `0f71ea9f…`,
`customization.json` `cd44cf10…`.

| | 6 Nov (index-v4) | now |
|---|---:|---:|
| Indexed meshes | 1,460 | 1,517 |
| Body-type meshes (`medium_male`/`medium_female`) | 938 | 988 |
| Supported items | 2,876 | 2,953 |
| S12 throughout | 1,135 | 1,139 |
| Mixed | 885 | 941 |
| No body-type mesh | 856 | 873 |

- The morph-only proof rerun on the current index (`morph-only-proof-v3.json`) is unchanged: 695 morph-only and 242
  refused, with identical problems. No refused mesh was rebuilt by a later wave.
- **51 body-type meshes have no S12 read** (50 merged since 6 Nov, mostly the w170 cloth-sim batch, plus
  `SK_Sport_Glasses_M`). They count as pre-S12 here. If they were built from S12 sources, 25 more items are S12
  throughout. An offline read (`requests-03`, about a minute) settles it; tier 1 does not need it.

## 2. Tiers (213 blocking meshes; classes from `refusal-classes-v1.json`, still valid)

| Tier | Meshes | What S12 changed | Route |
|---|---:|---|---|
| 1 | 67 | skinning, normals, morph set or rest pose only | GLB swap after a rig-aware proof (this plan) |
| 2 | 127 | geometry or UVs (57 may be vertex re-orders) | rebuild with S12 sources and re-derive masks/materials |
| 3 | 19 | no pre-S12 copy | graft proof against the processed live GLB |

All 67 tier-1 meshes are plain builds of their pre-S12 source (`liveVsPrepatchSource` empty): there is no proxy
transfer, null-colour default or part-hide processing to carry over. Together they make **185 more items S12
throughout**.

## 3. What tier 1 really changes, in the rig we ship

`morph-only-proof.py` compares raw arrays. So it refuses a mesh whose joint list was re-ordered or extended, even when
every vertex keeps the same bones and weights. The rig binds by bone **name** (`rebindSourceSkeleton`,
`SourceSkeleton.ts`). The skeleton is driven by `public/models/body/SK_Body_M.glb`: 92 bones, the same names as the
source body. Every driver bone uses the **driver's** rest inverse, and only garment-only ("extension") bones keep the
mesh's own. Main plays an idle clip and emotes over the whole skeleton, so any weight change can show.

Classes (`tier1-classes-v2.json`), judged against the driver:

| Class | Meshes | Rendered change besides the S12 morph deltas |
|---|---:|---|
| A. re-encoded only | 42 | none: weights equal by bone name to ≤ 2/255 per vertex, normals and tangents ≤ 0.45°, rest-pose changes only on driver bones (which the rig overrides), the same influence layout and per-vertex sums |
| B. normals | 3 | shading: `Tie` (18°), `TwistedBraceletSet` (54°), `WranglerBandolier` (tangents 1.4°) |
| C. weights | 17 | deformation in idle and emotes. Large: `CropTopHoodie` 3,581 vertices, `SingleSleeveTop` 3,632, `TechPants` 2,379, `CordBelt` 1,943, `TechBoots` 1,524, `SciFi_Gloves` 1,472, `LongCoat` 275. Tiny (≤ 10/255 on ≤ 82 vertices): `WizardBoots`, `LunarBoots`, `JesterJacket`, `ElfBoots`, `HipBag` (HipBag also re-baked normals on 1,217 vertices, up to 122°) |
| D. morph set | 6 | `StarterSet_TShirt` and `SuitJacket` (also C) gain `shrink_under_vest`. `Customization.Shape.ShrinkWrap` is decoded and 19 vest definitions carry it, so the tee now shrinks under vests. `Racing_Helmet` (0.62 cm male / 0.81 female), `Cleats` (0.29/0.31), `KnightGlovesSpikesL` (0.24/0.22) lose both body-type morphs, and `PhantomMaskTranslucent` loses `medium_male` (0.02 cm). Production Masculine changes on those three |

Unlocks: A alone 121 items; A + D 144; A + the tiny weights 135; all 67, 185.

Checked and harmless:
- Every S12 skin resolves (no "no supported body ancestor" throw). The weighted extension bones are the same set as
  live (skirt, strap, bag and ear bones), with unchanged inverse binds. No `JOINTS_2`.
- Five S12 skins (TechGloves, TechPants, TechBoots, CyberBoots, TechCropTopArmPouch) have 96-97 joints, more than
  the body's 92. The bind-pose export poses the skinned mesh with the most bones (`OutfitExport.ts:472-478`). These
  skins hold all 92 driver bones, so posing them sets the shared bones exactly as the body would.
- None of the 67 appears in `attachmentFrames`, head wraps, skin pairs, face cosmetics or the own-weights list. The
  legacy `loadUnderLayer` and equip fallback use the mesh's own inverses, but they load catalogue URLs, not index URLs.

### Derived data each class invalidates

| Derived data | Keyed on | A | B | C | D |
|---|---|---|---|---|---|
| Per-mesh body mask (`bodyMaskUrl`, derived projection) | bind positions + UVs | valid | valid | valid | valid |
| Item masks (`itemBodyMasks`, 41 items touch tier 1) | occlusion in **both supported poses** | valid | valid | **stale**: CordBelt (dad-jeans item), TechPants | **re-run** where activation changed: Cleats (4 items), SuitJacket (1) |
| Material slots and bindings | slot names, UV0/UV1 | valid | valid | valid | valid |
| Head wraps, skin pairs, face cosmetics, attachment frames | heads, sockets | none reference tier 1 | | | |
| Proxy weight transfer / own-weights 18a | live weights | none in tier 1 | | | |
| Body-type census and item rule | morph names | | | | **changes**: 3 meshes stop being body-type meshes; rebuild the census after any merge |

## 4. Route

1. **Tool: `scripts/body-types/skin-by-name-proof.py`.** For each refused mesh with the same surface:
   - weights by joint name, ≤ 2/255 per vertex;
   - the same influence layout and per-vertex sums, and no `JOINTS_2`;
   - normals and tangents (including the w sign) ≤ 1°;
   - the morph names;
   - inverse binds only on weighted extension bones, against the driver body;
   - rebind resolvability.
   It outputs a class per mesh with the live and S12 hashes. Tests on synthetic GLBs: re-ordered joints pass, while a
   moved weight, a flipped normal, a changed extension bind and an unresolvable joint refuse.
2. **Index: `build-preview-index.py --admit ADMIT_JSON`.** Admitted meshes count as proven, so the item rule and its
   fixpoint run unchanged, and held morph-only meshes cascade in. Two fixes from the review:
   - an admitted mesh never joins `unchanged` and is never skipped by `--changed-only` (class D has empty
     `morphsChanged`);
   - the index records each admitted mesh's class and hashes.
   Class A is admitted by the proof; B, C and D only by name after review. The build fails if it swaps anything beyond
   the admitted meshes and the listed cascade. Tests are added to `test_build_preview_index.py`.
3. **Preview index** in `public/models/s12-refresh-tier1-v1/index-pilot/`, served by `serve-preview.mjs --live-body`
   on a free port, never 5174. `--live-body` because production keeps the pre-S12 body until stage 3.
4. **Pilot: 8 meshes, 79 items.**
   - A: Casual_Tshirt, TechGloves, VarsityJacket, Sweater, SniperPants;
   - D: StarterSet_TShirt;
   - C: LongCoat and HipBag (HipBag also has normals).
   - The pilot meshes change only body-type morphs, no fitting morphs.
5. **Review.**
   - **Objective check for class A:** in Androgynous (no body-type morph), an A swap must image-diff to zero against
     the live index on the same camera. Any difference is a proof bug.
   - **By eye at full size, for C/D and Masculine:**
     - cross-slot outfits: S12 lower × pre-S12 upper, and the reverse;
     - the StarterSet tee under a vest still held pre-S12 (`shrink_under_vest`);
     - Masculine and Androgynous (production), with Feminine for information only;
     - idle and one emote;
     - front, back and side, plus waist and both hands;
     - side by side against the live index on a second port.
6. **Hand-off.** A merge patch pinned to the then-active index, which the main session applies when idle. A PR with the
   tools, docs and the guided checklist. No merge without the user's checks or explicit waiver.
7. **Then the rest of tier 1** in one batch with the same tools: A (42) by proof, and B/C/D by reviewed admission. The
   two stale C item masks and the D masks are re-run through the usual preparer. Fallback for a C/B mesh the user
   rejects: transplant the S12 morph deltas into the live GLB. That file passes the existing proof, but it is a hybrid.

## 5. What production Masculine sees

Masculine is live, so the pilot changes it:
- the pilot meshes' `medium_male` deltas move up to 1.43 cm (SniperPants) and 1.36 cm (VarsityJacket); the T-shirt
  moves 0.001 cm;
- morph-only meshes released by the cascade move too (listed when the index is built);
- class D (later, not in the pilot) removes the helmet's 0.62 cm and the cleats' 0.29 cm `medium_male`.

Route review (6 Nov): the pre-S12 and S12 `medium_male` sculpts target the same body morph, so either fits the live
body. Production Masculine still gets its own review.

## 6. Plan review (Fable 5.2, thread 09138844, about $2.08)

Adopted:
- classify against the driver skeleton, not `SK_Body_M`;
- check influence layout, per-vertex sums, `JOINTS_2`, tangents and rebind throws;
- fix `--admit` for class D;
- check the export's most-bones pick and `attachmentFrames`;
- run the zero-diff check for class A;
- capture a tee under a held vest;
- keep the delta-transplant fallback.

Not adopted: grouping weights into the seven arm groups of the static idle pose. Main animates the whole skeleton
(`RigAnimator.ts`, emotes), so every weight change can show.

## 7. Hands-on option for the user (gate)

`SK_Casual_Tshirt_M` is the cheapest mesh to do by hand, and a good lesson. The proof says "bones and skin weights
changed", but the two files skin every vertex to the same bones with the same weights. S12 only inserted
`calf_l`/`calf_r` into the joint list, so every joint index shifted. In Blender the difference disappears, because
vertex groups are stored by name, which is exactly why the rig does not see it either.

Doing it teaches:
- what a skin is: the joint list, per-vertex indices and weights, and inverse bind matrices;
- why byte-different files can render the same;
- how to prove it.

Cost: an hour or two of the user's time. The pilot can wait for it, or proceed on the other 7 meshes meanwhile.
