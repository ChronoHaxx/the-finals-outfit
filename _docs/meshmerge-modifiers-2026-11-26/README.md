# MeshMergeModifiers in the 17 Nov 2026 build (research, 26 Nov 2026)

The coordinator asked about this after the S12 C1 drift finding: the 17 Nov build appends a
`Customization.Feature.MeshMergeModifiers` TagOverride to many item definitions. This was read-only, offline
research. Nothing in the app, the live index or public/models changed.

## Answers in brief

1. **Grant.** No game data I can read grants the tag. It appears only as the condition of one TagOverride in 105
   item DataAssets. It follows the same pattern as the runtime context tags (`Customization.FirstPerson`,
   `Customization.Quality.Frontend`, `Customization.Frontend.*`): items test for them and no data grants them, so the
   game adds them from code. **Verdict: code-granted, and it looks gated by a feature switch or experiment. Whether the
   switch is on for players cannot be read offline.** No sign of platform gating. The places that could settle it
   (Config/*.ini, Angelscript script caches, AssetRegistry) sit in the legacy .pak files. The saved key does not open
   them, so reading them needs a user action. Confidence: high that no asset grants the tag; on/off unknown.
2. **Meshes.** Yes: one suffix-less mesh plus a modifier stack serves all 3 classes × 5 body types.
   - The suffix-less mesh is the Medium bind shape without class morphs. It carries a per-mesh bake of the shared
     stack `MMS_BasicWrap`.
   - The stack has two modifiers. **UniformScale** applies 0.85 for Light and 1.15 for Heavy. `_L`/`_H` are exactly
     those scales of the suffix-less mesh, 0.0 cm, in all 10 families.
   - **WrapMorph** applies a body-type morph taken from one shared driver, `WMD_HoudiniWrapMesh`. Its rule table is
     identical to the `DA_BodyType_*` morph tables.
3. **Recommendation.**
   - Keep the feature off in our resolver, which renders `_M`/`_L`/`_H` as today.
   - Treat the appended rule as inert when checking drift.
   - Settle on/off with one of the two checks below before building anything.
   - A faithful "on" route needs the WRAP payloads decoded. Details in section 3.

## Build, tools and rules followed

- **Build.** 17 Nov 2026 (12.03.x). Every probe log says "Mounted 32 containers; 399699 files".
- **Mapping.** The pinned patched map v1 (`5.7.4-1432394+discovery_12.03.x-Discovery-w177patch-v1.usmap`, sha256
  `f36b7c4f…`), sha-checked before each run.
  - The window guard (`usmap_window_guard.py`) checks Material exports only. This research read no Material exports,
    so the guard has nothing to refuse here.
- **Decoded reads.** `scripts/generated/shader-probe/probe-bin-quality-v1/ShaderProbe.dll`, the same DLL
  `s12-definition-drift.py` uses.
  - `properties` mode: 105 item DAs, both MMS stacks, the body-type and archetype DAs, and the AstronautSuit.
  - `assets` mode: 40 meshes. It exports LOD0 only. The cooked LOD count comes from the colour evidence
    (`parsedLodCount`).
- **Raw byte reads.** A scratch reader built against the same probe DLLs (kept in the session scratchpad, not
  committed).
  - Its mount and key code is copied from `scripts/shader-probe/Program.cs`: `GAME_TheFinals`, and only this game
    directory's saved `mainKey` from FModel's AppSettings. The key is never printed, written or logged.
  - It lists paths, dumps raw package bytes and searches bytes. Raw reads consult no mapping.
- **Readers.** `zen.py` and `usmap.py` from `_docs/goal-100-2026-10-11/w177-panning-contract/usmap-patch-2026-11-23/`
  read the export maps and the native schema.
- **Data stayed local.** All reads were offline and in-memory from the game's own containers on C:. Outputs stayed in
  the session scratchpad. Only the JSON excerpts here are committed, and they contain no key material.

## 1. Who grants `Customization.Feature.MeshMergeModifiers`

Gameplay tag values serialize as FNames. A package that sets the tag anywhere (a DA, a blueprint CDO such as
`CharacterCustomizationComponent.ActorTagOverrides`, or a map actor) therefore carries the string in its name map.
`search-coverage.json` has the counts.

| Searched (17 Nov build, IoStore) | Packages | Result |
|---|---|---|
| Every data/blueprint package: DA, BP, WBP, DT, ABP, MABP, C, CT, UI, ST, GE/GA/GC, PDA, MMS, 1P/3P… | 61,389 (211 MB) | `Customization.Feature` only in 105 item DAs. `MeshMergeModifier` also in the two MMS stacks. |
| Frontend, menu, lobby, boot, practice and tutorial maps (41 .umap + 471 packages) | 512 | none |
| Case variants (`meshmerge`, `mesh_merge`, `WrapMorph`, `Feature.Mesh`, …) over both sets | 61,785 | Only item DAs, the stacks, and asset paths under `Characters/Avatar/MeshMerge/`. No flag string. |
| Name-map census of every DA | 44,942 | 225 distinct `Customization.*` tags. `Customization.Feature.MeshMergeModifiers` is the only `Customization.Feature.*` tag. |
| Character skeletal meshes (`/Discovery/Characters/**/SK_*`) | 3,804 (4.9 GB) | Modifier user data on 13 meshes: the 10 suffix-less meshes and `SK_Space_AstronautSuit_M/_L/_H` |

What grants the neighbouring tags:
- `DA_Archetype_Small/Medium/Heavy` grant `Customization.Archetype.Light/Medium/Heavy` (ActivatesCustomizationTag).
- `DA_BodyType_*` grant `Customization.BodyType.*`.
- Items grant their own `ActivatesTags`.
- Nothing grants `Customization.FirstPerson` (35 DAs test it), `Customization.Quality.Frontend` (43) or
  `Customization.Frontend.LocalPlayer`. The runtime adds those from context (first-person view, frontend). The feature
  tag is in the same position.

The native schema (pinned map) shows the machinery is C++ (Embark's `EmbarkMeshMerge` plugin):
- `EmbarkMeshMergeSubsystem` is a GameInstanceSubsystem with a merge request queue.
- `EmbarkMeshMergeRequest` carries `ActivationTags` (a GameplayTagContainer).
- `EmbarkMeshMergeModifierStack` is a DataAsset. Its modifiers are `UniformScale`, `WrapMorph`, `LocalBoneDeform` and
  `SkinningTransfer`, each entry with its own `ActivationTags`.
- `EmbarkMeshMergeModifierUserData` is AssetUserData: `Modifiers`, `ModifierStack`, `StackBakes`.
- `EmbarkMeshMergeWrapMorphDriver` has build settings and stats (welded vertices, "rotor" smoothing, deadband).

No DeveloperSettings property names the feature. `DiscoveryItemCustomizationSettings` has only `RandomizerSkinId` and
`RandomizerMaterial`. The excerpt is in `usmap-schema-excerpt.json`.

The game does have a string feature-flag system fed by its backend:
- `EmbarkGameControlMessage.FeatureFlagOverrides` (Map<Str,Bool>)
- matchmaking `FeatureFlags`
- `DiscoveryGameModeDataAsset.FeatureFlagName`
- `CharacterAudioData.RequiredFeatureFlags`
- `EmbarkTabDescriptor.FeatureFlag`

That system is one plausible source for the grant (a guess). No data package names a mesh-merge flag.

**Not readable here, so not searched:**
- **Legacy .pak files:** `pakchunk0-WindowsClient.pak` (374 MB, 17 Nov), `pakchunk0_s14` (19.7 MB) and `pakchunk0_s5`
  (65 MB) hold Config/*.ini (CVars, DeviceProfiles, gameplay tag ini), the Angelscript script caches and the
  AssetRegistry. The saved key opens only the 32 IoStore containers. Per the 29 Oct finding, these files need a
  second AES key that the user holds. I did not ask for it or look for it.
- **Native code:** the exe was not read, per the rules.
- **Backend flag values:** they are not on disk.

No GameFeature plugins, DataRegistries or gameplay-tag DataTables exist in the IoStore set: no package names match.

**Why "flag-gated" rather than "on" or "off":**
- The tag sits in a `Feature` namespace, and nothing in data grants it.
- The rollout is small: 10 base meshes and 105 items, all basic garments, including the starter set's T-shirt and
  pants.
- The stack is built to reproduce today's result. The scales match the authored `_L`/`_H` exactly, and the morph table
  matches `DA_BodyType_*` exactly.
- The packaging is a pure size saving. One 675 KB hoodie replaces `_M`/`_L`/`_H` at 1.27/1.23/1.87 MB.

That shape fits a switch that can ship dark or roll out gradually. It does not show which way the switch is set.

**Precedence (also undetermined).** The feature rule is the last TagOverride in all 105 DAs, after the
`Archetype.Light` and `Archetype.Heavy` rules. The stack's UniformScale rules only matter if the suffix-less mesh also
wins on Light and Heavy, so the intended precedence is "feature rule wins" (last-match-wins). That is an inference
from the data, not a decoded rule.

## 2. The suffix-less meshes

There are exactly 10 suffix-less siblings of `_M` meshes in the build. They are the 10 replacement meshes the 105 DAs
name. `feature-override-items.json` lists the items; `mesh-compare.json` has the numbers.

| Base (items) | LOD0 verts / tris | Sections | Cooked LODs | Bones | Utility morphs kept |
|---|---|---|---|---|---|
| Streetwear_Hoodie (38) | 4,182 / 7,298 | 1 | 5 | 40 | shrink_under_vest |
| StarterSet Pants (18) | 2,357 / 4,024 | 1 | 5 | 31 | shrink_pants_in_lowboots, _tallboots |
| StarterSet_TShirt (13) | 1,761 / 2,778 | 1 | 5 | 31 (`_M` 27) | shrink_under_vest |
| Streetwear_VarsityJacket (12) | 4,804 / 8,404 | 1 | 5 | 37 | none |
| Streetwear_BikerJacketHoodie (9) | 6,740 / 11,317 | 1 | 5 | 53 | bandolier_squeeze |
| Casual_OversizedSweater (5) | 3,015 / 5,304 | 1 | 5 | 55 | bandolier_squeeze, first_person |
| Streetwear_TankTop (4) | 2,545 / 4,378 | 1 | 5 | 38 | none |
| Historic_AnubisJewelry (3) | 1,291 / 2,304 | 1 | 5 | 21 | none |
| Streetwear_BikerJacket (2) | 5,694 / 9,358 | 1 | 5 | 53 | bandolier_squeeze, shrink_under_vest |
| Streetwear_TightSingletSportEvent (1) | 1,412 / 2,310 | 2 | 5 | 19 | none |

**Common to all 10:**
- Vertex and triangle counts, sections, material slots and LOD count are the same as `_M`, `_L` and `_H`.
- The Skeleton and PhysicsAsset are the `_M` ones (`…_M_Skeleton`, `…_M_Physics`).
- **No class morphs.** `_M` has `medium_female` and `medium_male`; `_L` has `light_female` and `light_male`; `_H` has
  `heavy_female`, `heavy_female_muscular`, `heavy_male` and `heavy_male_muscular`. The suffix-less mesh keeps only the
  utility morphs.
- **`_L` = suffix-less × 0.85 and `_H` = suffix-less × 1.15, exactly.** Positions and bone translations match with a
  maximum delta of 0.0 cm, and rotations are identical, in all 10 families.
- AssetUserData `EmbarkMeshMergeModifierUserData`:
  - `ModifierStack` = `MMS_BasicWrap`;
  - `StackBakes` = {`FB73E261…` → an inner `EmbarkMeshMergeModifierWrapMorph_0`}. The key is the stack's WrapMorph
    AuthoredId.
- **Size.** Hoodie 675,038 B against `_M` 1,266,544 B. `_M`'s two medium morph exports are 239,004 B each; the
  suffix-less bake export is 51,914 B (T-shirt: 23,456 B).

**Where the suffix-less mesh differs from `_M` (LOD0):**

| Family | Matches `_M`? | Matches `_L`/`_H` ÷ scale? |
|---|---|---|
| OversizedSweater, TankTop, TightSinglet | yes, except class morphs | yes |
| Hoodie | Positions and weights yes. **UVs no:** `_M` UV0 is the same UV0 shifted by whole U tiles (−2…+2 on 3,960 of 4,182 vertices), and `_M` has a UV1 set the suffix-less mesh lacks. | yes (wrapped UV0, no UV1) |
| Pants | Same point set within 0.23 cm, but a **different vertex order**, and weights differ on 887 of 2,357 vertices (≤ 0.05) | yes |
| T-shirt | Positions yes. **Bones no:** the suffix-less mesh has 31 bones (adds calf_l/r, lowerarm_l/r), `_M` has 27. Weights differ on 1,049 of 1,761 vertices (≤ 0.06), and the UVs differ. | yes |
| VarsityJacket | Index buffer yes. Weights differ on 1 vertex. | Weights yes; **index buffer no** |
| BikerJacket, BikerJacketHoodie | yes (2 UV sets, weights) | **no:** `_L`/`_H` have 1 UV set, and BikerJacket weights differ on 4,122 of 5,694 vertices (up to 0.47) |
| AnubisJewelry | Vertex colour **R is 0 on every vertex** (`_M`: 255) | yes |

So the suffix-less mesh is a fresh export of the Medium source. Sometimes it carries `_M`'s newer data (biker
jackets) and sometimes the older data `_L`/`_H` still carry (hoodie UVs, the T-shirt and pants weights).

**Lower LODs.** The probe exports LOD0 only. LODs 1-4 were not compared beyond their count (5 = 5).

**The stack (`modifier-stacks.json`).** `MMS_BasicWrap` holds:
- `UniformScale`: Heavy 1.15, Light 0.85.
- `WrapMorph` with Driver `WMD_HoudiniWrapMesh` and 14 rules keyed by (Archetype, BodyType):

| BodyType | Light | Medium | Heavy |
|---|---|---|---|
| Masculine / MasculineMuscular | light_male | medium_male | heavy_male / heavy_male_muscular |
| Feminine | light_female | medium_female | heavy_female |
| FeminineMuscular | light_female | medium_female | heavy_female_muscular |
| Androgynous | light_female | (none, bind shape) | heavy_female |

This table equals the `DA_BodyType_*` `Activates{Light,Medium,Heavy}MorphTargets` exactly. All rules have
Inflate 0.0.

**The driver and bake payloads (partly decoded, by hand, unverified beyond what is listed).**
- `WMD_HoudiniWrapMesh` is one export of 1,391,782 B with no tagged properties. Native payload:
  - magic `WRAP`, version 1, payload size 1,391,760;
  - 32,616 u32 indices (10,872 triangles over 5,436 vertices);
  - 5,436 positions: a full body in A-pose, x ±67.7, z −0.3…184.7 cm;
  - 5,436 normals;
  - 8 morph blocks of 141,352 B each (FName + 5,436 records of about 26 B). Their inner layout is not decoded.
  - Its name map holds the 8 class morph names.
- The per-mesh bake (hoodie): magic `WRAP` v1, a payload size of 51,434 B, the value 5 (probably the LOD count),
  the LOD0 vertex count 4,182 twice, then small integer data. That is about 12 B per LOD0 vertex (T-shirt about 13),
  consistent with a binding of each garment vertex to a driver triangle (a guess; not decoded).

**Conclusion.** This is the "mesh merge modifier" path. At merge time the game takes one suffix-less mesh, applies the
archetype scale, and deforms the mesh by the body-type morph of a shared body-wrap driver, through the mesh's baked
binding. The per-archetype `_L`/`_H` meshes and the authored per-garment class morphs are not used on this path.

**Another stack in the build, not behind the feature tag in data.** `MMS_JacketWristCompatability` is on
`SK_Space_AstronautSuit_M/_L/_H`. It was already present in the 6 Nov 12.00 read
(`_docs/body-types-s12-refresh-2026-11-06/s12-read`). When `Customization.Slot.Wrists` is active, it:
- scales `lowerarm_l` by X 0.85, descendants included;
- moves the skinning of `lowerarm_vpj_03_l`, `lowerarm_vpj_04_l` and `hand_l` (descendants included) to
  `lowerarm_vpj_02_l`.

Whether the modifier stage runs without the feature tag is unknown. Our viewer applies neither.

## 3. What changes if the feature is on, and the recommended route

Our resolver puts `Customization.Archetype.<class>` plus item `ActivatesTags` in context (`src/rig/SourceAssembly.ts`
via `ARCHETYPE_TAGS`). It never adds `Customization.Feature.*`, so today it renders `_M`/`_L`/`_H`. If the tag were
added as it stands, Light and Heavy would get two matching single-tag mesh rules with different meshes, and the
resolver would refuse them ("conflicting mesh overrides").

If the feature is on in the game, the 105 items change as follows:
- **Medium.**
  - The bind geometry equals `_M` (Pants within 0.23 cm, reordered).
  - The body-type shape comes from the driver's `medium_*` morph instead of the garment's authored one. Androgynous
    gets no morph either way.
  - The attributes follow the suffix-less column above: hoodie UVs without UV1, the older T-shirt and pants weights,
    the T-shirt's 31 bones, Anubis vertex colour R = 0.
  - Note for C0: on this route, a Medium player's T-shirt uses the suffix-less weights and UVs (the ones `_L` carries
    today), not the S12 `_M` the C0 refresh moved to.
- **Light and Heavy.**
  - The bind equals today's `_L`/`_H` exactly.
  - The shape comes from the driver's `light_*`/`heavy_*` morphs.
  - The biker jackets would gain `_M`'s UV1 and weights, which `_L`/`_H` lack today.
- **Unknown in every class:** how far the driver-wrap morph is from the authored morph. Measuring it needs the WRAP
  payloads decoded.

**Recommendation.**
1. **Keep the feature off** in the resolver. No data grants it, and today's route is what the items look like if the
   switch is off.
2. **Treat the appended rule as inert in drift checks** (coordinator's call; it changes a gate).
   - Drop exactly this rule shape from the comparison: a single tag `Customization.Feature.MeshMergeModifiers`,
     mesh-only, last in the list, replacement = the base mesh's suffix-less sibling.
   - Then an item whose only change is the appended rule counts as unchanged for the off route.
   - This does not cover other S12 changes in the same item.
3. **Settle on/off before building anything.** Either check works:
   - (a) The user opens the legacy .pak with the second key, and the coordinator relays the result. A read-only
     search of Config/*.ini and the Angelscript cache for `MeshMergeModifiers` would show the grant.
   - (b) An in-game look that separates the routes on Medium, using an item whose suffix-less and `_M` attributes
     differ visibly. Candidates: a hoodie skin whose layers read UV1, or the starter T-shirt print. First check with
     two of our own captures that the difference is visible.
4. **If the feature is on, the faithful route is suffix-less mesh → UniformScale → WrapMorph through the bake.**
   - That means decoding `WRAP` v1 (driver and bakes) and reproducing the transfer.
   - The transfer's rotation ("rotor") smoothing and deadband are native code, so an exact match is not guaranteed even
     with the data decoded.
   - Interim approximation: the suffix-less attributes plus the sibling's authored class morph on the same topology
     (Pants needs a vertex remap). It is off by an unmeasured amount: the authored morph minus the wrap morph.
   - This also needs the resolver precedence (feature rule wins over Light and Heavy) agreed first.

## Files

- `feature-override-items.json`: the 105 DAs, base and replacement mesh, rule position.
- `modifier-stacks.json`: both stacks decoded, the body-type morph tables, the hoodie's and AstronautSuit's user data.
- `mesh-compare.json`: the per-family LOD0 summaries and pairwise comparisons (unscaled and scaled).
- `usmap-schema-excerpt.json`: the native schema for the EmbarkMeshMerge classes, TagOverrides and BodyType.
- `search-coverage.json`: what was searched, the counts, and what matched.

## Reproduce (Git Bash, any folder; outputs to an empty folder of your choice)

```bash
# Git Bash. Decoded read of a request list with the pinned map, exactly as s12-definition-drift.py calls the probe.
R=E:/Coding/the-finals-outfit
USMAP=$R/scripts/generated/shader-probe/tools/5.7.4-1432394+discovery_12.03.x-Discovery-w177patch-v1.usmap
sha256sum "$USMAP"   # must start f36b7c4f
dotnet $R/scripts/generated/shader-probe/probe-bin-quality-v1/ShaderProbe.dll properties \
  'C:\Program Files (x86)\Steam\steamapps\common\The Finals\Discovery\Content\Paks' "$(cygpath -w "$USMAP")" \
  'C:\Users\ChronoHax\Downloads\c515634f862cc7387d845d327dac2f85a1456104\Output\.data\oodle-data-shared.dll' \
  "$(cygpath -w "$OUT")" "$(cygpath -w requests.json)" "$(cygpath -w "$APPDATA/FModel/AppSettings.json")"
# Use `assets` instead of `properties` for meshes (LOD0 + morphs + bones).
```
