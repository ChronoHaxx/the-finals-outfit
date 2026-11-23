# Season 12 item refresh, tier 2 onward: plan (22 Nov 2026)

Goal (user, 22 Nov: "do s12 clothing refresh"): every body-type mesh an outfit shows comes from Season 12, so garments
fit the body they were made for, and Feminine can follow. Tier 1 shipped 9 meshes (PR #52, 81 items). This plan covers
everything after it, most-worn first.

Status (23 Nov):
- **Batch A v8 was applied** (104 garments; main-folder session, `b4f28192…`), and the Light apply landed on top
  (`425023bb…`).
- **v10c is apply-ready** (`APPLY.md`), built on that index with `replan.sh`. It covers batch B (10 meshes, plus
  ClothTop with its S12 mask) and the 5 batch-A masks that S12 changed, as mask-only repoints. That gives 1,423 items
  Season 12 throughout.
- Held:
  - 8 batch-A review meshes whose masks were never regenerated (never applied; still live);
  - SuitJacket (a w161 part-hide mask);
  - CropTopHoodie and PopGothShoes (review defects);
  - stale packages.
- C waits for a 17 Nov mapping.
- Nothing here touches the active index, the main checkout or a host.

## 1. Inputs (pinned, read-only)

| Input | sha256 |
|---|---|
| active `reconstructed-assemblies-v1/assets.json` | `3f64b2e6…` (head-socket frames, 21 Nov; tier 1 = `431627fc`) |
| `skin-pairs.json` | `f15a73a2…` (unchanged) |
| `supported-items.json` | see `pinned-inputs.sha256` |
| `reconstructed-assembly-v2/customization.json` | `cd44cf10…` |
| driver body `models/body/SK_Body_M.glb` | `d2989808…` |
| S12 rebuilds `s12-bodytype-refresh-v1/meshes/` (938) | built 6 Nov from read-01/02 |

**The 17 Nov game update does not touch these.** Every S12 mesh here was read on 6 Nov from the 12.00 build with its
matching usmap (`scripts/generated/shader-probe/s12-bodytype-refresh-v1/read-01`, 923 meshes). No fresh read is
needed until batch C (section 5), which needs S12 textures.

Data (ignored): `scripts/generated/s12-refresh-tier2-v1/` in this worktree; the APPLY step copies it to the root
checkout's `public/models/s12-refresh-tier2-v1/` so that archiving this worktree loses nothing.

## 2. Census on the active index

The three proofs, rerun on `3f64b2e6`:

| Step | Tool | Result |
|---|---|---|
| raw arrays | `morph-only-proof.py` | 234 meshes still refused |
| as the rig renders (tier 1) | `skin-by-name-proof.py` | 38 re-encoded, 36 weights, 4 normals(+weights), 6 morph set(+weights), 7 loader refuses, **143 surface differs** |
| surface (new) | `surface-match-proof.py` (v3) | of the 143: **61 permuted** (same triangles, new vertex order; 1 of them also split a slot), 14 reworked with the same UVs, 6 UV0 tile shifts only, **59 UVs changed**, 3 moved too far to judge |

`surface-match-proof.py` (new):
- **Permuted**: every S12 vertex has a live twin with the same position and UVs (bit-equal after 1e-6 quantising), and
  the triangles match as multisets per material with the same winding. Then the S12 data is re-ordered into live order
  and the tier-1 checks run unchanged (normals, weights by joint name, morphs by name, extension binds, loader rules).
  A pure "permuted" mesh renders exactly like a morph-only swap.
- **Material slots** are compared as (material, slot name): the index binds materials by slot name. Found by the first
  smoke capture: S12 moved `SK_Military_CombatPants_M`'s cloth triangles into a new slot `CombatPants_Cloth` (same
  MI), and the viewer threw "Missing source material slot". It is now "permuted+material slots" (not admissible), and
  `build-preview-index.py` refuses any admitted GLB with a slot the index does not bind.
- **Reworked**: geometry distance both ways (S12 → live surface and back, cm), and **texture fit**: at the closest live
  surface point, does live UV0 equal S12 UV0 within 2 texels (of a 2048 map)? A seam vertex lies on two islands at
  distance 0, so the best UV among triangles tied for closest counts. Modulo whole tiles is reported separately.
  - "same UVs": ≥ 99.5% of S12 vertices fit → live textures still map; only geometry-derived data needs a re-run.
  - "UV0 tile shifts only": fits modulo whole UV tiles. Textures sample the same texels under wrap, but a material that
    reads the tile index would differ. **Checked 22 Nov: many do.** `floor(uv0.x)` routes prints and layers by tile in
    MI_Socks_Quarter_Wool_*, five PufferVest variants and the Halloween BikerJacketHoodie. A tile-shifted S12 mesh under
    a pre-S12 program shows the wrong print/layer there, so tile-shift meshes go with batch C (S12 materials) unless
    every program that can draw them ignores the tile.
  - "UVs changed": S12 re-unwrapped some islands, so S12 re-authored the textures too (e.g. `SK_Shirt_M`: positions
    identical, 11% of UV0 moved; `SK_Pants_M`: 1.6%).

## 3. Route stages and what they unlock (`refresh-route-census.py`, item rule of `build-preview-index.py`)

Items with body-type meshes: 2,080 of 2,953 supported. S12 throughout now: **1,220**. Totals run the item rule to its
fixpoint (`build-preview-index.settle`, shared by both tools): a morph-only mesh shared with an item that still shows a
pre-S12 mesh stays held, which couples items. (A first census that counted items independently said 1,385 → 2,037;
that is only an upper bound.)

| Stage | Meshes | Route | S12 items (cumulative) |
|---|---:|---|---:|
| now | | | 1,220 |
| A1 rest of tier 1 | 72 | GLB swap after the skin proof / review | 1,324 |
| A2 permuted | 52 | GLB swap after the surface proof / review | 1,440 |
| B reworked, same UVs / tile shifts | 18 | GLB swap + re-derived body mask + item masks | 1,464 |
| C reworked, UVs changed | 59 | also the S12 textures (fresh read, needs proof) | 1,782 |
| left | | 7 loader refusals, 51 body-type meshes with no S12 read, the coupling they cause | 298 |

Most-worn first inside each stage (items showing): A1 TrackSuitPants 14, HeistTorso 13, SkiPants 12, ShortDress 10,
CombatVest 10; A2 SniperBoots 11, DoubleHolsterPants 10, CombatPants 7, TacticalBandolier 7, MarineBoots 6;
B Socks_Quarter 21, SkiMask 11, BikerJacketHoodie 9, Socks_ThighHigh 8; C **Shirt 47, BasicTshirt 43, Streetwear
Hoodie 38**, Pants 18, AssaultPants 16. Stage C holds the biggest unlocks.

## 4. Batch A (A1 + A2): GLB swaps, no new data

Admission, as tier 1:
- by proof: tier-1 "re-encoded" and surface "permuted" (pure);
- by name after review: weights, normals, morph set, and permuted + those.

Held out of batch A, with the reason:
- **Derived data that the change makes stale** → batch B: item masks of meshes whose weights or morph set changed
  (Cleats, SuitJacket, TechPants, CordBelt, DoubleHolsterPants, EmpressShoes). Pure re-encoded / permuted meshes keep
  valid item masks (same bind geometry, same weights).
- **Live carries our own processing** (`liveVsPrepatchSource` not empty: null-colour default on heads, beards and mullet
  hair; proxy weight transfer on capes, poncho, scarf, cloak) → never swapped by this route.
- **Vertex colour changed** (AnubisJewelry, BountyHunterPants): only after checking that their programs ignore COLOR_0.
- **Loader refusals** (7: influence count 4 ↔ 8): need a layout-tolerant weight check first.
- **Morph removals that change production Masculine** (Racing_Helmet 0.62 cm, Cleats, KnightGlovesSpikesL,
  PhantomMaskTranslucent): S12 ships them, so the route includes them, but the patch lists them separately so the
  applier can drop them if the user says no.

`build-preview-index.py` gains `--admit-surface SURFACE_PROOF_JSON` (permuted admitted by proof; other surface classes
only by name; reworked never). Tests added.

Built (`index-batchA-v2`): 79 admitted by proof + 36 by review; **112 garments repointed** (83 admitted, 29 morph-only
meshes the admissions release); 32 admitted meshes stay held by the item rule. **1,428 items S12 throughout (+208).**
New morphs on admitted meshes (`shrink_under_vest`, `bandolier_squeeze`, `cloth_weights`) all default to 0.

Review (as tier 1, `capture-review.mjs`, preview servers on free ports, never 5174):
- Androgynous still pose: proof-admitted swaps must match live within the noise floor (any difference is a proof bug).
- By eye at full size: Masculine and Androgynous, idle and one emote, front/back/side, waist and hands; cross-slot
  outfits (S12 lower × pre-S12 upper and back); Feminine for information only.

## 5. Batch B and C

**B (22 meshes + the 6 held)**: swap the GLB and re-derive what is keyed on geometry:
- per-mesh body mask (`bodyMaskUrl`, derived projection, `build-companion-masks.mjs` against a served preview);
- item masks that name the mesh (`itemBodyMasks`), in both supported poses;
- tile shifts: read each program for tile-index use first.
The generator lives in the root checkout's pipeline (`scripts/shader-probe`), so this batch uses the w177 workaround:
snapshot what it needs into this branch, run it from the root with outputs here, and hand the apply to a main-folder
session.

**C (58 meshes)**: S12 changed the UV layout, so the live textures do not fit. Needs, per item showing the mesh, the S12
material instances and textures. A fresh read is on the 17 Nov build (12.03, CL-1460914), where the 12.00 usmap can
misread silently. Route:
1. wait for the 17 Nov usmap (the coordinator is fetching it), or
2. prove each read: a texture is proven when the islands that did not move are pixel-identical to the live texture and
   its size/format match; a material instance when every parameter except the changed textures equals the live JSON.
Hold C until one of those holds.

Read scope (`batchC-read-scope-v1.json`, 22 Nov): 73 meshes (UVs changed, UV sets differ, UV1 changed, tile shifts,
the combat pants' new slot, 3 moved too far to judge), shown by 358 items, drawing 344 material instances and 715
garment-specific textures (shared material-library textures excluded). Biggest: `SK_Shirt_M` 47 items / 9 textures,
`SK_Casual_BasicTshirt_M` 43 / 58, `SK_Streetwear_Hoodie_M` 38 / 24. The read also needs the S12 item definitions
(DA) for slot overrides such as `CombatPants_Cloth`.

## 5b. Coordinator conditions (22 Nov, answering for the user)

- **Package proof before apply (blocks batch A apply-ready):** a 6 Nov 12.00 read may be used only for a mesh whose
  package is byte-identical between the 6 Nov read and today's 17 Nov containers. A package-bytes compare needs no
  usmap. Any mesh that differs moves to the held set with the re-unwrapped garments. Record the proof per mesh in the
  README. Same rule as w177 ("Use proven pre-update files"); tool precedent `prove-prepatch.py` (w177,
  `prepatch-proof-v1.json`). Not done yet. First check that the read-01 export kept each mesh's raw `.uasset`/`.uexp`.
- **Morph removals:** include all four (Racing_Helmet, Cleats, KnightGlovesSpikesL, PhantomMaskTranslucent), as a
  separately droppable list.
- **Tier-1 "batch 2":** taken over from the idle tier-1 session. Rebuild it on active `3f64b2e6`. First check whether
  stage A1 here already covers its meshes.
- Order: build A, then B. C waits for the 17 Nov usmap or a per-texture proof.

## 6. Hand-off

Per batch: a merge patch pinned to the then-active index, a publish list (GLBs under `s12-bodytype-refresh-v1/meshes/`,
like tier 1) and an `APPLY.md` for a main-folder session. Uploads and the index apply are coordinator approvals, one
line each with plan and rollback. Code/tools PR merges on agent pass under the standing waiver.
