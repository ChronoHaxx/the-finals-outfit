# C0b: TallSneakers Medium onto the faithful 17 Nov mesh — a correction (25 Nov 2026)

**Asked by:** the coordinator, 25 Nov. C0b is a correction, not an equality swap. The live `SK_Casual_TallSneakers_M`
is defective: its UV0 is wrapped into 0–1 by an old converter and it has no UV1. The 17 Nov mesh is the game's
layout, with raw UV tiles and UV1. The 2⁻¹⁰ UV difference is converter precision and is accepted. It applies
separately, after C0, behind three gates:
1. wrap modes listed, with no clamp on UV0 outside 0–1, and UV1 actually read for Alliance;
2. before/after full-size captures beside each icon, plus the render-vs-icon ΔE, for every variant;
3. if any variant regresses, C0b holds and the live mesh stays.

After C0b applies, the L/H session re-proves `TallSneakers_L` against the new Medium (proof 1′).

Mesh: `light-bulk-v2/source-glb/SK_Casual_TallSneakers_M.glb` (`cff3a74c…`). The mask regenerated from it is
byte-identical to the published one (`5e166723…`), so only the mesh entry changes. Review index (worktree):
`public/models/s12t2-c0b-idx` (`dcce7ede…`), built with `make-refresh-patch.py` from
`scripts/generated/s12-refresh-tier2-v1/c0b-refresh-v1/spec.json`.

## Gate 1: wrap modes, tile reads, UV1

**Mesh.**
- The index buffer is identical and positions differ by 0.
- U shifts by whole tiles (−2..2) and V by 0.
- **No triangle's vertices shift by different tiles**, so neither mesh has a triangle spanning a tile boundary. The
  widest triangle spans 0.313 in U on both.
- The new UV1 is a separate set (U 0.011..1.486, V −0.171..0.989), not a copy of UV0.

**One wrap path in the runtime.** Every recovered texture goes through `applySamplerPolicy`
(`src/rig/ReconstructedMaterial.ts:303`). It maps the manifest's authored sampler address straight to Three:
`TA_Clamp` → ClampToEdge, `TA_Mirror` → MirroredRepeat, anything else → Repeat. All ten TallSneakers material
instances bind recovered manifests, and none has parameter variants.

| Material instance | UV sets | Reads the tile index | Clamped textures and their coordinates |
|---|---|---|---|
| Alliance | 0, 1 | yes, `floor(uv0.x)` | none (20 textures, all Repeat) |
| Canvas | 0 | no | `t5`: a decal at `fract(u)`, masked to 0–1 |
| Canvas Black | 0 | no | none |
| Canvas Bright | 0 | no | `t5`: same decal routing |
| Canvas CamoEnoRino | 0 | no | none |
| Canvas ORF | 0 | no | none |
| Canvas Purple | 0 | no | none |
| Canvas Red | 0 | no | `t5`: same decal routing |
| Canvas SponsorEngimo | 0 | no | none |
| Canvas White | 0 | no | `t5`: same decal routing |

**The clamped decal is tile-invariant.** The `t5` decal's U is `fract(abs(u))`, mirrored for negative `u`. That
equals `fract(u)` on every tile. The program masks the decal to 0–1, and its V comes from `uv0.y`, which does not
shift. Every other texture these materials sample with raw UV0 is Repeat, which is periodic. So the nine Canvas
variants should render the same on raw tiles as on wrapped ones, within the 2⁻¹⁰ quantisation.

**No wrap-mode change is needed.** No texture is clamped on UV0 outside 0–1.

**Alliance is what changes:**
- `floor(uv0.x)` sets a rotation of 90° per tile, applied to the blended detail normal. It feeds `surface.normal`
  only. On the wrapped live mesh the tile index is always 0, so islands outside tile 0 shade with their detail normal
  turned the wrong way.
- UV1 drives `t18` (a 256² sRGB colour texture, at a UV1 scale) and `t15` (a detail texture, at UV1 × 4). These feed
  base colour, normal, roughness and specular. The live mesh has no UV1, so the app aliases UV0 in its place
  (`ReconstructedMaterial.ts:699`, only when the mesh has no `uv1`). The pattern is laid out on the wrong UV set today.

**The app reads UV1 once it is present** (runtime probe `c0b-refresh-v1/uv1-probe.mjs`, the Alliance outfit,
Androgynous):

| Server | `uv1` | U range of UV0 |
|---|---|---|
| live (5251, `b164180c`) | the same attribute object as `uv` (aliased), max difference 0 | 0.008..0.992 (wrapped) |
| C0b (5252, `dcce7ede`) | its own attribute, max difference from UV0 2.22 | −1.854..2.359 (raw tiles) |

## Gate 2: captures and ΔE

**Setup.** Worktree code was served by `serve-preview.mjs`: 5251 against the live index (`b164180c`), 5252 against the
C0b index (`dcce7ede`, `--live-body --overlay public`). Both servers are stopped. Data is in
`scripts/generated/s12-refresh-tier2-v1/` (ignored):
- `captures-c0b/`: `capture-review.mjs`, 10 variants × Masculine and Androgynous × 4 feet cameras (`feet`,
  `feetback`, `feetside`, and the new `feetright`) × 2 servers. 160 shots, 0 console errors. Jeans and the black
  T-shirt are worn.
- `captures-c0b-diff/`: `diff-captures.py` pairs (live | C0b | difference ×30).
- `c0b-refresh-v1/sheets/`: full-size side crops of the right shoe beside each icon. `captures-c0b-icon/` holds the
  new `shoeright` camera (the shoes alone, close on the outer side) for Alliance, CamoEnoRino and ORF.
- `c0b-refresh-v1/vdiff-rec-{live,c0b}/`: the visual-diff harness (`render.mjs` + `compare.mjs`).

**ΔE against the icons** (visual-diff harness, boot probe, reconstructed route):

| Variant | Live ΔE | C0b ΔE | Change | Render pixels changed > 8 |
|---|---:|---:|---:|---:|
| Alliance | 6.53 | 6.57 | +0.04 | 1,309 |
| Canvas | 16.65 | 16.66 | +0.01 | 214 |
| Canvas Black | 7.59 | 7.60 | +0.01 | 73 |
| Canvas Bright | 17.09 | 17.13 | +0.04 | 115 |
| Canvas CamoEnoRino | 8.87 | 8.82 | −0.05 | 5,612 |
| Canvas ORF | 16.33 | 16.36 | +0.03 | 855 |
| Canvas Purple | 15.01 | 15.04 | +0.03 | 248 |
| Canvas Red | 17.42 | 17.44 | +0.02 | 312 |
| Canvas SponsorEngimo | 13.66 | 13.68 | +0.02 | 118 |
| Canvas White | 12.68 | 12.72 | +0.04 | 221 |

**No colour shift:** every change is within ±0.05. The absolute values are the same on both sides, so they are the
existing exposure gap (the renders sit darker than the icons), not this change.

A harness trap: `render.mjs` did not pass `reconstructed=1`, so it drew the older cosmetics route. That route never
reads this index, and the first live and C0b renders came out byte-identical. It now takes `VDIFF_QUERY`. `VDIFF_OUT`
and `VDIFF_PUBLIC` let it run from a worktree.

**Captures** (mean pixels per shot with a difference above 8 levels, and above 32):

| Variant | > 8 | > 32 | Read at full size |
|---|---:|---:|---|
| Alliance | 12,099 | 473 | The logo is unchanged and where the icon has it. The canvas changes from blotchy grunge (live) to an even fine crosshatch weave (C0b), which is closer to the icon's even canvas. That is the UV1 pattern laid out as authored |
| CamoEnoRino | 30,756 | 7,500 | The camo blobs move (below). No smear, no colour shift |
| Canvas, Black, Bright, Purple, Red, SponsorEngimo, White | 1,485–3,680 | 13–150 | No visible change |
| ORF | 4,101 | 532 | No visible change. The largest pixel change (158) is the one-pixel cyan piping at the toe cap. At 3× (`sheets/zoom-orf-maxdiff-x3.png`), the piping, stitching and canvas look the same |

**Why everything changes a little.** The 8-layer master tiles its detail layers at UV0 × 40, 60, 70 or 81.397644.
- At ×70, the old converter's 2⁻¹⁰ UV error moves a 256² detail texture by about 17 texels. That is the fine speckle
  in every difference image: a phase shift of the weave, not a different look.
- 81.397644 is not a whole number, so that layer is not periodic under a whole-tile shift. Each tile moves its pattern
  by 0.397644 of a period. That is the CamoEnoRino camo: on the wrapped live mesh, the camo on islands outside tile 0
  is shifted from the game's placement. C0b samples it at the game's own coordinates.

**CamoEnoRino against its icon is inconclusive.** At 256 px, from a more side-on angle than any capture
(`sheets/icon-camo-near-shoe.png`), the icon can't be matched blob for blob to either side. The claim rests on the
mechanism: C0b reproduces the game's sampling coordinates exactly, and live discards the tile index those coordinates
need.

**Gate 2 result:**
- No variant regresses: no smear, no colour shift.
- No triangle spans tiles, so a tile edge can't smear inside a triangle.
- Alliance improves.

**CamoEnoRino: icon-inconclusive, accepted by construction (non-integer tiling × whole-tile shift).** The coordinator
approved C0b with the camo included on 25 Nov, after looking at `side-canvas-camoenorino.png` and
`icon-camo-near-shoe.png`:
- live and C0b are equally clean, with the same palette and edge sharpness, no smear, and ΔE −0.05;
- only the blob placement differs, and C0b samples at the game's own coordinates.

Recheck it if a better in-game reference turns up.

The `reconstructed=1` trap found here dates earlier visual-diff runs; see `scripts/visual-diff/README.md`.

## Apply (after C0, through the main-folder session)

Only the mesh entry changes: the published mask stays, since its regeneration is byte-identical. The patch must be
built on the index as it stands after C0's apply. Steps:
1. Stage the GLB in the root, as a new file only:
   `public/models/s12-refresh-tier2-v1/c0b/SK_Casual_TallSneakers_M.glb` (`cff3a74c…`), copied from
   `scripts/generated/archetypes/light-bulk-v2/source-glb/SK_Casual_TallSneakers_M.glb` (same sha).
2. `make-refresh-patch.py public/models/reconstructed-assemblies-v1 _docs/s12-refresh-tier2-2026-11-22/c0b/refresh-spec.json <out>`
   (this session, read-only on the root). It writes the patch, the expected sha and a one-file publish list.
3. `apply-merge-patch.py <patch> public/models/reconstructed-assemblies-v1 <new dir> --garments-only`, then the usual
   backup and swap.

After it applies, the L/H session re-proves `TallSneakers_L` against the new Medium (proof 1′).

## The patch on the post-C0 index (26 Nov 2026)

C0 applied on 26 Nov: active `assets.json` `441eff47…`, skin pairs `f15a73a2…` (main-folder session,
`c0-run/APPLY-2026-11-26.md` in the root). Step 2 above, re-pinned to that index:

| | |
|---|---|
| patch | `scripts/generated/s12-refresh-tier2-v1/c0b-patch-v2/merge-patch-c0b.json`, sha256 `ee51daa9…` |
| pinned to | `441eff478be00279d78992d46a5e586a14d9e665aa71508818259c17df742b17` |
| repoints | 1 mesh (`SK_Casual_TallSneakers_M`: `url`, `sha256`); no mask, no material; skin pairs unchanged |
| expected `assets.json` | **`9e2fe5d329a1744fbcf9f7ffb7c0af841dc5b6622d6f48e21cb1f12bc41e3905`** (compact, as the active file) |
| publish list | one file, 344,212 bytes: `public/models/s12-refresh-tier2-v1/c0b/SK_Casual_TallSneakers_M.glb` (`cff3a74c…`) |

How it was built, without writing the root:
- The active `assets.json` and `skin-pairs.json` were copied into this worktree's ignored `public/models/` (shas
  checked).
- The GLB was copied from the root's `light-bulk-v2/source-glb/` to the worktree's
  `public/models/s12-refresh-tier2-v1/c0b/`, the path the spec names.
- `make-refresh-patch.py` resolves URLs from the index folder and compares slots with the index's own `slots` field.
  So the copy gives the same patch the root would, and the same publish-list path.

Checks:
- `apply-merge-patch.py --garments-only` onto a worktree copy wrote `9e2fe5d3…`.
- Diffing the indexes: one mesh entry changed (`url` `../reconstructed-meshes-v2/…` → `../s12-refresh-tier2-v1/c0b/…`,
  `sha256` `9998730a…` → `cff3a74c…`); `bodyMaskUrl`, every other entry and every other block are unchanged.
- Against the reviewed patch (`c0b-refresh-v1/patch.json`, pinned to `b164180c`), the mesh's `fromSha256` and
  `toSha256` are the same. Only the pin and the target folder differ: the review served the GLB from
  `s12t2-c0b/`, the release from the spec's path. Body, materials and skin pairs are the same.

The root still needs step 1: stage the GLB as a new file at the publish-list path (`cff3a74c…`) before the apply.
