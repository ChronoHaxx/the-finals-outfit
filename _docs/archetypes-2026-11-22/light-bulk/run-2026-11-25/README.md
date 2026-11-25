# Light bulk run and build (24–25 Nov 2026): ready for apply, not applied

Plan: [../../LIGHT-BULK-PLAN.md](../../LIGHT-BULK-PLAN.md). Nothing here wrote `public/models`. The apply goes through
the main-folder session (local_602c33b0) by [../../APPLY.md](../../APPLY.md), after the release is live.

## Run (`run-light-bulk.py`, folder `scripts/generated/archetypes/light-bulk-v2` in the main checkout)

- **Map v1** `f36b7c4f…` and the 18 Oct probe `57948870…`, in "assets" mode.
- **Control:** passed. 24 packages proven unchanged since 18 Oct re-read byte-identical (mesh exports). The newest
  container file is from 17 Nov 14:41, the same as the 17 Nov proof's.
- **Batches 01–09:** 2,554 packages requested, the guard passed on every batch, and no package is missing.
  - 2,551 were read and converted.
  - 3 are not in today's game: `SK_Sport_Glasses_M/L/H`, recorded as `notInGame`.
- **`light-bulk-v1`** is an earlier attempt, interrupted on 24 Nov when sessions were stopped. It is left as it was;
  do not use it.

## Build (`build-archetype-index.py --staging light-bulk-v2 --live-equal-medium --proven nov17-proof-v1.json`)

| Input / output | sha256 |
| --- | --- |
| Active `assets.json` | `b164180cb6899a9ece4a916bb60bbc2546df9c476aeb90f18ca884108f96ed63` |
| Active `skin-pairs.json` | `f15a73a2a5dfc2f61c3bbd20bf1ea4b9c9e735a64f856ba12310f1e50e1c00a4` |
| Run record `light-bulk-v2/run.json` | `2d8b294691e4b33620ceed31521385633ca7d342a258d74e67fdd67eb30d52aa` |
| 17 Nov proof (`light-bulk-v2/inputs/nov17-proof-v1.json`) | `6406580f9ebb433936f0629a0d7157e412a9a1e40061ec1a9bd5c1e8055d8615` |
| Result `bulk-v2-build/assets.json` | `7ee6ef155f6f9dc01777784e0ebd70a144673d86ebc91916cd30eced6f02020d` |
| Its `publish-list.tsv` (538 rows, 336.2 MB) | `01538d4744d92d63131e53acdf8164662c9dc1fc5d2c0bea1998186dcfffea8c` |

**Keep the active `skin-pairs.json` on apply.** The build writes a re-serialized copy: different bytes (`4d167fb8…`),
same content.

**Result:** `{"light": 538, "heavy": 0} class meshes; 418 refused; 1206 skipped; classes: ['light']`.
- **538 Light meshes added:** 535 from today's read, plus the 3 early-win S11 rows (`Casual_LowWedgeHeels_L`,
  `CrossPromo_NRSuitBelts_L`, `Military_PantsWithHolsterPouch_L`).
- **The Light class is kept** (`alreadyApplied`). Heavy stays out, because `SK_Body_H` is not proven.
- **Additive:**
  - every active key and value is unchanged;
  - +538 mesh entries;
  - 147 items' body masks only gain `_L` keys;
  - the `archetypes` record is unchanged.
- **204 Light meshes refused** by a proof ([refused-light.tsv](refused-light.tsv)). Most are reshaped against their
  Medium (indices, UVs or vertex counts differ), so each needs its own masks. 37 have different skin joints.
- **Proof 1′:** 394 comparisons pass. The rest skip:
  - 138 Light rows as `medium changed in the game`;
  - 36 as `live Medium reweighted`.

  Every comparison, with the morph targets that differ, is in [proof1-prime.tsv](proof1-prime.tsv). Every skip, with
  its reason, is in [skipped.tsv](skipped.tsv).

## What it does for Light (if applied)

| | Before | After |
| --- | --- | --- |
| Items on Light (of 2,953) | 960 | 1,974 |
| Presets whole (of 352) | 6 | 32 |
| Presets losing at most one piece | 15 | 147 |

The plan's upper bound was 330 presets losing at most one piece. The gap is the 204 reshaped refusals and the 174
proof 1′ skips.

**Starting outfit:**
- Jeans: added.
- Sneakers: skipped on UVs. The UVs are not new: see the next section. The live Medium (`reconstructed-meshes-v2`)
  is an older build with U wrapped into 0–1 and no second UV set, so proof 1′ cannot call it the same build.
- T-shirt: its Medium changed in the game (indices); S12 batch C0 refreshes it.

So a whole Light starting outfit waits on C0 for the T-shirt, and on a refresh of the sneakers' Medium from the 17 Nov
read (recommended by the S12 tier-2 session for C0 too; the coordinator decides).

### The 27 "UVs" skips are mostly an older wrap convention (measured 25 Nov)

The first version of this record called the sneakers' UVs new. Measured against the live Medium
([uv-skips-census.tsv](uv-skips-census.tsv)):
- **18 are the same UVs with whole tiles removed:**
  - positions and indices are identical;
  - UV0 differs only by whole-number shifts (−2 to +2), with at most one half-float step (2⁻¹⁰) left over;
  - the live Mediums come from older pipelines that wrapped U into 0–1. Today's converter keeps the game's raw tiles,
    and 12 of the 18 live copies also lack the second UV set the game has.

  The sneakers are among them, along with 6 of the S12 wave U "new UVs" meshes: TacticalBoots, TacticalGloves,
  TacticalHelmet, TacticalVest, LanyardBracelet and BaseTankTop.
- **3 are probably the same** at a coarser step (2⁻⁹, consistent with |u| ≥ 2): CaptainBoots, CaptainHat and Sneakers.
  TacticalGlasses (0.0019) is borderline.
- **4 are real UV changes:** KneeSocks, ShinobiRope, PopBraceletSet and CrystalHeadband.
- **LongHoodie:** the live copy has a second UV set that today's read lacks.

**Proof 1′ is left strict on purpose.** A wrap-equal rule would pair raw-tile Light meshes with wrapped Mediums. The
game's own samplers repeat (`ReconstructedMaterial.ts`), so that would render correctly there. But the legacy paths
clamp: baked sets, binding textures, garment decals and hair masks (`CharacterRig.ts`). On those paths the Light piece
would smear wherever its UVs leave 0–1. Every one of the 538 added meshes has UVs equal to its live Medium's, so this
cannot happen to them. Changing the rule is the coordinator's call.

## Next

1. **Apply** (main-folder session): one apply of all 538, replacing W1–W3 (coordinator, 25 Nov). It goes after
   w177's apply and before S12 C0, and follows [APPLY.md](../../APPLY.md), "Bulk apply". The rebuild on the moved index
   must make exactly the reviewed change, which `scripts/archetypes/compare-apply-delta.py` checks.
2. **The 15 rows "served from the S12 refresh":** read their Medium, Light and Heavy in an extra batch and prove 1′
   against the live S12 Medium. Agreed with the S12 tier-2 session, 25 Nov.
3. **Follow-ups for other owners:**
   - Medium refreshes (S12 batch C);
   - the 25 fix-wave Mediums whose Light needs the same processing (unowned, with the coordinator);
   - the 204 reshaped Light meshes, which need their own masks.
