# C1 cohort re-check on the moved index, 26 Nov 2026 (main-folder session, coordinator's request)

The cohort was frozen on active `e7cd0b2f…`. Since then the index gained the low sneakers (C0b route), Light 3′ (100
`_L` meshes), the +2 and T-shirt_L, ending at `f65f6543…`. A dry run of `prepare-cohort.mjs` with
`C1_OUT=<scratchpad>` on `f65f6543…` (`prepare-cohort-recheck-f65f6543.out`):
- exit 0; rows 52, mergeModifierAdmitted 35, withParameters [], rebindKeptMaterials 52, itemsWithOtherParts 14, one
  skipped (`casual-longcoat-leather-camo`);
- `cohort-v1.json`: identical except `at` and the recorded input sha of `assets.json` (`e7cd0b2f…` → `f65f6543…`);
- `batch-attached.json`: identical.

So the run uses the cohort as frozen; nothing in it depends on what the applies changed.
