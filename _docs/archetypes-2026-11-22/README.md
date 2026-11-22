# Light and Heavy contestants (22 Nov 2026)

The user (22 Nov): "do light and heavy body size too". Visitors pick Light, Medium or Heavy, and every piece the viewer
shows on a class is the game's own class data. Nothing is approximated: an item whose class mesh is not extracted yet
is left off on that class and named, and the outfit keeps it.

Branch `claude/jovial-fermat-65dc6d`. Behind a flag until the class meshes are hosted (see "Flag" below).

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
- **Heads stay full size.** No head has a class override. Unreal's leader pose skins every follower with its own
  ref-pose inverse against the leader's bones, so a Medium-authored mesh rides the class skeleton rigidly, at full size.
  This applies to the head, and to hair or hats with no class mesh. A class-authored mesh fits exactly.
- **Sockets.** Sockets live only on `SK_CharacterMeshMergeTarget_Skeleton`. A socket keeps its Medium relative
  transform and rides its (moved) bone. The body type DA's `SocketOffsetLight` / `SocketOffsetsHeavy` compose on the
  right.
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
  - Class-authored meshes bind to the class rests, Medium-authored ones to the Medium rests.
  - Anything else is refused, with a named error.
- **Notice.** "Not on Light yet: … Their Light meshes aren't extracted yet, so they're left off; your outfit keeps
  them." The saved outfit and the share link still hold every item.
- **Saving and links.**
  - `archetype` is a known field of saved outfits. An absent value means Medium, and writers keep fields they don't
    know.
  - Links carry `ar=l` / `ar=h`; Medium has no parameter, so every older link still opens unchanged.
  - The share Worker stores and re-emits `ar`. The app refuses a short link if the Worker dropped it, so a
    not-yet-deployed Worker can never silently turn a Heavy share into a Medium one.
- **Flag.** `finals-archetypes:preview` in localStorage, set by `?archetypes=on` and cleared by `?archetypes=off`. It is
  on in dev. The picker shows only the classes the index carries (`assets.json` `archetypes`). So production shows
  nothing new until the index apply lands, even with the flag on.

## The index: 86 Light and 87 Heavy meshes, proven

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
- **Buildable items:** about 1,049 Light and 1,018 Heavy items have no class swap or only proven ones
  (`scripts/generated/archetypes/preview-v1/available-items-approx.json`). Statics and heads need none.
- **Refused, 11 meshes, with a reason each** (in `report.json`). Each is a reshaped class mesh that needs its own masks:
  - indices or UVs differ: `HeadPhonesAntennaPart_L`, `NRSuit_L`, `Racing_Gloves_L/H`, `AstroPilotGloves_H`;
  - vertex count differs: `AmmoBackpack_L/H`, `PoetShirtWithVest_L/H`, `CordBracelet_L`, `PioneerUpper_H`.
- **Skipped:** `SK_Goth_M`, because the definitions disagree about its class mesh.
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
- **Light can go ahead.** It uses the proven Light meshes only. The builder still needs an option that takes the
  proven list; the index outputs from before this proof (`preview-v1`, `apply-v1`) include the dropped meshes.
- **Medium (for information):** 77 Medium siblings the live index serves also changed on 17 Nov. That is for the S12
  refresh to handle.

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

- **Classes:** Light/Heavy come only for the 173 proven meshes. Other items are left off on a class until the bulk
  extraction (below).
- **Body types:** Feminine stays hidden (agreed order: S12 refresh, then S12 body, then Feminine, then Light/Heavy).
  The class picker greys Androgynous on Light/Heavy, as the game does. Muscular types are not offered.
- **Squads:** squads (behind their own flag) still render Medium and don't carry the class.
- **Offset rules:** some Archetype TagOverrides move a piece rather than swap it (`bOffsetTransform`; 49 Heavy, 7
  Light, e.g. the demon wings on Heavy). The resolver refuses a non-identity offset as unsupported placement, so those
  items are left off on that class and named, like a missing mesh. Applying them needs the offset semantics: which frame
  they act in, and whether they compose before or after the socket offset.

See [APPLY.md](APPLY.md) for the index apply and [BULK-EXTRACTION.md](BULK-EXTRACTION.md) for the rest.
