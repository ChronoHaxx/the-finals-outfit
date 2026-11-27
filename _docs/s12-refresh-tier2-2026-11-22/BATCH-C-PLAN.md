# Season 12 batch C: plan (24–25 Nov 2026; not run)

**Asked by:** the coordinator (23 Nov): plan batch C on the patched 17 Nov map, the starting outfit's T-shirt first, then
the shared-item cluster and the held items, on the current active index.

**Not run.** Nothing here reads the game containers or writes `public/models`. Runs and applies go through the
main-folder session's queue, one apply at a time: w177, then Light W1, then C0 here, then Heavy.

**Why batch C is different.** Season 12 re-unwrapped these garments, so the live textures no longer fit the new mesh.
Each item showing one needs its 17 Nov material instances and textures read and its material rebuilt, not just a mesh
swap. Until 23 Nov that read was blocked: the 12.00 map misreads the 17 Nov build. Patched map v1 fixes it (w177
APPLY-STATUS steps 3e–3g).

## Pins

| Input | Value |
|---|---|
| active `reconstructed-assemblies-v1/assets.json` | `b164180c…` (unchanged on 25 Nov) |
| `skin-pairs.json` | `f15a73a2…` |
| map | `…-w177patch-v1.usmap` `f36b7c4f…`, with the window guard (`usmap_window_guard.py`) |
| View layout | 17 Nov = `C838D617`; requalified offsets in `scripts/shader-probe/view_layout_c838d617.json` |
| proofs on the active index | `morph-census-v11a`, `morph-only-proof-v11a`, `surface-match-proof-v11a`, package proof `package-proof-1117-v2` |
| builder run checked against | `index-v11e` (the planner refuses a run made on another index) |

## The rows

Planner: `scripts/body-types/plan-batch-c.py` (tests: `test_plan_batch_c.py`). Snapshot:
[batchC-plan/plan.json](batchC-plan/plan.json), [batchC-plan/rows.tsv](batchC-plan/rows.tsv) (one row per planned
mesh), [batchC-plan/items.tsv](batchC-plan/items.tsv) (each item, the wave that makes it Season 12 throughout, and what
still blocks it).

It mirrors `build-preview-index.py` exactly: the same admitted, stale, kept and unchanged sets, and the same item rule
(`settle`). Its starting state reproduces the builder's `effective` set. Each wave's meshes are assumed to pass, so
unlock counts are upper bounds.

Since C1 (27 Nov), pass `--fresh-reads scripts/generated/s12-refresh-tier2-v1/c1-reads-v1/meshes.sha256`.
- The builder's proofs see only the 6 Nov read, so C1's 12 never-read meshes, live as their 17 Nov reads, still
  planned as wave R. Their 4 items counted as not Season 12.
- With the flag, a read whose sha is the live entry's counts as Season 12 and current, after the builder check. On
  `32f5b381…`, plan v11's 1,644 items become 1,648, wave R loses those 12, and wave U loses LongCoat.

- 2,074 items show a body-type mesh. **1,423 are Season 12 throughout now.**
- **Only 1,232 of those are current with the 17 Nov build.** 93 meshes the item rule counts as Season 12 had their
  package changed on 17 Nov. They count because their live file matches the 6 Nov (12.00) read (the 22 Nov rule).
  A 17 Nov read (the Light bulk run's proof 1′ rows, `5e8bc00`) shows:
  - 32 match the live mesh: current;
  - 61 are not proven current. They form wave U below. TallSneakers, from the starting outfit, is among them, with new
    UVs.
- Batch C on the active index: **72 meshes**. By surface class:
  - UVs changed: 54;
  - UV sets differ: 10;
  - UV1 changed: 4;
  - moved too far to judge: 3;
  - the combat pants' new material slot: 1.
- Stale packages (changed on 17 Nov) outside batch C: 14 meshes items show.
- Never read for Season 12: 51 meshes. 39 of them are served from `w170-clothsim`; the rest from other fix waves after
  6 Nov.
- **The shared-item cluster is 67 meshes**, not 37. It is every non-S12 mesh linked to the 7 mask-proven v11 meshes
  through items that show both. The 37 counted only the roots and the v11 meshes; the rest are meshes already admitted
  that the item rule holds. By group: 45 admitted and held, 12 never read, 4 stale packages, 6 batch C.

## Waves

| Wave | Meshes | Material reads (meshes / MIs / textures) | Mesh reads | Unlocks | S12 items after | Current with 17 Nov after |
|---|---:|---|---:|---:|---:|---:|
| now | | | | | 1,423 | 1,232 |
| **C0** T-shirt | 1 | 1 / 43 / 58 | 0 | **43** | 1,466 | 1,275 |
| **C1** cluster | 67 | 6 / 52 / 59 | 16 | **183** | 1,649 | 1,444 |
| C2 | 5 | 5 / 100 / 87 | 0 | 92 | 1,741 | 1,536 |
| C3 | 25 | 25 / 99 / 252 | 1 | 95 | 1,836 | 1,629 |
| C4 | 35 | 35 / 45 / 247 | 1 | 90 | 1,926 | 1,719 |
| R mesh reads | 49 | 0 | 49 | 96 | 2,022 | 1,813 |
| U 17 Nov changes | 61 | 9 / 78 / 113 | 61 (25 not yet read) | 0 | 2,022 | 2,022 |
| still mixed | | | | | 52 items | |

"Mesh reads" counts packages that need a 17 Nov read; the Light bulk run has already read most of them (see "Reads
already done"). Wave U changes no item's Season 12 status. It makes the counted ones current.

**C0, `SK_Casual_BasicTshirt_M`** (the starting outfit's T-shirt, 43 items). Its mesh package is byte-identical to the
6 Nov read, so the Season 12 GLB from `s12-bodytype-refresh-v1` stands. It needs 43 material instances and 58 garment
textures from 17 Nov. No Light sibling is applied.

**C1, the cluster.** One apply: the item rule releases nothing in it until every member passes.
- Material reads for 6 batch C meshes: Streetwear Hoodie (38 items), UtilityBelt, TacticalKnightTop, TacticalKnightBelt,
  AssaultPantsNoKneepad, CardboardPants.
- Mesh reads for 4 stale packages: LongCoat, JesterNeckCape, JesterSkirt, EasternDemonSkirt.
- Mesh reads for 12 never-read meshes: the four vampire pieces, three geisha goth pieces, two peasant skirt pieces, and
  the FancyDress arm guard, bolero and ultimate necklace.
- 45 admitted meshes release with them. These include LooseJeans (the starting outfit's jeans) and the 7 v11 meshes,
  whose two changed masks then ship (bracers `d8941e9b`, cropped tee `b8f0453f`).

**C2–C4: the rest of batch C, most items first.** Each wave is about 100 material instances.
- C2: Shirt 47, Socks_Quarter 21, Pants 18, AssaultPants 16, TightTechPants 11.
- C3: 25 meshes, including CombatPants (its package changed on 17 Nov, and Season 12 added its `CombatPants_Cloth` slot).
- C4: 35 small meshes, including MessengerBag (package changed) and the Geta shoes (View gate, below).

**R: mesh-only reads.** 14 stale packages and 35 never-read meshes outside the cluster.
- Read and prove these first. A mesh whose live GLB already matches the 17 Nov package counts as Season 12 with no
  swap.
- The cloth-sim and proxy meshes (w170 and others) carry our own processing. If one differs, its processing must be
  redone on Season 12 data. That is not this route; the owner is still open.

**U: what the 17 Nov update changed in meshes counted as Season 12** (added 25 Nov). 61 meshes, shown by 200 items.
- **New UVs (9): the batch C route,** with materials, textures and the mesh from 17 Nov:
  - TacticalBoots 22 items, TacticalGloves 20, BaseTankTop 19, TacticalHelmet 13, **TallSneakers 10** (starting
    outfit), TacticalVest 4, LanyardBracelet 3, TacticalGlasses 2, KneeSocks 1;
  - 78 MIs and 113 textures, all layered, so the View gate is expected to pass them.
  - **Recommended: pull TallSneakers into C0 beside the T-shirt.** It has the same route and is the same starting
    outfit. Its Light sibling also waits on it (the Light session's verdict).
- **Other geometry changed (9):** indices, joint names or order, positions. These take the mesh route, with masks
  regenerated:
  - TacticalTrousers, Streetwear Jacket, TacticalHeadphones, FancyDress Gloves, Pirate SeaBandolier;
  - HeadscarfStraps, KnightCape, ChainBelt, SportyRobotLegs. Their live Mediums are our own fix-wave builds, so the
    difference may be our processing. Compare against the pre-processing source first.
- **Live Medium reweighted (18):** our own weight transfer differs from any game read by design. Compare the 17 Nov read
  with the transfer's source instead. If that matches, the mesh is current.
- **No 17 Nov read (25):** beards and moustaches, mouth scarves, skirts, the face mask and others. These are not in the
  Light bulk run because most have no Light sibling; they need a read.

## The route for a batch C wave

1. `replan.sh` on the then-active index, then this planner. Stop if a count moved.
2. **Read and rebuild the materials on 17 Nov with map v1.** Use the shared runner, which pins the map by sha256 and runs
   the window guard and the View gate: the ordinary single-mesh family runner (`prepare-family.py`, one mesh, one slot,
   one material per choice) for C0. Older adapters (`prepare-casual-tshirts.py`) are history, not the route.
   Outputs go to new private folders.
3. **Mesh:** ship the Season 12 GLB the proof chain covers (`s12-bodytype-refresh-v1`). For changed or never-read
   packages, take a fresh 17 Nov read through the same proofs. Cross-check: where the package is byte-identical, the
   runner's own mesh must equal the Season 12 GLB under the existing proofs. If it doesn't, stop and find out why first.
4. **Masks:** regenerate the body mask and every item mask that names the mesh, from the Season 12 GLB (tier 2's batch B
   path, `mask-proof.py`).
5. **Review** against icons at full size: Masculine and Androgynous, still and idle, front/back/side/waist. Feminine is
   for information only.
6. A merge patch pinned to the then-active index, a publish list (GLBs, masks, material JSON/GLSL and textures), and
   `APPLY.md`. Send the coordinator one line each for the upload and the apply, with the rollback.

To settle in the C0 pilot, before C1:
- The cross-check in step 3, and how the runner's index stage writes the swap. Batch C changes a part's mesh *and* its
  materials in one apply; earlier waves did one or the other.
- One of the T-shirt's 43 materials (`cotton-alfaacta`, `reconstructed-materials-batch-01`) is an older file that
  records no root. The rebuild replaces it either way.

## Gates

- **Map window guard:** a material that sets UMaterial slots 146–148 is refused, and its items are deferred with the
  reason. No batch C root is known to set one; the guard decides.
- **View layout gate (C838D617).** The forecast is by live material (`viewGate` column); the pipeline's gate decides on
  the 17 Nov program.
  - Refused until requalified: the Geta shoes' anime-archer variant. It pins the sun direction `cb0[183]`, which
    C838D617 does not requalify (C4, 1 item).
  - To check (11 meshes):
    - View fields: the Vaiiya vest and Holtow jacket holograms (`M_FloatingHologram`), LongCurly hair, SpaceBrain
      (`M_Face`);
    - non-layered roots: ChromeJacket and one PufferVest variant (`M_Character_HolographicMaterial`), JesterHat
      (`M_CharacterEmpty`), LunarLegCover (`M_CharacterDetailAlpha`), the cardboard pants and vest
      (`M_CharacterAttachment`), one TightTechPants variant (`M_Character_PlasticSheet`).
  - No root recorded (3): one T-shirt material, TacticalKnightTop and TacticalKnightBelt. These are older material
    files from the first waves; the rebuild decides.
  - The other 57 are layered (`8Layers`, `Layered`, LeopardPrint, TeamColor, AnimatedPattern). Those programs' View
    reads are requalified or sit on dead paths.
- **Package proof:** CombatPants and MessengerBag changed on 17 Nov, so their mesh comes from the fresh read, never the
  6 Nov GLB.

## Light siblings (agreed with the Light/Heavy session, 25 Nov)

**Keep the 16 Light meshes that sit beside batch C Mediums, as the game does.** Fifteen applied Light meshes
(`reconstructed-archetypes-v1`) plus one Light hair mesh are siblings of batch C Mediums:
- C1: Hoodie_L.
- C2: Pants_L.
- C3: PufferVest_L, MarinePants_L, HackerGloves_L, LongCurly_L (hair).
- C4: PioneerShoes_L, SpacePilotGloves_L, DiscoKeychain_L, DiscoNecklace_L, PantsToolBag_L, SpaceBrain_L,
  SpaceCombatPouches_L, SpaceSuitPants_L, SpaceSuitPantsUltimate_L, SpaceTopVest_L.

Batch C moves their items to Season 12 materials and textures. The Light meshes keep the old UV layout, because their
17 Nov packages are byte-identical to the 18 Oct read (the Light session's proof). That is also what the game draws:
- the items' 94 `Archetype.Light` TagOverrides swap only the mesh;
- not one sets `bOverrideMaterials` (customization.json `cd44cf10`).

So the game puts the same Season 12 materials on the old-layout Light mesh. The first proposal (drop and name, 24 Nov) is
withdrawn. Per wave instead:
- **Definitions:** confirm on the 17 Nov definitions (the runner's freeze) that no Light override sets materials. If
  one does, use it.
- **UV sets:** every UV set the rebuilt material requires (`requiredUvSets`) must exist on the `_L` GLB. Hoodie is
  "UV sets differ". If a set is missing, drop that `_L` entry and name it (fail closed).
- **Review:** add a Light capture of each such item, for information. Its look is the game's own pairing, judged
  against nothing but the game.

C1 also swaps 14 admitted Medium meshes that have applied `_L` siblings. Their UVs are unchanged and so are their
material bindings. Their masks change in only one case: TacticalKnightBracers gets the Season 12 body mask `d8941e9b`.
The `_L` entries keep their own fields, which match their unchanged geometry. The Light builder never re-evaluates
applied `_L` entries.

**Reads already done.** The Light bulk run read 2,554 mesh packages from the 17 Nov containers. It used map v1 and the
guard, in assets mode, recording a package sha256 per package; the request lists are
`scripts/generated/archetypes/light-bulk-plan-go/requests/b01–b09.json`.
- They cover 61 of the 65 mesh reads here (every C1 mesh read).
- They also cover 53 of the 72 batch C Medium packages, CombatPants among them.
- Not covered: SkiMask, TechJacketHarness, SpacePilotJacket, SpacePilotJacketUltimate, and MessengerBag's changed
  package.
- Reuse them if this route's mesh build takes assets-mode output (the C0 pilot checks this). They hold meshes only:
  every material instance and texture is still to read.

The Light session's follow-up rows:
- **15 "served from the S12 refresh":** all 15 Mediums are Season 12 now, and no batch C wave reads them. Their `_L`
  reads belong in Light W1, proven against the live Medium.
- **30 "Medium refresh":** only 3 are in this plan:
  - BasicTshirt, in C0;
  - SpacePilotJacket and SpacePilotJacketUltimate, in R.
  The other 27:
  - 25 already count as Season 12 here. Their live Medium is our own fix-wave build (wraps, resweeps, LED, transfer,
    part-hide), so this route never repoints them. Their Light path needs that processing applied to `_L`. No owner yet.
  - 2 (RetroRobotHands and RetroRobotLegs, w139 part-hide) have no Season 12 proof row.
- **Starting outfit on Light** (the Light session's verdicts, 25 Nov):
  - LooseJeans_L **joined**. Today's jeans match the live jeans except for body-type morphs (up to 1.24 cm), so proof
    1′ passes.
  - TallSneakers_L and BasicTshirt_L wait for their Mediums: the sneakers changed UVs on 17 Nov, the T-shirt changed
    indices.
  - The Light build re-proves each `_L` once C0 (and TallSneakers, from U or pulled into C0) applies.
  - On Medium, the jeans become Season 12 throughout in C1, and the sneakers current in U.

## Held (not planned)

| Mesh | Items | Reason |
|---|---:|---|
| `SK_Streetwear_CropTopHoodie_M` | 1 | the game's own Season 12 weights are defective (README) |
| `SK_Streetwear_PopGothShoes_M` | 1 | the same |
| `SK_FancyDress_SuitJacket_M` | 7 | w161 part-hide mask needs tooling |
| `SK_Traditional_LunarDressTop_M` | 2 | legacy mask with no generation record |
| `SK_Streetwear_CroppedTshirtOversize_M` | 1, mixed by exception | arms-out underarm wedge in the S12 mesh; the game's own weights, inverse binds verified (C1.md) |

**The cropped tee's hold has a mixed-item exception** (coordinator, 26 Nov, C1 option c).
- Its one item, `streetwear-croppedtshirtoversize-cotton-red`, may go mixed: the live tee with the Season 12
  ChainNecklace and PopLanyard armbands. Captures show no clipping (C1.md).
- Without the exception, the hold keeps those three meshes live and holds 167 C1 items.
- The exception is the only entry in `MIXED_ITEM_EXCEPTIONS` (`build-preview-index.py`). The builder and the planner
  take it with `--allow-mixed-item` and refuse any other item or mesh.
- Replan `batchC-plan-v9` (active `e7cd0b2f`): C1 becomes 66 meshes and 182 items, and every later count drops by
  that one item (2,022 at the end).

After every wave, **52 items stay mixed** in this snapshot (53 with the tee's item). Their blockers are refused on other routes (loader refusals, vertex colour,
our own processing), plus the holds above. Largest:

| Mesh | Items held |
|---|---:|
| TightSinglet | 22 |
| TechHoodie | 10 |
| SuitJacket | 7 |
| ShirtRolledUpSleeves | 5 |
| SWATVest | 4 |
