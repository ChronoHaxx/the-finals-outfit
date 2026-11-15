# Route review: how to ship the Season 12 body-type shapes (6 Nov 2026)

An advisory second opinion on the three routes at the end of `README.md` section 6, followed by the agent's checks of
its factual claims. It is advice only: the route, the production shape change and any merge stay the user's decisions.

**Consultation.** On 6 Nov the agent sent Claude Fable 5.1 (xhigh effort) the batch README and the rig's morph mechanics,
and asked for a review of route 2, the outfit-level fallback. Thread `fd5957c6`; about $0.97.

## The advice

1. **Route 2, but asymmetric.**
   - The outfit-level fallback is needed only for `medium_female`, because only the body's `medium_female` changed in
     S12.
   - For `medium_male`, the pre-S12 and S12 garment sculpts were both made against the same body morph, so either one
     fits the body. Use the S12 target per mesh, with no fallback.
   - With the symmetric rule as planned, production masculine would pop the municipal pants 1.81 cm whenever a pre-S12
     tee is equipped, for no benefit.
   - So route 2 becomes a strict superset of route 3 (masculine-only now), and route 1 (the item refresh) becomes how
     the fallback set shrinks, not a blocker.
2. **Granularity: whole outfit is right.** There is one body with one `medium_female`, so the decision is "which body
   sculpt", and every garment must agree with it. Count the *visible* resolved meshes, not the loaded ones: a hidden
   context variant must not force the fallback.
3. **Decide from index metadata, not from the loaded morph dictionaries.**
   - Give each mesh and morph a flag in the index: `same` (the live deltas already equal S12), `both` (an `_s12` target
     is baked in) or `pre` (a blocker).
   - The decision is then known before any download. Each mesh gets its final morph name when it arrives, with no "S12,
     then snapped to live" flicker.
   - Keep the dictionary check as a dev assertion.
4. **Bake only what changed**, with normal deltas. On a multi-primitive mesh, append the target to every primitive.
5. **Switch atomically.** Zero `medium_female` in the same pass that sets `medium_female_s12`. Test the name switch
   itself, not only the body-type switch.
6. **Untested masculine direction.** An S12 top whose `medium_male` moved a lot (the football hoodie, 2.55 cm) over
   pre-S12 pants. c1–c3 only tested pre-S12 tops over S12 pants.
7. **The 11 live-derived and 32 no-copy meshes may be graftable.** Prove positions and indices against the processed
   live GLB, ignoring only the attribute our pipeline changed.
8. **Snap, don't blend, the pop.** Blending two sculpts gives a shape that fits neither. In dev mode, show which
   visible mesh forced the fallback.

## Agent checks of those claims

| Claim | Result |
|---|---|
| Check whether a fitting morph changed too | **True, and it matters.** In the 681 morph-only meshes, three non-body-type morphs changed (table below). |
| Morph targets carry normals | **True.** Live and S12 `SK_Body_M.glb` targets have `POSITION` and `NORMAL`, so a bake must include normal deltas. |
| Multi-primitive meshes | Already covered: the 112 multi-primitive meshes share one vertex buffer and one target set (`README.md` step 3). The rig applies names to every primitive mesh it loads (`CharacterRig.ts`, part loop). |
| Atomic switch | `SourceFitting.apply` tracks weights by target index and restores any index it no longer sets. `reapplySourceFitting` runs it over the whole outfit in one traversal, so a name switch is atomic per frame. Not yet covered by a test. |
| three.js version | 0.184.0: WebGL2 only, with morph textures and no 8-target limit. The body already has 33 targets. |
| "288 files" to bake | **287.** That is every morph-only mesh with any changed delta, including the body. |
| "Masculine cannot see the body swap" | **False.** The S12 body's `push_lower_torso` changed (row 1 below). Fitting morphs are on in production (`CharacterViewer.tsx`, `sourceFitting: true`), so it applies in all three body types. |

Non-body-type morphs that changed in S12 among the morph-only meshes:

| Mesh | Morph | Max change | Applied in the app when |
|---|---|---:|---|
| `SK_Body_M` | `push_lower_torso` | 0.79 cm | any of 148 items is worn that activates `PushInsideClothes.push_lower_torso` (for example every basic tee), in **every** body type |
| `SK_Medieval_WizardPants_M` | `shrink_pants_under_skirt` | 1.28 cm | the wizard pants are worn with one of the 8 skirt or knight items that activate it |
| `SK_Streetwear_CropHoodie_M` | `first_person` | 0.25 cm | never: the app does not decode `first_person` |

Consequences:
- The statement "androgynous is identical to live" holds only for androgynous's own body-type morph. Under the 148
  `push_lower_torso` items, the S12 body's lower torso moves up to 0.79 cm in every body type.
  - Reviewed outfits that activate it looked identical to live in androgynous: the bare-shoulder sweater (a3) and the
    basic tee (b1, c3). Masculine b1 and c3 also looked identical.
  - A push morph moves skin inward under clothing, so the change is mostly hidden, but this is not proven for every
    item.
- Any fallback must cover these morphs too. The fallback branch has to keep the live `push_lower_torso` and
  `shrink_pants_under_skirt`. The S12 branch uses the S12 ones, baked as `_s12` targets.
- Asymmetric masculine rule, counted over all 681 proven meshes: 188 change `medium_male`, 135 by more than 0.1 cm and
  49 by more than 1 cm. The merge candidate had 83 and 28. Production masculine would see more shape change than the
  candidate.

## Also found during this check

**The active index moved.**
- `public/models/reconstructed-assemblies-v1/assets.json` is now sha256 `acdb9897…`, not the `ae2c1ac0…` this batch was
  built on. The file was rewritten on 6 Nov at 14:59 local time, the same day PR #20 and PR #23 merged into `main`.
- `merge-patch-v1.json` and `index-v3` are therefore stale. Do not apply them.
- Any route needs the rebuild in `HANDOFF.md` ("If the active index moved"). Route 2 also needs the baked `_s12`
  targets and the index flags described above.

## What this changes in the recommendation

Route 2 with the asymmetric rule is the agent's recommendation. Three decisions belong to the user:
1. Accept the production masculine shape change: 135 meshes move more than 0.1 cm. The body's `push_lower_torso` change
   also applies to masculine.
2. Accept that feminine stays gated, and snaps back to live shapes when a pre-S12 item enters the outfit.
3. Accept the body URL change and a new folder of 287 baked files, rebuilt on the current index.

Before route 2 is built, add captures of:
- the untested masculine direction;
- the wizard pants under a `shrink_pants_under_skirt` skirt, in androgynous and masculine.

`push_lower_torso` is already covered by a3, b1 and c3.
