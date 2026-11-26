# UV-tile census: no class mesh is only tile-shifted (26 Nov 2026)

**Asked by:** the coordinator, 26 Nov. Find the Light and Heavy rows that fail proof 3′ only because UV0 islands sit
whole tiles away from the Medium's, as `SK_Sneakers_L` seemed to. The rule was to be a wrap-aware 3′ that serves the
game's own raw tiles (as C0b does), with everything else strict.

**Result:** no row qualifies.
- The only tile-shifted rows are also reweighted. They stay refused, and no rule is widened for them.
- The coordinator agreed: no wrap-aware rule PR, because a rule that admits 0 rows is dead code.

## How it was run

[uv-tile-census.py](uv-tile-census.py): read-only, on the active index `f65f6543…` (after the +2 and T-shirt_L
applies). It ran between the main-folder session's E: jobs.
```
python -I _docs/archetypes-2026-11-22/light-uv-tile-census-2026-11-26/uv-tile-census.py $M/fresh-pair-dryrun \
    --models <root>/public/models --staging $M/light-bulk-v3 --staging $M/light-bulk-v2 --live-equal-medium \
    --same-surface-permuted --proven $M/light-bulk-v2/inputs/nov17-proof-v1.json --publish-dir reconstructed-archetypes-v1
```

**Steps:**
1. It runs the builder as a dry run, recording every proof 3′ attempt: the exact Medium and class GLBs it pairs.
2. It re-judges each attempt refused with "no vertex bijection on UV0":
   - **Pairing:** by class-scaled position (1e-5 m). Seam vertices are assigned by UV0 modulo whole tiles, then UV1, then
     normal. The pairing must be a bijection.
   - **UV0:** an integer tile shift per vertex. The residual must be within one stored fp16 step at that magnitude:
     2^(floor(log2 max(|u_class|, |u_medium|)) − 10). That is 2^-10 below |u| = 2, 2^-9 from 2 to 4 and 2^-8 from 4.
   - **Islands:** no triangle may straddle two shifts.
   - **Everything else as 3′:** UV1 within 1/1024, normals, weights by joint name, triangles under the mapping, and
     joints. Weights are recorded rather than stopped on, so the table can separate the reweighted rows.

**Scope:** only rows that reach proof 3′ on this index. Rows skipped before it are not covered: Medium changed in the
game, Medium repointed, sibling not staged, or the Medium not in the index.

## Results: 23 attempts (Light and Heavy) refused on UV0

The full table is [uv-tile-census.tsv](uv-tile-census.tsv).

**The tile pattern holds, but the rows are reweighted** (4 rows, 2 meshes). They are refused and listed:

| Row | Tile shift | UV0 residual | UV1 | Vertices reweighted | Max u8 steps |
| --- | --- | --- | --- | ---: | ---: |
| `SK_Sneakers_L`, `_H` | one island, +4 tiles in U, 92 vertices, no straddling | 1.0 fp16 step | ≤ 1/1024 | 1,014 of 1,390 | 23 |
| `SK_StarterSet_TShirt_L`, `_H` | one island, +4 tiles in U, 218 vertices, no straddling | 1.0 fp16 step | 6.1e-5 | 1,251 of 1,761 | 15 |

**Real UV differences, not tile shifts** (6 rows): `SK_Cute_TailBow`, `SK_Military_SciFiGloves` and
`SK_Ninja_ShinobiRopeUpperBack`, L and H.
- Their residuals are about half a tile (0.49–0.50), 1,000–2,000 fp16 steps.
- TailBow and ShinobiRope also have triangles straddling different shifts.

**Other topology or surface** (13 rows):
- **co-located vertices differ in number** (9): Cowboy Bandolier L/H and CoatCape L/H, MilitaryMechanicJacket_L and
  MilitaryMechanicJacketNoTshirt_H, BulletBandolier_L, LunarBoots_L, TanukiFurPlanes_H;
- **normals differ under the mapping** (4): FrogShoes L/H (0.0067) and BraidedBraceletSet L/H (0.0078).

## What would open the 4 reweighted rows

They are the game's own class meshes with their own skin: a small foot/ball and torso reweight. They are not a pairing
artefact; the vertex order is identical and the identity mapping gives the same counts.

To serve them, we would need evidence that their own weights are safe on our rig:
- **Captures:** each Light (and later Heavy) row with its own weights, against the Medium, in idle and one or two emotes
  that bend the affected joints (feet and ankles for the sneakers; torso and shoulders for the T-shirt).
- **What the captures must show:** no clipping into the body or neighbouring garments, and no hole where the Medium's
  body mask hides skin. The masks were projected on the Medium's weights.
- **A rule for them** would serve the raw tiles (as C0b does) and record the reweight. It would also need a decision on
  the body mask: the Medium's, proven by the captures, or the row's own, as the T-shirt_L reshaped route made.

That is a decision for the user, raised by the coordinator.
