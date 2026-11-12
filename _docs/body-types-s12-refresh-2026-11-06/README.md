# Season 12 body-type refresh: whole-catalogue batch (6 Nov 2026)

Stage 2 of `_docs/body-types-2026-11-06/` (sections 6 and 7). Goal: the body and every garment carry the Season 12
`medium_male` / `medium_female` morphs together, because a partial swap pokes through (stage 1 review).

**Status.** Built and agent-reviewed as a preview. Nothing is merged into the live worktree, pushed or published. User
checks are pending (`functional-review.md`).

**Update, 6 Nov evening.**
- The active index moved to `acdb9897…`, so the batch was rebuilt on it as `index-v4`: the same 179 repoints; the 14 new
  backfill meshes were already S12.
- A data-only, garments-only variant (`index-v4a`, 178 repoints, live body) renders pixel-identically to the full
  candidate on masculine. It is the recommended merge for production.
- Recipe, numbers and checks are in `HANDOFF.md` ("Current recipe"). The tables below describe the earlier `index-v3`
  build.

## Result in one table

| | Count |
|---|---:|
| Live source meshes carrying `medium_male` / `medium_female` (body included) | 924 |
| Read from the Season 12 paks | 923 (`SK_Sport_Glasses_M` is gone from S12) |
| Morph-only (safe swap) | 681: 287 with re-sculpted body-type morphs, 394 with identical morphs |
| Refused | 242: 199 reworked in S12, 11 live-derived, 32 with no pre-S12 copy |
| Shown with S12 morphs in the merge candidate (index-v3) | 602 of 924 |
| Repointed by the merge candidate | 179 (178 garments + the body) |
| Supported items S12 throughout | **1,123** of 2,821 |
| Supported items that stay mixed | **885** (605 only because they show a reworked mesh) |
| Supported items with no body-type mesh (hats, hair, statics) | 813 |

## How a body type works (the mechanism this batch moves)

A morph target is a per-vertex offset stored in the mesh: "move vertex 1,204 by (0.3, 1.1, 0.0) cm". The rig blends it
in by weight, so `medium_female` at weight 1 turns the bind shape into the feminine shape. The game activates the
body type's one morph **by name on every mesh that carries it**: the body, the head and every garment.

That is why a garment fits: Embark sculpts each garment's `medium_female` to follow the body's `medium_female`. A garment
only fits the body whose morph it was sculpted against. Season 12 re-sculpted the body's `medium_female` (chest up to
3.65 cm further out) and re-sculpted most garments to match. Mixing the two sculpts breaks the pairing:
- S12 body under a pre-S12 garment: the body's fuller chest sits where the garment expects the old chest. Body masks
  hide covered skin, so the visible damage is at **edges**: hems, waistbands, necklines and armholes, where skin meets
  the garment edge.
- S12 garment layered with a pre-S12 garment: the inner layer can grow through the outer one (stage 1: the S12
  undershirt bulged through the pre-S12 short dress).

The androgynous type activates no body-type morph, so it shows the bind shape, which Season 12 did not change.
Androgynous looks identical before and after this batch in every outfit reviewed.

Correction, made later on 6 Nov (`route-review-2026-11-06.md`): S12 also changed the body's `push_lower_torso` fitting
morph (0.79 cm). Fitting morphs apply in every body type, so the lower torso moves under the 148 items that activate it,
in androgynous too. It is not visible in the reviewed outfits.

## Steps and evidence

### 1. Inventory (read-only)

- `_docs/body-types-2026-11-06/scripts/morph-census.mjs` on the active index
  (`public/models/reconstructed-assemblies-v1/assets.json`, sha256 `ae2c1ac0…`, 5 Nov 23:55). The index was only read.
- `inventory/morph-census.json`: 1,406 indexed meshes (998 skeletal, 408 static); 924 carry a body-type morph
  (917 both, 2 only male, 5 only female), `SK_Body_M` included.

### 2. Read and rebuild (offline)

- Probe `assets` mode, installed paks, pinned 12.00 mapping (sha256 `e5b29e28…`), 31 containers / 394,892 files.
  Requests: `s12-read/requests.json`. Provenance: `s12-read/source-run.json`, `s12-read/assets.json`, `s12-read/probe.txt`.
- 923 of 924 read in about 3 minutes. `SK_Sport_Glasses_M` failed: "Expected one package; found 0". S12 has no
  package at that path. It is used by one item (`sport-helmet-metal-holtow`), which stays mixed.
- Raw records (2.3 GB, local only): `scripts/generated/shader-probe/s12-bodytype-refresh-v1/read-01/`.
- `scripts/shader-probe/build-meshes.py` (this branch's copy, no colour policy) into the new folder
  `public/models/s12-bodytype-refresh-v1/meshes/`: 923 GLBs, 926 MB, about 3 minutes.

### 3. Prove

`scripts/body-types/morph-only-proof.py` against the live GLB of every rebuilt mesh: `reports/morph-only-proof-v1.json`.
- **681 morph-only**: every vertex attribute, indices, material slots, skin joints, inverse binds and morph names match.
  The rebuild is the live mesh with S12 morph deltas, so every artefact built on the live mesh stays valid.
- **242 refused.**
- Tool fix: the proof crashed on a mesh whose vertex count changed (it subtracted morph arrays of different lengths).
  It now reports "vertex count differs" instead. The crashed run wrote nothing.
- Checked: all 112 multi-primitive meshes, live and rebuilt, share one vertex buffer and one set of morph targets.
  So the proof's primitive-0 morph comparison covers every primitive.

**Why a mesh was refused** (`scripts/body-types/classify-refusals.py`, `reports/refusal-classes-v1.json`). The proof
compares against the live GLB, and our pipeline changes some live GLBs after extraction. So each refused mesh's
**pre-S12 source** was rebuilt with the same builder, from the clean pre-patch extractions
(`scripts/generated/shader-probe/prepatch-source-index-v1`: October build first, then the two September builds). Then:
- **199 reworked in S12**: the S12 source differs from the pre-S12 source beyond morphs. For 195 of them, the live GLB
  is exactly a plain build of that pre-S12 source. Kinds of change: skin weights 154, normals 124, UVs 124, topology 99,
  positions 97, bones 51, vertex colour 38, morph set 13, rest pose 5.
- **11 live-derived**: the S12 source differs from the pre-S12 source only in morphs. The live GLB carries our own
  processing:
  - the null-colour default: 2 beards, faces 14/15/18, 2 mullets and the diving helmet;
  - the proxy weight transfer: poncho, Viking cloak and jester neck cape.
- **32 with no pre-S12 copy**: the cause is not decided. Most are weight-transfer or batch-01 meshes.

### 4. Index (item rule)

`scripts/body-types/build-preview-index.py`. The stage 1 rule: a garment mesh is swapped only when every supported item
that can show it on Medium is S12 throughout, computed to a fixpoint. Three additions, each covered by
`scripts/body-types/test_build_preview_index.py` (7 tests, pass):
1. **Only body-type meshes count** (`--census`). A mesh with no `medium_*` morph has the same shape in every body type,
   so it cannot make an item mixed. The census must describe exactly the index it is used with (same meshes, same
   URLs), or the tool refuses.
2. **Refused but already S12-shaped.** 29 refused meshes keep the same vertices as the S12 rebuild and none of their
   morph deltas changed. Their live GLB already carries the S12 body-type shape, so they keep their live file and do not
   hold anything. Their other S12 changes (weights, UVs, bones) still go to the refresh route.
3. **Root-cause reasons.** Once held, a mesh is itself pre-S12. It used to count itself and list every item that shows
   it as the reason. Now only other meshes count. The swap set is the same; the reasons name the real blocker. Example:
   the loose jeans are held because the lumberjack variant shows the reworked utility belt.

`--changed-only` makes the **merge candidate**. It repoints only the meshes whose morphs changed. The 317 swaps with
identical morphs would change nothing on screen and only add files to publish.

| Index | Repointed | Purpose |
|---|---:|---|
| `index-v1` | 465 | first build; reasons polluted, no kept-unchanged rule (superseded, kept) |
| `index-v2` | 496 | every proven mesh the rule allows (superseded, kept) |
| **`index-v3`** | **179** | **merge candidate**: changed meshes only; item coverage identical to v2 |

`index-v3/assets.json` differs from the active index in exactly the 179 mesh entries, the body's sha256 and the added
`s12BodyTypePreview` block. `index-v3/skin-pairs.json` has the same content as the active one (equal as JSON; only the byte formatting differs,
so keep the active file): no face head's morphs changed in
S12 (of the 32 face heads, 28 are morph-only with identical morphs and 4 are refused but kept unchanged: faces 14, 15,
18 and 30, whose live GLBs carry the null-colour default). `merge-patch-v1.json` lists every changed
entry with its old and new URL and sha256.

### 5. Coverage and hand-off

`scripts/body-types/refresh-coverage.py`: `reports/coverage-v2.json` (index-v3 is identical item by item).

Mixed items by what blocks them:

| Blocker | Items |
|---|---:|
| a mesh reworked in S12, shown by the item itself | 605 |
| held only (a mesh it shows is held because another item shows a reworked mesh) | 162 |
| held + reworked | 101 |
| no pre-S12 copy (± held, ± reworked) | 16 |
| not in the S12 paks (`SK_Sport_Glasses_M`) | 1 |

By slot, the upper body is hit hardest: 429 mixed against 168 S12. Lower body is 211 mixed against 190.

`refused-meshes.md` (from `reports/refused-handoff-v1.json`, `scripts/body-types/refused-handoff.py`) lists the 213
blocking meshes for the **S12 item refresh route**. Each row gives:
- the kind of change;
- the morph change in cm;
- how many items become S12 if that mesh alone were refreshed (cascades included).

The top five unlock 143 items between them (counted one at a time): `SK_Shirt_M` 47, basic tee 43, `SK_Casual_Tshirt_M` 20, `SK_Pants_M` 17, assault
pants 16. Some reworks are light: `SK_StarterSet_TShirt_M` only gained a morph, the varsity jacket only changed weights,
and `SK_Casual_LongHoodie_M` only changed an attribute set. None were hand-fixed.

**A lead for the refresh route** (`reports/reorder-check-v1.json`). 99 reworked meshes differ from their pre-S12
source in positions or topology. Of those:
- 57 have the same vertex count and the same set of (position, UV) pairs: S12 re-exported the same surface with its
  vertices in another order;
- 28 really changed shape or UVs;
- 14 changed vertex count.
A permutation-aware version of the morph-only proof could map S12 vertices back onto the live order, and turn many of
the 57 into plain morph swaps. Normals, weights and bones were not compared under permutation here.

### 6. Review

**Captures** (`scripts/body-types/capture-review.mjs`, local only and ignored). Each outfit was shot in masculine,
feminine and androgynous, on 5193 (live index) and 5194 (`index-v3`). Every outfit uses Face 01 and the tall canvas
sneakers.

| Folder | Outfits | Cameras | Shots | Console errors |
|---|---|---|---:|---:|
| `review-v1/` | a1–a7, b1–b5 | front, side, full, waist, back waist | 360 | 0 |
| `review-v1-masculine/` | a8 | front, side, full, waist, back waist | 30 | 0 |
| `review-v1-cross/` | c1–c3 | front, side, waist, back waist | 72 | 0 |

- Each shot's record lists the mesh files the page requested. The S12 server served the rebuilt file for exactly the
  swapped garments, and the live server served none.
- a5, a7 and b5 load no rebuilt garment, because their meshes' morphs did not change. Only the S12 body differs there.
- Every pair was read side by side at full size (`review-v1-pairs/`).

**Entirely-S12 outfits are clean in all three body types.**

| Outfit | Verdict |
|---|---|
| a1 tank top + tight jeans | clean |
| a2 crop hoodie + skirt shorts (with tights) | clean. A tights fleck at the back waistband is on live too. |
| a3 bare-shoulder sweater + gothic skirt | clean |
| a4 vest + pants with skirt (skirt and belt layers) | clean |
| a5 front-tie crop top + jean shorts | clean. A body-mask stair-step at the lower back flank is on live too. |
| a6 zip hoodie + tight jeans | clean |
| a7 demon corset + anime archer skirt | **better than live**. Live feminine shows the fishnet sleeve poking through the corset; S12 fits. No a7 garment changed, so the fix comes from the S12 body alone: live pairs S12-shaped garments with the old body. |
| a8 football hoodie + municipal pants | masculine changes (`medium_male` up to 2.55 cm and 1.81 cm) move together. Crop hem, belt and harness edges are clean in all three types. |

**Androgynous is unchanged.** Every outfit matches live, as expected: no morph is applied, and the bind shape did not
change in S12.

**Mixed outfits on feminine: 4 of 5 show a defect that live does not have.**

| Outfit | What stays pre-S12 | Defect on 5194 feminine |
|---|---|---|
| b1 basic tee + tight jeans | the tee (reworked) | none seen |
| b2 short dress + tight jeans | the dress | a thin light sliver and a dark fleck along the back hem |
| b3 tech crop top + tight jeans | the crop top | the S12 jeans belt cuts through the crop top's pink strap (front waist) |
| b4 zebra hoodie + tight jeans | the hoodie | the S12 jeans belt notches through the hoodie's rib hem |
| b5 tube top + short skirt | both garments | the S12 body's chest pokes through the tube top's neckline |

There are two mechanisms, and the item rule can only stop the first inside one item:
1. **Body under a pre-S12 garment** (b2, b5). The S12 body's fuller chest or hips sit where the old garment expects the
   old body. Only refreshing that garment fixes it.
2. **Cross-item layering** (b3, b4). Each item is consistent on its own, but the outfit mixes slots: an S12 waistband
   sits under or over a pre-S12 hem. The item rule decides per item, so it cannot see this. Items in different slots
   are chosen independently by the user.

On masculine, b1–b5 match live: the body's `medium_male` did not change, and neither did the tight jeans'.

**Cross-item layering on masculine** (c1–c3: pre-S12 tops over the S12 municipal pants, whose `medium_male` changed
1.81 cm). This is the production risk, because production shows masculine.

| Outfit | Masculine | Feminine | Androgynous |
|---|---|---|---|
| c1 zebra hoodie (pre-S12) over municipal pants | clean: rib hem over the waistband at the front, side and back | clean at the hem; harness strap ends exposed (below) | identical to live |
| c2 tech crop top (pre-S12) over municipal pants | clean: the pink strap rides over the S12 belt as on live | clean at the waist; strap ends exposed | identical to live |
| c3 basic tee (pre-S12) over municipal pants | clean: the untucked hem covers the waistband | clean: the S12 chest stays inside the tee, and the hem covers the waistband | identical to live |

- No masculine cross-item defect was found. The changed `medium_male` of the pants stays under every pre-S12 top
  tested.
- **Feminine, back waist: the harness strap ends show.** The two strap tops under the belt ledge now sit lower and
  show their cut ends (a light rim and a reddish sliver), where live tucks them behind the ledge.
  - The harness, belt and pants are one mesh, `SK_Municipal_Pants_M`, and that mesh is morph-only. So this is the
    pants' own S12 `medium_female` sculpt on unchanged geometry, not a mix of builds. It is probably how S12 looks in
    game.
  - It is minor and only shows at close range. Zoom: `review-v1-pairs/c1-feminine-waistback-zoom.png`.

**What this means for merging.**
- The batch fixes what it swaps, and it changes nothing in androgynous.
- It is **not shippable piecemeal for feminine**. 885 items stay mixed, and any outfit that layers an S12 item with a
  pre-S12 one can clip.
- Three ways forward (the user decides):
  1. **Wait** for the S12 item refresh route (`refused-meshes.md`), then ship one consistent set.
  2. **Outfit-level morph fallback.** Keep both morph sets and choose per outfit: the outfit gets S12 morphs, body
     included, only when every body-type mesh in it is S12. Otherwise the whole outfit uses today's live morphs, which
     is what live shows now. The morph-only proof makes this safe: each S12 file differs from its live file only in
     morph deltas, so the two sets fit the same mesh. It needs a rig change (load the second morph set, or a morph
     sidecar) and roughly doubles the swapped meshes' download. It is never worse than live, and it would also let all
     681 proven meshes count, not only the ones the item rule allows.
  3. **Masculine-only now.** Merge for production masculine and keep feminine behind the dev gate until 1 or 2. It
     rests on the masculine review above: 16 outfits (a1–a8, b1–b5, c1–c3), no new defect. Sixteen outfits are a
     sample.
     Production would still change shape for the 83 garments whose `medium_male` moved more than 0.1 cm.
- A second opinion and the agent's checks of it are in `route-review-2026-11-06.md`. It recommends route 2 made
  asymmetric: the fallback applies to `medium_female` only, and `medium_male` uses S12 per mesh, so route 2 contains
  route 3. That note also records that **the active index has moved** (`acdb9897…`), so `index-v3` and
  `merge-patch-v1.json` are stale.

## What merging this changes, and what it needs

These points are for the main session, which owns the live worktree and the active index.

1. **The body needs a URL decision.** The rig accepts a skin pair only on the preserved body path. `CharacterViewer.tsx`
   loads `models/reconstructed-meshes-v2/SK_Body_M.glb`, and every skin pair's `body.url` names it. The preview server
   answers that path with the S12 body. A real merge cannot do that, and overwriting the preserved file in place is
   ruled out. It needs an app change: load the source body from the index (`attachmentBody.url`), and point
   `attachmentBody.url` plus every skin pair's `body.url` at `../s12-bodytype-refresh-v1/meshes/SK_Body_M.glb`.
2. **Production changes, not only the dev gate.** Production shows masculine. 83 repointed garments change
   `medium_male` by more than 0.1 cm, 28 by more than 1 cm. The largest are the football hoodie (2.55 cm) and the
   municipal pants (1.81 cm). These are S12-correct, but every user sees them. The masculine body morph itself is unchanged.
3. **885 items stay mixed** until the refresh route handles the reworked meshes. On feminine, they show pre-S12
   garments on the S12 body (the review shows how that looks). On masculine they look as today, except the swapped
   garments above.
4. **Rebuild against the then-active index.** The batch was built on the active index at `ae2c1ac0…`. If anything
   merges first, rerun census → index → skin pairs → coverage on the new index. The tools refuse a stale census or a
   moved mesh, so nothing goes in silently. Commands are in `HANDOFF.md`.
5. **Publish size.** The 179 repointed GLBs come from a 926 MB folder of 923; only those 179 need publishing.

## Files

- `inventory/morph-census.json`: step 1.
- `s12-read/`: requests, live URLs, probe provenance.
- `reports/`: proof, refusal classes, coverage, hand-off ranking.
- `refused-meshes.md`: the hand-off list.
- `review-outfits.json`, `review-outfits-masculine.json`, `review-outfits-cross.json`: review outfits.
- `functional-review.md`: the user's guided checks.
- `HANDOFF.md`: merge steps for the main session.
- Local only (ignored): `review-v1/`, `review-v1-masculine/`, `review-v1-cross/`, `review-v1-pairs/`, raw reads,
  rebuilt meshes and indexes under `public/models/s12-bodytype-refresh-v1/`.
