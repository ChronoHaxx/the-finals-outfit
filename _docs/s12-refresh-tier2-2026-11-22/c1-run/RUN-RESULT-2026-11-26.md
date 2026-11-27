# C1 run v1 result, 26 Nov 2026 (main-folder session)

Run as the single heavy E: job after the T-shirt_L apply. Active index `f65f6543…` (the cohort re-check on it is in
`COHORT-RECHECK-f65f6543.md`: unchanged). serve-5174 started for the gpu stage only and was stopped (tree killed) as
soon as the run ended. `run-v1.out`: exit 0 on every stage, gpu on the first attempt.

| Stage | Expected (RUN.md) | Got |
|---|---|---|
| source | exit 0; no mesh extracted; window guard refuses no root; nothing unresolved | exit 0; 52 choices, 70 default materials (70 extracted), 0 meshes, 223 textures; guard: 6 checked, 0 refused. **Unresolved: `MI_FloatingHologram_SponsorTrackS6`, `MI_FloatingHologram_SponsorTrackSeason5`** (slot `SponsorTrackSeason6Holograms` etc. in `cohort-report.json`) |
| build | built 52, buildErrors {}, cpuPassed 52, auditBlockers {} | **built 68**, buildErrors {}, **cpuPassed 68**, auditBlockers {}; 0 quarantined |
| gpu | 52 materials, 0 failed | **68 materials**, 2,112 cases, max error 9.54e-06, 0 failed |
| index | 52 reboundMaterials, 52 implemented (all readvertised), addedMeshes 0 | 52 reboundMaterials, 52 implemented, 52 readvertised, 0 deferred, addedMeshes 0, addedMaterials 52, supportedItems 2955 |

**The 16 extra built materials** are exactly the build list minus the 52 rebind materials; none of the 52 is missing.
They are other-part materials of the items that show other meshes (pants and shorts): BallerinaTights_Nylon_Climber,
BasicShorts_Nylon_Climber, BikerVest_Leather, BikerVest_Nylon, LooseJeans_Denim_Lumberjack, CasualPants_Denim_GreenEvent,
DemonPants_Leather_Black, DoubleHolsterPants_WindBreaker_AlfaActa, EasternDemonPants_Linen_Black,
HeistPants_WindBreaker, TrackSuitPants (SquareWeave Black, SponsorEngimo, UtilityPants; WindBreaker Commando,
VaiiyaS7SP), SkiPants_Nylon_Valentines. The index rebinds only the 52.

**Outputs (new paths only; the active folder untouched):**
- `public/models/reconstructed-s12-c1-preview-v1/`: preview.json `5f622f8d…`, assets.json `8b7604d9…`, skin-pairs
  `f15a73a2…` (= active), supported-items `21f246d9…`. Recorded inputs: active assets `f65f6543…`, supported-items
  `54e8789c…`, skin-pairs `f15a73a2…`.
- `public/models/reconstructed-s12-c1-v1/`: `materials/` (205 files), `meshes/` (1 entry), `staging/`,
  `defaults-assets.json`.
- `scripts/generated/shader-probe/s12-c1-v1/` (cohort-report.json, validation).

The two differing numbers (unresolved holograms; 68 built) went to the tier-2 session and the coordinator to judge
before the C1 patch is built. Nothing was adjusted or rerun.
