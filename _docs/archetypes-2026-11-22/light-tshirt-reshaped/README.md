# SK_Casual_BasicTshirt_L through the reshaped route: code and dry runs (26 Nov 2026)

**For:** the coordinator. The plan in [PLAN.md](PLAN.md) was approved on all five points on 26 Nov.

**Status:**
- This is the code PR: the builder's `--reshaped` route, the generator's `--archetype` flag, tests, dry runs and captures.
- Nothing is applied. No index is written, and nothing here writes `public/models`.
- The real run comes after the 3′ patch has applied, on whatever active index the main-folder session reports then.
  Its shas go to the coordinator separately.

## What changed from the plan

1. **The mask policy is proved, not assumed.**
   - The plan said the Medium mask used the conservative shared-UV policy. It does not.
   - The C0 coverage file records `shared: null`. `run-masks-a.py` adds `--conservative-shared-uv` only for
     `all-surfaces-covered` items.
   - Regenerating with the flag gave 450,019 texels, not the published 460,868.
   - So the builder no longer checks a fixed policy. It needs a **check run**: the same generator on the Medium, which
     must regenerate the Medium's published mask byte for byte.
   - The class mask must then come from the same generator sha, the same method and the same shared-UV policy.
2. **Androgynous cannot be shown on Light.** `DA_BodyType`'s `SupportedArchetypes` makes Androgynous Medium-only, and
   the viewer follows it (`BODY_TYPE_ARCHETYPES` in `src/lib/archetype.ts`). The waist and waistback views were taken
   on Masculine, in both poses.

## The builder: `scripts/archetypes/build-archetype-index.py`

**New flags:**
- `--reshaped NAME[,NAME]`, repeatable. Only listed class meshes are tried. Nothing joins automatically.
- `--reshaped-masks <class run>/derived-coverage.json` and `--reshaped-mask-check <Medium run>/derived-coverage.json`.
  They go together, and both need `--reshaped`.

**A listed row is tried only if:**
- it has no other refusal;
- no side registry names it;
- no `itemBodyMasks` entry names its Medium;
- its Medium has a `bodyMaskUrl`;
- the class body is applied.

**"The materials apply"** (`materials_apply`) replaces proof 3:
- vertices are paired by sorting on UV0, then the other UV sets, then position;
- UV0 within 1e-6, UV1 within 1/128, every other UV set within 1e-6;
- every joint the class skin lists is a body bone or is listed by the Medium's skin;
- every weighted class joint is in the Medium's skin, at class scale within 1e-4 m;
- a 1 cm cap on the largest position offset, against a wrong file.

**Recorded, not gated:** the position offsets, the triangles not in the Medium's set and the reweighted vertices.

**Its own mask** (`reshaped_mask`) replaces proof 5. It needs:
- a check run on the Medium that reproduces the published mask byte for byte;
- the class run with the same generator sha, method and shared-UV policy;
- the class run projected onto the index's class body;
- the class run made from the staged GLB's sha;
- the Medium mask's UV tiles;
- the mask file on disk with its recorded sha;
- no fitted occlusion.

**Outputs:**
- **With a mask:** the entry drops the Medium's `bodyMaskUrl`, `bodyMaskUvTiles` and `coverageSource`. It gets its own
  mask under `reconstructed-archetypes-v1/coverage/`, and the publish list adds the mask after the mesh.
- **Without masks:** a row that passes everything else is refused with "needs its own body mask". It is written to
  `reshaped-preview/` (`assets.json`, `publish-list.tsv`, README). That index is only for the mask generator, never
  for applying.
- **Records:** `report.json` gets `reshaped` and `reshapedRules`. A `reshaped.tsv` is also written.

## The generator: `scripts/shader-probe/build-companion-masks.mjs`

**`--models-url http://127.0.0.1:<port>/models`:**
- reads the index, supported items and hashes over HTTP, from the read-only overlay;
- writes only under `scripts/generated/`, and refuses an existing output folder;
- requires `--all` and `--items`, and refuses `--legacy` and `--fitted-occlusion`;
- records `modelsUrl` and `generatorSha256` (the sha of the generator file itself).

**`--archetype light|heavy`** (needs `--models-url`):
- loads the class body from the index's `archetypes` record (`indexClass`), built the way the runtime builds it;
- resolves the item for that class (`loadSourceOutfit` with the archetype);
- refuses any part that keeps its Medium mesh;
- records `archetype`, plus the class body's file and sha.

**Without the new flags,** the generator behaves as before.

## Checks

**Tests:** `python scripts/archetypes/test_build_archetype_index.py` runs 54 tests, all passing. New:
- **`ReshapedRouteRule` (8):**
  - Passes, with the differences recorded: a mesh with its own shape (moved 3 mm), skin, split quads (one not flat) and
    an unweighted body bone listed.
  - Refused:
    - a moved UV0;
    - UV1 off by more than 1/128;
    - a renamed slot;
    - an extra vertex;
    - a 2 cm offset (the wrong-file cap);
    - a weighted joint the Medium's skin does not list;
    - a listed joint outside the body skeleton.
- **`ReshapedMaskRecord` (4):**
  - Passes: the matching record.
  - Refused:
    - another class;
    - fitted occlusion;
    - a check run that is not on the Medium;
    - a check run with another generator sha, method or policy;
    - a check run that does not reproduce the published mask, or a published mask that is missing;
    - another body;
    - another GLB;
    - other UV tiles;
    - no record for the mesh;
    - a changed PNG.
- **`ReshapedRouteInTheBuilder` (4):**
  - **Without the flag,** the T-shirt stays refused.
  - **Listed without masks:**
    - it is refused;
    - it goes to `reshaped-preview/` without the Medium's mask;
    - an unlisted row stays refused;
    - a row a registry names is refused, and so is a row whose Medium carries `itemBodyMasks`.
  - **Listed with its masks:**
    - it joins with its own `bodyMaskUrl` and the two publish rows;
    - no preview is written.
  - **Refused masks:** a mask from another GLB, a mask projected onto the Medium body, and a check run that misses the
    published mask.
- **Real meshes:**
  - T-shirt_L passes. Its numbers: 1,662 vertices; 38 of 2,744 triangles not in the Medium's set; 1,546 vertices
    reweighted; position offset at most 3.0973 mm.
  - FrogShoes_L, a "UV0 differs" row, is refused with "no vertex bijection on UV0".

**Mutation checks:** loosening the 1 cm cap, the UV1 tolerance or any of the mask checks makes a test fail.

**Mask generator:**

| Run | Body | Result |
| --- | --- | --- |
| Medium check (`medium-check/`) | `SK_Body_M` `62c9f3cb…` | `9ff2ed9b…`: the published C0 mask exactly, with 0 texels different. 460,868 texels |
| Light (`light/`) | `SK_Body_L` `fd9990b0…`, bind height 1.4299 m | `a608f5d659476f154b118adb6395c20f68c9037f65ef697f1374337a54748766`: 491,744 texels |

- Both runs used generator `61b41c71…` and the same method, policy and tiles [2, 1].
- The T-shirt_L GLB sha is `57db5442…`.

**Mask diff, Light against Medium:**
- 460,575 texels are in both masks;
- 31,169 are Light-only;
- 293 are Medium-only.

The Light-only texels are mostly interior bands: the Light body is smaller, so more of it falls within the 4 cm
projection distance. There are also thin slivers at the armholes and neckline. The diff sheet is
`mask-diff-light-vs-medium.png` (worktree `scripts/generated/archetypes/tshirt-l-masks/`).

**Dry runs** on active `e7cd0b2f…` plus `light-bulk-v2` (b01–b10), listing `SK_Casual_BasicTshirt_L`:

| Run | Masks | Result |
| --- | --- | --- |
| 1 | none | "pass, mask pending": refused, written to `reshaped-preview/` (`211b9fde…`) for the generator |
| 2 | Light run plus Medium check | "pass": 101 Light meshes; assets `868db4a4…`, publish list `e38735a7…` |

Dry run 2 against the 3′ result (`9f5dd6d2…` / `0267310a…`):
- The only index change is the new T-shirt_L entry. It has:
  - its own mask `../reconstructed-archetypes-v1/coverage/SK_Casual_BasicTshirt_L.bodymask.png`;
  - tiles [2, 1];
  - `derived-projection`;
  - the Medium's material slot.
- The publish list adds two rows: the GLB `57db5442…` and the mask `a608f5d6…`.

**Captures** (dry run 2 through the read-only overlay):
- The app runs from this worktree on 5181, with assets from 5199. The overlay serves the main `public/` plus the dry
  run's index, GLB and mask.
- Masculine, Light against Medium, 1500×1100, with cameras scaled to the class height.
- No errors, and no item left off Light.

**Starting outfit** (T-shirt, LooseJeans, TallSneakers):
- views: front, side, sideleft, back, waist, waistback, neck and armpit, in idle and the A pose. That is 32 shots.
- Read at full size:
  - The Light shirt is its own shape, slimmer than the Medium. Its back hem is smoother than the Medium's.
  - **Hem:** no skin. The hem lies over the jeans waistband all round: front, back and both sides, in both poses.
  - **Neckline:** clean, with no skin gap or body poking through.
  - **Armholes and armpits:** no skin and no holes, in idle and the A pose.
  - **Holes where the mask hides body the shirt does not cover:** none seen at the neck, the sleeve ends or the hem.

**Variants** (Black, White, Alliance, OSPUZE, Sponsor ISEULT, Trentila Racing, AlfaActa, Cometa):
- 32 shots: idle, front and back, Light against Medium.
- Each print sits where the Medium's does, at the class scale:
  - Alliance: the side panels and the "3" sleeve;
  - OSPUZE and Sponsor ISEULT: the decals;
  - Trentila Racing: the back print;
  - AlfaActa: the chest logo and the hem tag;
  - Cometa: the low band.
- The hem and sleeves look the same in every variant as on the starting outfit.
- The variants were compared against the live Medium, which already matches its icons, not against the icons
  directly.

**Paired sheets:** `pairs-start/` and `pairs-variants/` in the worktree folder, made with `pair_tee.py`.

## The run (after the 3′ patch applies)

In the main checkout:
1. Build a preview with `--reshaped SK_Casual_BasicTshirt_L` on the active index the main-folder session reports.
2. Serve it through the overlay.
3. Make the generator runs: the Medium check, then `--archetype light`.
4. Build the final index with `--reshaped-masks` and `--reshaped-mask-check`.
5. Check: `compare-apply-delta.py`, then the captures.
6. Send the shas to the coordinator, separately from the 3′ patch.

The patch will be one mesh entry and two files.

## Files here

| File | What it is |
| --- | --- |
| `PLAN.md` | the approved plan, with the measurements |
| `capture.mjs` | the captures (starting outfit or `variants`) |
| `overlay_server.py` | read-only overlay on 5199 (main `public/` plus a build folder) |
| `pair_tee.py` | Light \| Medium sheets |
| `tshirt_l_shape.py` | measurements in PLAN.md: positions, skin and joints against ×0.85 of the Medium |
| `tshirt_l_quads.py` | measurements in PLAN.md: the flipped quads at both binds |
| `tshirt_old_medium.py` | measurements in PLAN.md: against the pre-Season 12 Medium |
