# Light and Heavy contestants (22 Nov 2026)

The user (22 Nov): "do light and heavy body size too". Visitors pick Light, Medium or Heavy, and every piece the viewer
shows on a class is the game's own class data. Nothing is approximated: an item whose class mesh is not extracted yet
is left off on that class and named, and the outfit keeps it.

Branch `claude/jovial-fermat-65dc6d`. Behind a flag until the class meshes are hosted (see "Flag" below).

**Where it stands (23 Nov):**
- **Light** is buildable on 78 meshes, each proven against the live build and against today's (17 Nov) game files.
  They are in the preview index only (`scripts/generated/archetypes/preview-v2`); nothing is written to
  `public/models`.
- **Heavy** is blocked: `SK_Body_H` changed in the 17 Nov update. A Heavy class needs its body, so the builder leaves
  Heavy out of the index whole, and the picker never offers it. Heavy waits for a fresh read of `SK_Body_H`.
- **Since S12 batch A landed** (active index b4f28192), Light re-plans to 63 meshes. The other 15 are waiting for an
  S12-matched `_L` read (see "Re-plan on the S12 batch A index" below).
- **The runtime supports both classes.** The Heavy captures from before the proof (`captures-v1`) show it working.

## How the game builds a class

Everything below was read from the game's data or measured on the extracted meshes.

- **Skeleton.** `SK_Body_L` / `SK_Body_H` are `SK_Body_M` with every bone translation x0.85 / x1.15 and every rotation
  unchanged. Measured on the staged GLBs: translation residual 3.6e-7 m (Light) and 5.3e-7 m (Heavy), rotation
  difference under 2e-6.
- **Bodies and garments.** A class mesh (`*_L`, `*_H`) is a separate mesh the definitions swap in through an Archetype
  TagOverride (`Customization.Archetype.Light/Heavy`, `bOverrideMesh`). Its bind is the Medium bind scaled.
- **Class morphs cannot be derived.** Each class mesh carries its own `light_*` / `heavy_*` morphs, which the body
  type's DA activates (`ActivatesLightMorphTargets` and `ActivatesHeavyMorphTargets`). Census of 207 L/M/H triples in
  `season11-staging-20261018`, in [class-morph-census-s11-20261018.json](class-morph-census-s11-20261018.json)
  (from `scripts/archetypes/class-morph-census.py`):
  - The binds and fitting morphs are pure x0.85 / x1.15 scales on 195 / 192 meshes.
  - The class morphs are not. Comparing each mesh's worst vertex against 0.85 x `medium_male`, `light_male` is off by
    a median of 1.4 cm (range 0.1 to 4.3 cm).
  - Against 1.15 x `medium_male`, `heavy_male` is off by a median of 4.7 cm (up to 21 cm).

  So a pure-scale fallback is not faithful for any garment, and none is used.
- **The head is scaled with the class (corrected 23 Nov; the 22 Nov runtime had it wrong).** No head has a class mesh:
  the head is its own, non-merged component (`bIsHeadMesh`, `bCanBeMerged` false). On a class it is the Medium head
  scaled by the class scale, morphs included, carried by the class bones.
  - **Measured** on `SK_Head_Face_01_Base`, from the neck rim (the 356 head vertices lying on the Medium body) to the
    class body, both with their morphs:

    | Model | Light, median (max) | Heavy, median (max) |
    | --- | --- | --- |
    | Head scaled, morphs scaled with it | 0.10 cm (0.62) | 0.14 cm (1.37) |
    | Head full size, carried by each bone's move (plain leader pose) | 1.54 cm (3.19) | 2.12 cm (3.30) |
    | Control: the head on the Medium body | 0.12 cm (0.48) | |

  - The head's own `light_male` / `heavy_male` morphs (up to 1.9 / 4.4 cm, all on the neck rim) are authored for
    the scaled head.
  - **The DA socket offsets agree.** The head socket offsets are symmetric only in a frame scaled by the class. Hat:
    0.85 x −2.647 = −2.25 cm (Light) and 1.15 x 1.956 = +2.25 cm (Heavy). Eyewear: 2.031 / 0.761 cm, matching to
    1e-4. So sockets scale with the class too.
  - **Not read:** the engine mechanism. The raw class skeletons have unit bone scales, and a component scale on a
    leader-posed head would not give this geometry. The rule is the measured geometry.
  - **What the 22 Nov runtime showed:** it kept the head full size. That showed on Light as a translucent shell (the
    head's faded neck rim) standing off the shoulders, and a step under the chin. Fixed by binding Medium-authored
    skins and sockets to `S(s) x MediumRest⁻¹` (`mediumAsClassRests`); see the before/after shot in the PR.
  - **The same rule applies to** hair and beards with no class mesh, and statics on sockets (hats, glasses, static
    hair). They fit the head they were authored on, so they scale with it.
- **Sockets (23 Nov, settled by the glasses).** There are two kinds:
  - **Body sockets.** These are the merge-target skeleton's (`SK_CharacterMeshMergeTarget_Skeleton`): `head`,
    `eyewear_attachment`, `upperback_attachment`, `clavicle_attachment`. The composition is socket rest (Medium
    relative transform, unscaled, riding its moved bone) × class scale × DA offset × part. Two things fit this and
    nothing else:
    - the eyewear offset is −0.15 of the socket's own distance in the world (0.85 × −2.390 = −2.031 cm), which puts
      the scaled glasses exactly on the scaled eyes;
    - the static part (glasses, hat, static hair) is scaled by the class, so it fits the scaled head.

    The first composition also scaled the socket's own position. That sank the glasses 2 cm into the face on Light.
  - **Head-component sockets** (earrings, `bAttachToHeadMesh`) live on the scaled head itself, so they scale fully,
    their position included.
- **Animation.** Clip translation tracks (pelvis, weapon_root) and the prop attach-bone rests scale by the class
  skeleton scale ("AnimationScaled" retargeting).
- **Body types.**
  - Masculine and Feminine support all three classes (`light_male` / `heavy_male`, `light_female` / `heavy_female`).
  - Androgynous is Medium only: its DA's `SupportedArchetypes` lists only Medium.

## What the viewer does

| Piece | File |
| --- | --- |
| Class ids, labels, tags, share codes, the flag | `src/lib/archetype.ts` |
| Index class record, skeleton scaling, bind-basis rule | `src/rig/Archetype.ts` |
| Class body load, Medium rests kept for sockets, per-mesh basis | `src/rig/CharacterRig.ts` |
| Class morph and socket offsets per body type (copied from the DAs) | `src/rig/BodyTypePreview.ts` |
| Class tag in the resolver; the face's body swapped to the class body | `src/rig/SourceAssembly.ts` |
| Items without class meshes left off and reported | `src/rig/OutfitPass.ts` |
| Clip translations and prop bones scaled | `src/rig/RigAnimator.ts`, `src/rig/EmoteProps.ts` |
| Class picker, unsupported body types greyed | `src/components/OutfitBar.tsx`, `useArchetypeChoices.ts` |
| Class load, notice, HUD label | `src/components/CharacterViewer.tsx` |
| Saved outfits (`archetype` known field), share links (`ar=l|h`), Worker allow-list | `src/lib/outfit-library.ts`, `share-url.ts`, `share-preview.ts`, `workers/share-preview/` |

- **Bind basis.** Each source mesh is bound in the rest it was authored in. The rig compares joint positions, not
  matrices: the median distance between the skin's inverse-bind joint positions and a rest. The legacy driver's bone
  axes are reoriented (Blender), so whole matrices never match.
  - Measured: a mesh's own rest is at most 0.45 mm away; any other class's rest is at least 2.8 cm away. The tolerance
    is 5 mm.
  - Class-authored meshes bind to the class rests. Medium-authored ones bind to the Medium rests scaled by the class
    (`mediumAsClassRests`); detection still compares against the unscaled Medium rests.
  - Anything else is refused, with a named error.
- **Notice.** "Not on Light yet: … Their Light versions aren't in the viewer yet, so they're left off; your outfit
  keeps them." The saved outfit and the share link still hold every item.
- **Saving and links.**
  - `archetype` is a known field of saved outfits. An absent value means Medium, and writers keep fields they don't
    know.
  - Links carry `ar=l` / `ar=h`; Medium has no parameter, so every older link still opens unchanged.
  - The share Worker stores and re-emits `ar`. The app refuses a short link if the Worker dropped it, so a
    not-yet-deployed Worker can never silently turn a Heavy share into a Medium one.
- **Flag.** `finals-archetypes:preview` in localStorage, set by `?archetypes=on` and cleared by `?archetypes=off`. It is
  on in dev. The picker shows only the classes the index carries (`assets.json` `archetypes`). So production shows
  nothing new until the index apply lands, even with the flag on.

## The index proofs (first pass, before the 17 Nov proof)

This first pass found 86 Light and 87 Heavy meshes. The 17 Nov proof below cuts that to 78 Light and no Heavy.

`scripts/archetypes/build-archetype-index.py` reads the active index and the staged extraction. It adds a class mesh
only when all of these hold:

1. **Same build:** the Medium sibling's staged GLB is byte-identical to the mesh the live index serves.
2. **Same package:** the GLB's recorded source is the package the TagOverride names.
3. **Same surface:** primitives, vertex counts, indices, UVs and material slots all match.
4. **Joints:** every joint is at the class scale of the Medium joint, within 1e-4 m.
5. **Bind:** the bind is a pure scale of the Medium bind, within 0.05 cm.

Conditions 3 and 5 are what let the Medium entry's slot bindings and body-hide masks (body-UV space) apply unchanged. The
class bodies also pass the skeleton proof.

Result on active `assets.json` 3f64b2e6 and skin-pairs f15a73a2:

- **Added:** 86 Light and 87 Heavy, including `SK_Body_L` and `SK_Body_H`. That is 173 GLBs, 176.6 MB uncompressed.
  58 items gain the matching `_L` / `_H` mask entries. Every original entry is unchanged: a check confirms the change
  is nested-additive.
- **Buildable items (first pass):** about 1,049 Light and 1,018 Heavy items had no class swap or only proven ones
  (`scripts/generated/archetypes/preview-v1/available-items-approx.json`). Statics and heads need none. The 17 Nov
  proof removes the items that use one of the 8 dropped Light meshes.
- **Refused, 11 meshes, with a reason each** (in `report.json`). Each is a reshaped class mesh that needs its own masks:
  - indices or UVs differ: `HeadPhonesAntennaPart_L`, `NRSuit_L`, `Racing_Gloves_L/H`, `AstroPilotGloves_H`;
  - vertex count differs: `AmmoBackpack_L/H`, `PoetShirtWithVest_L/H`, `CordBracelet_L`, `PioneerUpper_H`.
- **Skipped:** `SK_Goth_M`, because the definitions disagree about its class mesh. Until 23 Nov this pass skipped
  some rows without recording them; see the next sections.
- **Reproducible:** two runs give byte-identical output.

## 17 Nov container proof (coordinator condition, 22 Nov)

`scripts/archetypes/prove-nov17.py` re-read every class package (and each Medium sibling) from today's containers,
which were rewritten on 17 Nov. It used the 18 Oct run's own probe and mapping, and compared the package sha256 that
both runs recorded. The proof per mesh is in `scripts/generated/archetypes/nov17-proof-v1/proof.json`.

- **Light:** 156 of 173 meshes are byte-identical, including `SK_Body_L`.
- **17 differ and are dropped:**
  - `SK_Body_H`;
  - `ShortSkirt`, `HighPonytail_Tail`, `TechJacketHarness`, `DiscoBotGloves`, `MessengerBag` and `SkiMask` (both L and
    H);
  - `DiscoJacket_H`, `SportyRobotHands_H`, `SpaceCombatTorso_L` and `BoilerSuitTorso_L`.
- **Heavy is blocked as a whole.** Its body changed, and a Heavy class needs its body. Heavy waits for a fresh read of
  `SK_Body_H`, which needs the 17 Nov usmap or a proof that the 12.00 read is exact.
- **Light goes ahead** on the proven meshes only. `build-archetype-index.py --proven <proof.json>` adds this as a
  sixth proof and records each mesh's proof row in `report.json` (`containers17Nov`). Its outputs are
  `preview-v2` / `apply-v2`: 78 Light meshes, 0 Heavy, 28 refused, reproducible. `preview-v1` / `apply-v1` predate
  the proof and must not be applied.
- **Medium (for information):** 77 Medium siblings the live index serves also changed on 17 Nov. That is for the S12
  refresh to handle.

## Re-plan on the S12 batch A index (23 Nov)

S12 tier-2 batch A v8 landed before the Light apply, so the active index moved from 3f64b2e6 to b4f28192. The builder
re-plans on whatever index is active. Read-only result:

- **63 Light meshes, 0 Heavy, 25 refused** (61.3 MB). `assets.json` 425023bb…, `publish-list.tsv` 5df7361e….
- **15 Light rows dropped from the 23 Nov 78.** Batch A repointed their Medium sibling to `s12-bodytype-refresh-v1`.
  Proof 1 (same build) then fails: the staged `_L` was read beside the S11 Medium, not the S12 one.
  - These 15 are **waiting for an S12-matched `_L` read**. Like Heavy, that needs a fresh read from the 17 Nov
    containers, which waits on the usmap for that build.
  - **Update, late 23 Nov:** proof 1′ was approved. Three of the 15 pass it and rejoin in W1: `Casual_LowWedgeHeels`,
    `CrossPromo_NRSuitBelts` and `Military_PantsWithHolsterPouch`. `FromTencent_AsianSpiritBoots` fails on its
    inverse-bind matrices and stays out, listed. See [LIGHT-BULK-PLAN.md](LIGHT-BULK-PLAN.md).
  - The 15: `Casual_Bangles`, `Casual_LowWedgeHeels`, `Cowboy_HandCloth`, `CrossPromo_NRHarness`,
    `CrossPromo_NRSuitBelts`, `FromTencent_AsianSpiritBoots`, `Historic_SimpleBracelet`,
    `Military_PantsWithHolsterPouch`, `Military_WaistPouches`, `Pirate_ScallywagPants`, `Space_AstroPilotGloves`,
    `Space_AstroPilotGun`, `Space_AstroPilotPants`, `Streetwear_TechCropTopArmPouch` and
    `Streetwear_TechCropTopNoBags` (each `SK_<name>_L`).
  - Three meshes refused on 23 Nov are now skipped for the same reason: `CrossPromo_NRSuit_L`,
    `Space_AstroPilotGloves_H` and `Streetwear_BoilerSuitTorso_L`. That is why refused fell from 28 to 25.
- **Every skip is now listed.** Until 23 Nov the builder dropped these rows silently, so the 15 showed up only by
  diffing against the pins. It now puts every class mesh the definitions name in exactly one of `added`, `refused` or
  `skipped`. Each skip records its reason and the Medium mesh behind it, in `report.json` (`skipped`,
  `skippedCounts`) and `skipped.tsv`. It stops if a mesh lands in none, or in two.
  - Test: `python -I scripts/archetypes/test_build_archetype_index.py`.
  - Skips on b4f28192, Light (Heavy shows the same counts, plus 62 `class body not proven`):

    | Reason | Light meshes |
    | --- | --- |
    | medium sibling not staged (needs the bulk extraction) | 792 |
    | medium sibling repointed | 114 |
    | medium not in the active index | 89 |
    | already in the active index | 9 |
    | swap conflict | 1 |
    | already in the active index; swap conflict | 1 |

  - **"Repointed" means the index now serves a different Medium GLB than the staged one.** For 53 of the 114, the
    index serves it from `s12-bodytype-refresh-v1`, the 15 above included. The other 61 come from our own fix-wave
    folders (`reconstructed-w84-…`, `w139-…` and others); these were never in the Light set. Each skip row has the live
    `liveUrl`, so you can tell which is which.

## Checks (agent PASS under the standing waiver)

The user waived manual checks on all PRs (22 Nov). These are the agent's checks; see the PR body for the run on the
production build.

- **Tests:**
  - `tests/archetype-outfits.test.ts` (10) covers codes, the DA support table, links, library edit/kill/older tab/newer
    value, builder pick/reload, rolls, link exactness and the Worker.
  - `tests/rig/archetype.test.ts` (3) covers the DA class values, the bind-basis rule on a reoriented driver, and index
    validation.
  - The full suite shows only the 8 known worktree failures (fixtures that need gitignored GLBs).
- **Captures:** `scripts/archetypes/capture-classes.mjs` takes 5 outfits x L/M/H x 6 cameras (`captures-v1`, 90
  shots). I looked at them at full size; the findings are in the PR body.

## Limits

- **Classes:** Light comes only for its 78 proven meshes, and Heavy not at all yet (see the 17 Nov proof). Other items are left off on a class until the bulk
  extraction (below).
- **Body types:** Feminine stays hidden (agreed order: S12 refresh, then S12 body, then Feminine, then Light/Heavy).
  The class picker greys Androgynous on Light/Heavy, as the game does. Muscular types are not offered.
- **Squads:** squads (behind their own flag) still render Medium and don't carry the class.
- **Offset rules:** some Archetype TagOverrides move a piece rather than swap it (`bOffsetTransform`; 49 Heavy, 7
  Light, e.g. the demon wings on Heavy). The resolver refuses a non-identity offset as unsupported placement, so those
  items are left off on that class and named, like a missing mesh. Applying them needs the offset semantics: which frame
  they act in, and whether they compose before or after the socket offset.

See [APPLY.md](APPLY.md) for the index apply and [LIGHT-BULK-PLAN.md](LIGHT-BULK-PLAN.md) for the rest of Light (row
list, order, batches, commands; ready to start once a patched usmap passes its proof).
