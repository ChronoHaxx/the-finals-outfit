# SK_Sneakers_M: the low sneakers' Medium onto the 17 Nov read — a C0b-style correction (26 Nov 2026)

**Asked by:** the coordinator, 26 Nov, after the Light/Heavy session's starter re-prove
(`_docs/archetypes-2026-11-22/light-starter-reprove-2026-11-26/README.md`). It found that the Arena Ready preset's Low
Sneakers (`SK_Sneakers_L`) wait on their Medium: "the UVs differ at the 2⁻⁹ step, probably the old wrap convention".
This is a mesh-only refresh of `SK_Sneakers_M` from the 17 Nov read, measured exactly like C0b (`C0b.md`). It isn't
in the batch C plan: the item rule already counts the mesh as Season 12.

| | |
|---|---|
| live mesh | `reconstructed-starter-sneakers-v1/meshes/SK_Sneakers_M.glb` (`b7cafdda…`), the 15 Sep starter-sneakers wave |
| 17 Nov mesh | `scripts/generated/archetypes/light-bulk-v2/source-glb/SK_Sneakers_M.glb` (`b292ec21…`), the Light bulk's read |
| items | 21, one material instance each (`MI_Sneakers_*`, `MI_StarterSet_Sneakers_*`) |
| active index | `e7cd0b2f…` (C0 and C0b applied, then three Light meshes added) |

Data, all ignored: `scripts/generated/s12-refresh-tier2-v1/sneakers-v1/`. The patch spec is committed as
`sneakers/refresh-spec.json`.

## Gate 1: the mesh, the materials, the mask

**The mesh** (`mesh-compare.py`, `mesh-compare-v1.json`):
- One primitive and one slot (`MI_Sneakers_Sneakers`) on both. Same attribute sets (UV0, UV1, colour, one joint set),
  the same joints, no morph targets.
- The index buffer is identical, and positions differ by at most 6e-8.
- **UV1 is identical** (U 0.0107–1.3545, V −0.1096–0.9893). Unlike TallSneakers, the live mesh already has it.
- **UV0:** 92 of 1,390 vertices shift by exactly −4 tiles in U; nothing shifts in V. Those same vertices (91 of them)
  also carry a residual of one 2⁻⁹ or 2⁻¹⁰ step.
  - They form one island: 139 triangles, 0.4% of the surface, at the top of one shoe's collar (x 0.114–0.147,
    y 0.096–0.115).
  - Live puts it at U 2.23–2.25, where half-floats step by 2⁻⁹; the 17 Nov read has it at U −1.77 to −1.75. So the old
    converter moved the island four tiles over and stored it at half precision. Everything else matches exactly.
  - No triangle spans a tile on either mesh, and no triangle's vertices shift by different tiles.

**The materials** (`material-check.py`, `material-check-v1.json`), all 21 from the active index:

| | |
|---|---|
| UV sets | 0 only, all 21 |
| reads the tile index (`floor(uv0…)`) | none |
| reads UV1 | none |
| wrap modes | `TA_Wrap` everywhere, plus `TA_Clamp` on `t5` in 5 materials |
| clamped samples | `t5` in BlackGold, BlackPurple, DarkBrown, DarkGrayWhite and Nylon, each through `fract()` on UV0 (the C0b decal routing: tile-invariant) |
| roots | `M_Character_8Layers_Master` (20), `M_Character_HolographicMaterial` (Iridescent) |

So, as for C0b, no texture is clamped on UV0 outside 0–1, and nothing reads the tile index. The runtime's one sampler
path (`applySamplerPolicy`) is unchanged. A Repeat texture sampled at `uv0 × s` ignores a 4-tile shift only when
`4s` is a whole number. The 8-layer master's detail layers can tile at non-whole scales (C0b's CamoEnoRino at
81.397644; Nylon here carries the same constant). On this one island, such a layer moves its phase, as CamoEnoRino's
blobs did. That is the game's own placement (gate 2 shows how much).

**The body mask** (`build-companion-masks.mjs`, default policy, through the candidate server):
- Regenerated from the live mesh, the default policy reproduces the published mask byte for byte (`d483af53…`,
  1,528 triangles, 63,319 texels); `--conservative-shared-uv` does not.
- Regenerated from the 17 Nov mesh with the same policy: **byte-identical**, `d483af53…`.
- So the published mask stays, and the patch is mesh-only.

## The patch

`make-refresh-patch.py` on a worktree copy of the active index (`e7cd0b2f…`) with `sneakers-v1/refresh-spec.json`:

| | |
|---|---|
| patch | `sneakers-v1/merge-patch-sneakers.json`, sha256 `5896057c…` |
| pinned to | `e7cd0b2f…` |
| repoints | 1 mesh (`url`, `sha256`), no mask, no material |
| expected `assets.json` | `0c92cecaae2cdc6a59cc7a946f4ce570f98bc52ea37b5d477ef176c17a67f3e7` |
| publish list | one file, 151,716 bytes: `public/models/s12-refresh-tier2-v1/sneakers/SK_Sneakers_M.glb` (`b292ec21…`) |

A candidate apply in the worktree wrote `0c92ceca…`. Diffing the indexes shows one mesh entry changed (`url`
`../reconstructed-starter-sneakers-v1/meshes/…` → `../s12-refresh-tier2-v1/sneakers/…`, `sha256` `b7cafdda` →
`b292ec21`); `bodyMaskUrl` and everything else are unchanged.

The apply follows C0b: stage the GLB in the root as a new file, then `apply-merge-patch.py --garments-only`.

## Gate 2: captures and ΔE (26 Nov 2026)

Two `serve-preview.mjs` servers from this worktree:

| | Port | Index served | `SK_Sneakers_M` served |
|---|---|---|---|
| live | 5251 | the active `e7cd0b2f…` | `b7cafdda…` |
| candidate | 5252 | `--preview public/models/s12t2-sneakers-cand`, `0c92ceca…` | `b292ec21…` |

Every shot passes `reconstructed=1`. None used serve-5174.

**ΔE against the icons** (`scripts/visual-diff`, 21 holdout cases `starterset-sneakers-*` added to `cases.json`):
- The probe sits on the image-left shoe's side panel.
- Live and candidate score **identically on every case**: the same rendered colour and the same ΔE (mean 4.9 over the
  18 scored probes).
- Nylon's probe is not scored on either side.
- Identical is the expected result: the only change is the 0.4% collar island, and the probe does not cover it.

**Captures** (`capture-review.mjs`):
- All 21 outfits, cameras `feet` and `feetright`, Masculine and Androgynous: 84 pairs, 0 errors.
- Each outfit is the starting face, the dark-blue LooseJeans, the black cotton T-shirt and that sneaker.
- `diff-captures.py`: 79 pairs differ somewhere. The largest has 16 changed pixels, with a maximum difference of 19
  levels; no pair has a pixel over 32.

Read at full size, the worst pair (DarkGrayWhite, Androgynous, `feet`; crops in `sneakers-v1/zoom/`):
- The one real change is a cluster of about 10 pixels at the top of the collar, where it pokes through the jeans hem
  as a small teal fleck.
- **The fleck is there on live too**; only its shade differs, because the island now samples the texture at the
  17 Nov tile.
- Every other changed pixel is a scattered 1–2 level difference.
- The shoe's panels, laces, stitching and sole are unchanged.
- BlackWhite's worst shot shows the same cluster and nothing else.

Verdict: no variant regresses. The swap is invisible except for that one fleck under the hem.

The two-run note: the capture run was cut short once, when the servers were stopped at a usage limit. It resumed into
the same folder (`--resume`). Two kept live shots had an odd size (900×1044, not 1500×1100), so they are kept aside in
`captures-odd-size/` and were retaken; every compared pair comes from the same servers.

## Status

| | |
|---|---|
| gate 1 (mesh, materials, mask) | pass |
| gate 2 (captures, ΔE) | pass |
| patch | `5896057c…` pinned to `e7cd0b2f…`, expected `0c92ceca…`; one file to publish |
| apply | through the main-folder session, after the coordinator's go. If the active index has moved (Light 3′ → `9f5dd6d2…`), rebuild the patch on it with `make-refresh-patch.py` and `sneakers-v1/refresh-spec.json`, and check it with an index diff |
