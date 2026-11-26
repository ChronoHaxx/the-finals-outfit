# SK_Casual_BasicTshirt_L through a reshaped route: plan (26 Nov 2026), for the coordinator

**Asked by:** the coordinator, 26 Nov. Admit the Light T-shirt, the last missing piece of the starting outfit on Light,
with its own body mask from the Light mesh, gated as the fix-wave rows are. Send its shas separately so it can apply on
its own.

**Status:** approved on all five points (26 Nov). The code, dry runs and captures are in [README.md](README.md), which
also records one correction: the Medium mask's policy is not the conservative shared-UV one, so it is proved by a
check run. Nothing is applied, and nothing here writes `public/models`.

## What the Light T-shirt is (measured read-only, 26 Nov)

The b10 GLB `57db5442…` against the live Medium `47ccc034…`, which is byte-identical to the b10 Medium. Vertices are
matched by UV0. Scripts: `tshirt_l_shape.py`, `tshirt_l_quads.py`, `tshirt_old_medium.py` (session scratchpad; they
go into this folder with the code PR).

**What matches the Medium:**
- **Vertices and UVs:** the same 1,662 vertices, and UV0 per vertex exactly (a bijection). UV1 is within 1/128: the
  maximum is exactly 0.0078125.
- **Materials:** one slot, `BasicTshirt`, with the same default material.
- **Normals:** identical (maximum difference 0).
- **Morphs:** `light_male` and `light_female`, plus the Medium's own fitting morphs `bandolier_squeeze` and
  `shrink_under_vest`.
- **Skeleton:** the same 34 joint names. Proof 4 passes, with joints within 1.3e-7 m of the class scale.
- **Registries:** no side registry names it, and no `itemBodyMasks` entry names its Medium.

**What differs:**
- **Positions,** against ×0.85 of the Medium:
  - median offset 0.04 mm; 477 vertices are off by more than 0.1 mm, 38 by more than 1 mm, and the maximum is 3.10 mm;
  - 31 of the 38 are at the hem (Medium height 0.92 m), moved down 1.8 mm on average;
  - the other 7 are at chest height.
- **Triangles:**
  - 38 of 2,744 (1.4%) form 19 quads split along the other diagonal, with winding kept;
  - those quads are not flat: the diagonal gap is up to 3.47 mm at the Medium bind and 3.00 mm at the Light bind,
    from hem to shoulder;
  - so proof 3′ would refuse it on the quad rule too, not only on positions.
- **Skin:**
  - weights differ on 1,546 of 1,662 vertices, by at most 0.094 per joint;
  - the Medium also weights `neck_02`: 26 weighted joints against the Light's 25;
  - every Light weighted joint is a body-skeleton bone.

**What it is not:**
- It is not the pre-Season 12 Medium scaled: against ×0.85 of the old `018762ec…`, it is 12.8 mm off.
- The Heavy is the Light's scaled twin: its 4.19 mm = 3.10 mm × 1.15 / 0.85.

**So it is a Light-authored garment, with its own skin and hem.** The materials still apply unchanged, because every
vertex keeps its UV0 and the slot is the same. The Medium's mask, though, was projected from another shape and skin:
`s12-refresh-tier2-v1/coverage-s12/SK_Casual_BasicTshirt_M.bodymask.png` (`9ff2ed9b…`), tiles [2, 1],
`derived-projection`, conservative shared-UV policy.

## Gates

These follow the fix-wave processing rows: the row gets its own proof, then a review that includes the idle pose.

**Kept unchanged:**
- proof 1 (same build), proof 2 (same package) and proof 6 (currency: the b10 read);
- proof 4 (weighted joints at the class scale, to 1e-4 m);
- material slots and default materials exact;
- fitting-morph names equal;
- the side-registry refusal;
- refusal if any `itemBodyMasks` entry names the Medium. Such masks would also need regenerating, which is out of
  scope here.

**Replacing proof 3 (same surface) with "the materials apply":**
- same primitive and vertex counts;
- a UV0 bijection to 1e-6;
- UV1 within 1/128 and every other UV set within 1e-6;
- triangles are the Light's own. They are recorded (flipped quads and gaps), not gated.

**Replacing proof 5 (pure-scale bind) with its own mask plus captures:**
- positions are recorded as a distribution;
- weighted joints must be body-skeleton bones;
- a 1 cm cap on the largest offset guards against a wrong file.

**Mask:**
1. **Generator check.** With the new code, regenerating the Medium mask on the Medium body must reproduce `9ff2ed9b…`
   exactly, with 0 texels different.
2. **The Light mask** uses the Medium mask's recorded policy:
   - derived projection, conservative shared UV, the intersection of the A and idle poses;
   - zero fitting weights and no body-type morph;
   - T-shirt_L projected onto SK_Body_L, built the way the runtime builds it (the index's `archetypes` record and the
     class skeleton scale).
3. **Record** the texels that differ from the Medium mask, with a diff sheet.

**Body UV is shared.** SK_Body_L passed proof 3 against SK_Body_M (same indices and UVs), so tiles [2, 1] carry over.

**Captures.** Through the read-only overlay, Light against Medium, Masculine, still and idle:
- **Starting outfit** (T-shirt, LooseJeans, TallSneakers): front, side, sideleft, back, waist and waistback.
- **8 variants against their icons,** front and back:

  | Variant | What to check |
  | --- | --- |
  | Black | the plain shirt |
  | White | the plain shirt |
  | Alliance | side panels, "3" sleeve |
  | OSPUZE | clamped decal |
  | Sponsor ISEULT | clamped decal |
  | Trentila Racing | back print |
  | AlfaActa | hem slogan |
  | Cometa | low print |
- **Read at full size** for:
  - no skin at the hem, neckline or armholes;
  - the shirt over the waistband all round;
  - prints where the Medium's are.

## Code (a tested PR first, as #108)

1. **`scripts/shader-probe/build-companion-masks.mjs`: add `--archetype light`.**
   - Loads the class body from the index's `archetypes` record (`indexClass`).
   - Resolves the items for Light (`loadSourceOutfit` with that archetype).
   - Refuses if any garment part resolves to a Medium mesh.
   - Records the class and the class body's file and sha in `derived-coverage.json`.
   - Inputs are read through the read-only overlay: the live `public/` plus the candidate GLB and index.
   - Output goes under `scripts/generated`, never `public/models`.
   - Without the flag, behaviour is unchanged. Check: the Medium regeneration equals `9ff2ed9b…`.
2. **`scripts/archetypes/build-archetype-index.py`: add `--reshaped NAME[,NAME]` and
   `--reshaped-masks derived-coverage.json`.**
   - The list is explicit; nothing is admitted automatically.
   - A named class mesh that fails proof 3 or 5 joins only if:
     - every gate above holds;
     - its mask record matches: mesh sha = the staged GLB, class body sha = the index's, policy = the Medium mask's.
   - Its entry gets its own `bodyMaskUrl` (published under `reconstructed-archetypes-v1/coverage/`), never the
     Medium's.
   - `report.json` records the measurements above.
   - **Tests, synthetic:**
     - must pass: a reshaped mesh with its own mask record;
     - must fail: not on the list; the mask made from another GLB; the mask made on the Medium body; UV0 differs; a
       weighted joint that is not a body bone; `itemBodyMasks` naming the Medium; named in a registry.
   - **Tests, real meshes:** T-shirt_L passes; a UV0-differs row is refused.

**Run:**
- one build on the active index at that time: after the 3′ patch, or whatever 602 reports;
- a patch of 1 mesh entry and 2 files (GLB `57db5442…` and the new mask);
- `compare-apply-delta.py`, then the captures;
- shas sent separately from the 3′ patch.

## For your decision

1. **The gates,** in particular:
   - proof 3 becomes "the materials apply" (UV0 bijection), with triangles recorded, not gated;
   - proof 5 becomes its own mask plus captures, with a 1 cm wrong-file cap.
2. **The mask policy:** the Medium mask's own (zero fitting weights, no body-type morph). The Masculine captures judge
   it, as C0's did.
3. **Scope:** the flag is general, but only listed rows join. The 115 "UV0 differs" Light rows are not eligible: they
   have no UV0 bijection and would need per-material review. Not proposed.
4. **Heavy:** T-shirt_H the same way when Heavy starts.
5. **Order:** I write the code PR now, while #108 waits; it writes no index and no live files. The run happens after
   the 3′ patch.
