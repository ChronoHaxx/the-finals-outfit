# C2 run v1 result, 27 Nov 2026 (main-folder session)

Resumed after the overnight pause (`PAUSED-2026-11-27.md`) as the PC's single heavy job: the coordinator's "RESUME …
dont overload our pc and drive" (relayed from the user via the PC steward). Active index `32f5b381…` re-hashed
before the resume; the step-3 cohort dry run on it (`prepare-cohort-recheck-2026-11-27.out`, `C2_OUT` to scratch)
was identical to the frozen cohort except `at`, so the finished source stage stood. Wrapper `resume-2026-11-27.sh`:
`run-v1.sh build` (build → gpu → index); serve-5174 started only after build passed (10:56:10 UTC) and its tree was
killed when the run ended (11:03:58 UTC).

| Stage | RUN.md | Got |
|---|---|---|
| source (26 Nov, before the pause) | no mesh, nothing unresolved | exit 0; 113 choices, 171 default materials, 363 textures, guard 7/0; 1 mesh extracted (SK_Streetwear_TechJoggersGlitch_M) and 3 unresolved (EngimoS4 and SponsorTrackS6 holograms, MI_TechJoggersGlitch). Tier-2 judged all of them known gaps that leave live unchanged (glitch overlay dropped by w175; hologram slot defaults on non-C2 meshes, live bindings kept) |
| build | built 100 | exit 0; **built 168**, cpuPassed 168, buildErrors {}, auditBlockers {}, 0 quarantined; 1 mesh converted and verified (the glitch overlay, preview-only). >100 expected: the build covers every cohort choice material (tier-2's correction) |
| gpu | 100, 0 failed | exit 0, first attempt; **168 materials**, 3,655 cases, max error 1.53e-05, 0 failed |
| index | 100 reboundMaterials, 113 implemented, addedMeshes 0 | **100 reboundMaterials, 113 implemented, 113 readvertised, 0 deferred, addedMeshes 0, addedMaterials 100**, supportedItems 2955 |

**Tier-2's index gate:** `MI_Streetwear_TightTechPants_Nylon` is among the 100 rebound, and
`streetwear-tighttechpants-nylon-glitch` is implemented (not deferred). PASS.

**Outputs (new paths only; the active folder untouched):**
- `public/models/reconstructed-s12-c2-preview-v1/`: preview.json `73b1db72…`, assets.json `1017c4a0…`, skin-pairs
  `f15a73a2…` (= active), supported-items `21f246d9…`. Inputs recorded: active `32f5b381…`, supported-items
  `54e8789c…`, skin-pairs `f15a73a2…`.
- `public/models/reconstructed-s12-c2-v1/`: `materials/` (338 files), `meshes/`, `staging/`, `defaults-assets.json`.
- `scripts/generated/shader-probe/s12-c2-v1/`.

Next: the tier-2 session builds the C2 patch (spec draft `9476c3ad` plus `reboundMaterialsFrom` this preview, masks
after its mask proof) on the then-active index; the main-folder session applies it.
