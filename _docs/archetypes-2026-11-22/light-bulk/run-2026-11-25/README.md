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
- Sneakers: skipped. Today's `SK_Casual_TallSneakers_M` has new UVs, but the index still serves the pre-S12 copy
  (`reconstructed-meshes-v2`).
- T-shirt: a Medium-refresh follow-up, same cause (S12 batch C0).

So a whole Light starting outfit waits on S12 batch C for the T-shirt and the sneakers.

## Next

1. **Apply** (main-folder session, after the release is live): `bulk-v2-build` by APPLY.md, with the pins above.
   - This one build holds every batch, so its 538 meshes can go in one apply instead of the three planned waves. That
     is the coordinator's call.
   - Record `skipped.tsv` in the apply record (already copied here).
2. **The 15 rows "served from the S12 refresh":** read their Medium, Light and Heavy in an extra batch and prove 1′
   against the live S12 Medium. Agreed with the S12 tier-2 session, 25 Nov.
3. **Follow-ups for other owners:**
   - Medium refreshes (S12 batch C);
   - the 25 fix-wave Mediums whose Light needs the same processing (unowned, with the coordinator);
   - the 204 reshaped Light meshes, which need their own masks.
