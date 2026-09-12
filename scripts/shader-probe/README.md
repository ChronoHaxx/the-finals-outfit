# Shader extraction and reconstruction probe

For the proposed broader execution order, including mesh preservation and outfit
culling, see [the reconstruction plan](../../RECONSTRUCTION_PLAN.md).

Read-only extraction of a bounded THE FINALS material family using the same parser
library as FModel. Game files and FModel settings are never modified. All extracted
game data belongs under the ignored `scripts/generated/` directory.

The probe exports `M_Character_Layered`, `MI_Character_Layered_2`, and the black
leather, camo and satin long-coat instances. It selects the `Num` quality
`TGPUSkinVertexFactoryDefault` / `TBasePassPSFNoLightMapPolicy` shader for SM5 and
SM6, matches its `ResourceHash` to an IoStore shader library, reads the referenced
shader group, decompresses it, and validates the DirectX container boundaries.
The black coat inherits the two-layer parent's shader.

Requirements: .NET 10 SDK, Python 3.10+, Windows SDK FXC/DXC, a mapping that matches
the installed game, and an existing compatible Oodle decompression library. The
CUE4Parse package is pinned to `1.2.2.202609`; the direct Microsoft.Bcl.Memory pin
avoids its transitive vulnerable 9.0.0 dependency.

From the repository root:

```powershell
dotnet run --project scripts/shader-probe -- `
  '<game>/Discovery/Content/Paks' `
  '<matching-mapping>.usmap' `
  '<FModel-output>/.data/oodle-data-shared.dll' `
  'scripts/generated/shader-probe/my-run' `
  "$env:APPDATA/FModel/AppSettings.json"

./scripts/shader-probe/validate.ps1 -Exports scripts/generated/shader-probe/my-run
```

The final FModel settings argument is optional. If supplied, only the archive key
for the matching game directory is used; it is neither printed nor copied into
outputs. The output directory must be empty, and cannot be inside the input game
container directory. Each run preserves its source container and mapping hashes.

`validate.ps1` checks output hashes, disassembles all requested shaders with Microsoft's
tools, and runs `inspect-bindings.py`. The Python decoder verifies the embedded
material resource-layout hash, decodes the observed preshader subset, maps texture
slots, and checks every SM5 material-buffer component reference against decoded
fields. Unsupported formats/opcodes fail explicitly. Output includes a report,
machine-readable provenance/validation, and assembly annotated with material
parameter names. The extraction/binding tools are separate from the surface
translator and runtime preview described below.

## Result on 8 September 2026

Tested against locally installed Steam build **24952141**, with
`507_TheFinals_21_08_26.usmap`. Eight shaders were extracted and disassembled;
material buffer component coverage was complete for all four SM5 shaders. The
master, two-layer parent, camo and satin have 77, 136, 159 and 177 decoded uniform
fields respectively, and 14, 14, 16 and 18 material texture bindings.

Stock retoc 0.1.5 failed on the game's custom chunk types. Reading IoStore directly
through CUE4Parse worked, so conversion to a legacy pak is unnecessary for this
probe. Quon's HLSLDecompiler 0.2 asserted on the first SM5 shader; that process was
stopped and is not part of the validated workflow. FXC and DXC both succeeded.

## Recovered surface preview

`build-materials.py` evaluates the observed numeric preshader operations with
master/parent/instance overrides. `sm5_slice.py` converts register components into
typed expressions, removes dead dependencies, and emits GLSL for base colour,
tangent-space normal, roughness, metalness, specular and AO. It selects material
values before Unreal's view overrides and G-buffer packing. Unsupported live
instructions, unresolved engine inputs and ambiguous output anchors fail the build.

The black coat uses its two-layer parent's shader; camo and satin use their own
permutations, including decal blending. The three generated shaders retain 582,
830 and 873 scalar/vector nodes and 8, 11 and 12 texture bindings respectively.
Unused texture paths disappear when their instance strengths are zero. Detail UV1,
macro UV0, encoded normal rotation, layer IDs, crease/edge blending, pattern colour,
decal normals and authored roughness values come from the disassembled operations.
There are no fitted colours, arbitrary roughness floors or suppressed normals in
this generated material path.

`collect-textures.py` resolves defaults and instance overrides into a JSON array
of object paths. It collects every binding before slicing, including four engine
effect/debug textures that the current surface does not use. Texture mode exports
every cooked mip with hashes and resolves plugin content by a unique full path suffix:

```powershell
python scripts/shader-probe/collect-textures.py `
  --exports scripts/generated/shader-probe/my-run `
  --output scripts/generated/shader-probe/texture-requests.json

dotnet run --project scripts/shader-probe -- textures `
  '<game>/Discovery/Content/Paks' '<matching-mapping>.usmap' '<oodle.dll>' `
  'scripts/generated/shader-probe/textures-run' `
  'scripts/generated/shader-probe/texture-requests.json' `
  "$env:APPDATA/FModel/AppSettings.json"

python scripts/shader-probe/build-materials.py `
  --exports scripts/generated/shader-probe/my-run `
  --textures scripts/generated/shader-probe/textures-run `
  --output public/models/reconstructed
```

The builder requires Pillow with BC1/3/4/5/7 decoding. It decodes the original
blocks to RGBA8 without resizing, packs all mip levels and array slices, and keeps
the texture's sRGB flag. These generated game assets stay in ignored directories.
The `.rgba.gz.bin` payload suffix prevents automatic `.gz` decoding by the dev
server. Runtime checks verify both shader and uncompressed texture hashes.

Run the dev server and add `?reconstructed=1` when equipping one of the three coats.
`&surface=baseColor|normal|roughness|metalness|ao|specular` selects inspection views;
`&isolate=1` shows only the coat. The preview controls expose the same options.
Production builds keep the existing material path. Required source data lives
locally and is not included in tracked source files.

## Validation and remaining fidelity work

```powershell
python scripts/shader-probe/test_translation.py --exports scripts/generated/shader-probe/my-run --materials public/models/reconstructed
node scripts/shader-probe/check-webgl.mjs scripts/generated/shader-probe/my-run/translation-fixtures.json
node scripts/shader-probe/render-preview.mjs
node scripts/shader-probe/render-preview.mjs --baseline
node scripts/shader-probe/render-preview.mjs --isolated
node scripts/shader-probe/check-integration.mjs
npm run build
```

The numerical test requires NumPy. An independent forward register interpreter
executes the original assembly with constant texture samples. Its surface outputs
match the sliced expressions across 36 cases: three materials, two layer IDs, six
UV combinations including negative coordinates and all four encoded rotations.
The emitted GLSL is then rendered into float targets and compared against those
reference values. Maximum observed absolute error: **0.00000190735**. This checks
the translated surface arithmetic on those fixtures, not the original DXBC on a
Direct3D device, all possible parameters, or real-texture filtering equivalence.

All 15 full-character lit/colour/normal/roughness/metalness render checks passed
without browser or GPU errors. Baseline and isolated renders also passed. The
older satin preview shows the same underlayer/body clipping; it is a rig issue
still present in the assembled character, separate from these surface calculations.

All 15 integration checks passed: in-page coat changes, texture disposal, retaining
the current outfit when changing a view, AO/specular views, isolation, lighting
changes, superseded loads, and visible errors/recovery for missing textures and
shader/texture hash mismatches. This exposed and fixed URL-state loss and overlapping
equip loads. Superseded loads are discarded before their meshes enter the scene;
their textures are released. Failed loads remain retryable on the next build change.

A fresh extraction of all 21 automatically collected texture objects and a rebuild
produced runtime files identical to the preview's existing shader, manifest and
texture files. The request collection step therefore requires no manually curated
texture list for this material family.

The current preview uses Three's BRDF, environment lighting, tone mapping and
geometric roughness adjustment. It maps Unreal's `Specular` to dielectric F0 as
`0.08 * Specular`. Shared sampler/scalability settings are not recovered; preview
sampling is trilinear. Original mip contents and colour spaces are retained, but
RGBA8 decompression and different graphics APIs can differ in filtering precision.
Disassembly prints rounded immediate constants, so this is not a bit-exact port.

The recovered coats now use fresh source geometry with original tangents, morphs
and all skin weights (see below). `&sourceMeshes=0` keeps the earlier mesh for
comparison and derives its tangent frame from geometry and UV0. Complete original
vertex-factory behaviour, body occlusion/underlayers, cloth simulation, spawn/damage/thermal effects and the full
Unreal rendering environment are not reconstructed. View-dependent cloth specular
is supported by the later shared extension below; active emissive instances remain
explicitly rejected by this bounded builder. Original
editor graphs/readable source are not restored. SM6 remains an extraction and
disassembly result, not the runtime implementation.

Matched in-game views under known lighting and poses are still needed to measure
visual fidelity before replacing the normal viewer path.

Sources: [CUE4Parse](https://github.com/FabianFG/CUE4Parse),
[UEShaderMapExtractor](https://github.com/WistfulHopes/UEShaderMapExtractor),
[FShaderResourceTable](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/RHI/FShaderResourceTable),
[SM5 texture sampling](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/sample--sm4---asm-),
[mapping post](https://discord.com/channels/637265123144237061/1090611236045062175/1540444395319459930).

## Source mesh and customization foundation

The CLI now supports `inventory`, `properties`, `assets` and `materials` modes in
addition to the original shader and texture probes. Each accepts the same game,
mapping, Oodle, empty output-directory and optional FModel-settings arguments.
All modes except `inventory` take a request JSON argument before the settings.
New runs record mapping/parser details and source-container TOC hashes in
`source-run.json`. Material mode accepts an array of object paths or the path/count
object emitted by the source-index builder.

Shader-mode requests accept exact asset basenames or full
`Discovery/Content/.../Material.uasset` package paths. Use full paths when different
packages share a basename. Output manifests still use basenames, so two requested
materials with the same basename must be extracted into separate run directories;
the tool rejects that collision before writing material exports.

1. Run `inventory` to write `packages.json`, then select definition candidates:
   `python scripts/shader-probe/collect-definitions.py --packages <inventory>/packages.json --output <requests.json>`.
2. Run `properties` with that request file. This decodes tagged properties without
   expanding shader maps or exporting mesh buffers. Duplicate package basenames
   get stable path-hash suffixes, and the extraction index records each filename.
3. Build the catalog relationship index:
   `python scripts/shader-probe/build-source-index.py --definitions <properties-run> --output <new-index-directory>`.
   The generated `catalog.json` and `items/` directory are the runtime input. Full
   decoded relationships, body-type definitions and explicit unresolved IDs are
   retained separately in the same directory.
4. Run `materials` with the index's `material-references.json`, then
   `python scripts/shader-probe/summarize-materials.py --inventory <material-run>/materials.json --output <material-run>/coverage.json`.
   This records recursive parents and shader identities from the IoStore archives;
   no shader group decompression is needed merely to identify shared bytecode.
5. Run `assets` with a JSON array of exact mesh asset names or full provider package
   paths. Then convert and verify the selected source set:

```powershell
python scripts/shader-probe/build-meshes.py --inputs <source-mesh-run> --output <new-mesh-directory>
python scripts/shader-probe/verify-meshes.py --source <source-mesh-run> --meshes <new-mesh-directory>
```

`AssetExport.cs` preserves the decoded UE data before coordinate conversion,
vertex merging, material baking or influence reduction. `build-meshes.py` writes
GLB directly from those records. It converts `(X,Y,Z)` centimeters to `(X,Z,Y)`
meters, retains the source clockwise index order under that reflection, and
negates the source normal-W sign for glTF tangent handedness. It normalizes XYZ
separately from W. Morphs use their original vertex indices; normal deltas are
scaled consistently with the base normal so arbitrary morph blends retain their
direction. The exact decoded values remain in the source JSON. No skin influences
are dropped: meshes exceeding eight fail explicitly. GLB materials are named
placeholders with original slot metadata; they do not reconstruct appearance.

`SourceMesh.ts` preserves both weight sets through GLTFLoader's four-weight
normalization and uses eight weights for visible, normal/tangent, shadow and CPU
picking/bounds deformation. Fresh coats bind against the legacy driver's recorded
neutral pose because Blender changed the bone axes. Equipping while already posed
and repeated A/idle transitions are covered by the pose check.

`SourceAssembly.ts` keeps source part resolution independent of rendering. The
current runtime applies unambiguous whole-item hiding, including attached
statics, and restores their original visibility when conditions disappear. A hidden
item's body-coverage mask is excluded until the item becomes visible again; other
covering items retain their masks. The pose harness checks this mask routing. Occupied
slots never become hide masks. Multi-tag mesh conditions and conflicting matching
replacements remain unresolved pending verification of the game's matching and
priority semantics. The three coats also assemble all their supported source parts
and material slots; their authored tops suppress a conflicting extra BodyUpper
selection without deleting it. Broad replacement coverage, automatic morph weights,
attachments and dynamic logic remain incomplete. `&sourceAssembly=0` disables this
source-based assembly/hiding for comparisons.

The current development preview reads `public/models/reconstructed-meshes-v2`
and `public/models/reconstructed-assembly-v2`. All generated outputs remain ignored.

```powershell
# Synthetic checks: source code plus the local dev server; no game assets needed.
node scripts/shader-probe/check-source-skinning.mjs
node --import tsx scripts/shader-probe/check-source-assembly.mjs --synthetic-only

# Integration checks with the local extracted assets.
node --import tsx scripts/shader-probe/check-source-assembly.mjs
node scripts/shader-probe/check-source-coat-poses.mjs
```

Observed results: 2,859/2,866 catalog IDs resolved; 12 meshes/92,416 vertices/72
morphs verified; 18 GPU/CPU skinning fixtures passed (maximum error 4.78e-8);
seven source-assembly browser cases passed, including malformed-data recovery.
The material inventory contains 4,020 records, 87 root families and 264 distinct
compiled pixel shaders for the explicitly selected SM5 pass. There are 101 records
without that selected pass, which is not necessarily a parsing failure. Counts
describe this inventory's scope, not finished rendering coverage.

## Complete coat assemblies

The current recovered development preview assembles the two source parts of black
and satin, and all four parts of camo. `build-assembly-assets.py` indexes preserved
meshes and reconstructed materials by exact UE object paths. Native material slot
names determine overrides; filename similarity is not used. The rig stages the
whole assembly before replacing the current one, rebinds every part to the recorded
neutral skeleton and releases superseded/failed batches. Occupied BodyUpper slots
suppress an extra selected shirt and its tags until the coat is removed. A failed
coat replacement keeps the previous complete coat and its fitting state.

The extraction and build tools now accept explicit batches. The `shaders` mode
takes a JSON array of exact unique material names, including required parents.
Material builders accept an optional `--requests` JSON array of `{ "id": "runtime-id",
"instance": "MI_ExactSourceName" }` records. `material_inputs.py` resolves the actual
parent chain and nearest selected shader owner; unsupported root families fail.
Omitting these options preserves the original three-coat workflow.

The companion batch resolves 13 material assets, six shader owners (12 SM5/SM6
bytecodes) and 56 bound texture objects before slicing. Eight material instances
are translated. The one-, two-, three- and eight-layer permutations in this batch
all belong to **M_Character_Layered**. The separate root
**M_Character_8Layers_Master** was added in the reference-outfit pass below.

Three companion instances activate `_ShadeAsCloth`. Their original material code
blends a view-dependent expression into Specular. The translator preserves that
expression and supplies the camera vector in the garment's tangent frame, using a
unique checked camera-vector anchor. It does not substitute Three's sheen lobe.
The independent reference interpreter evaluates the original world-space operations
in rotated frames, at different viewing angles and layer IDs. 126 CPU and 126 GPU
fixture comparisons pass; the original coat GLSL and texture payloads are unchanged.
This verifies sampled arithmetic, not the full Unreal lighting response.

The current runtime index is `public/models/reconstructed-assemblies-v1/assets.json`.
After building the requested material files into that directory:

```powershell
python scripts/shader-probe/build-assembly-assets.py `
  --meshes public/models/reconstructed-meshes-v2 `
  --materials public/models/reconstructed-assemblies-v1 `
  --exports scripts/generated/shader-probe/coat-assembly-shaders-v1 `
  --legacy scripts/asset-sources.generated.json `
  --output public/models/reconstructed-assemblies-v1/assets.json

node scripts/shader-probe/check-complete-assemblies.mjs
node scripts/shader-probe/check-source-coat-poses.mjs
node scripts/shader-probe/render-assembly-fits.mjs
```

`build-companion-masks.mjs` optionally generates geometry-derived coverage masks
for these five companion meshes. It projects seven samples per body triangle onto
aligned garment surfaces within 4 cm in either direction, refines partial boundary
triangles per texel, then intersects coverage from A and idle poses. The body uses
two horizontal UV tiles; derived masks retain both, while existing one-tile masks
remain in their original domain. The union retains the highest input resolution.
Re-run the asset-index command to include them. The index
verifies the recorded body, garment and mask hashes before using these results.
This avoids missing undergarment coverage and removes the large skin patches through
the tank top, but is **not recovered engine culling** or a complete fitting solution.
These masks are specific to the recorded legacy medium body and two tested poses;
small intersections and other outfit/body variants require further work.

The inspected character customization component and mesh-merge animation blueprints
identify the merge skeleton/control rig but do not expose the shape-tag weights.
The cinematic-character blueprint produced a parser error and is not a validated
fitting source. Native morph-weight evaluation and wrap deformation remain
unverified. The bounded preview policy described below now activates exact matches
from two decoded tag groups; it is explicitly an inference, not a native evaluator.

`check-coverage-tiles.mjs` needs no game assets. It checks mixed one-/two-tile unions,
tile isolation and clearing through 384 GPU pixels. `prepare-material-batch.py`
uses the inventoried output hashes to prepare diverse compilation batches and
explicit exceptions. The current queue has 464 candidates; this measures reuse
potential, not completed or visually validated materials. Each batch still needs
parent/resource extraction, translation and asset validation before activation.

The first 16-material batch built 15 instances without per-instance shader edits.
Its one exception is an unresolved bound null decal texture on the biker vest.
Both texture collection and material building accept `--keep-going`: they record
binding/build exceptions, process the remaining instances, and exit nonzero if
any fail. Inspect the error files before proceeding. Unused texture parameters
are ignored only when they have no binding in the selected compiled permutation;
bound null overrides are not assigned guessed fallback textures.

The staged batch passes 222 CPU and 222 GPU arithmetic fixtures (maximum GPU error
6.68e-6), plus shader/payload integrity checks for 97 unique textures. Together
with the eight assembled coat materials, 23 instances are now reconstructed.
This does not mean 23 complete viewer items. Batch results and the outstanding
exception are recorded in `scripts/generated/shader-probe/material-batch-01/summary.json`.

`check-webgl.mjs` accepts a material URL base and separate report path so staged
batches can be validated without replacing the active preview or older results:

```powershell
python scripts/shader-probe/test_translation.py `
  --exports scripts/generated/shader-probe/material-batch-01/exports `
  --requests scripts/generated/shader-probe/material-batch-01/validated.requests.json `
  --materials public/models/reconstructed-materials-batch-01
node scripts/shader-probe/check-webgl.mjs `
  scripts/generated/shader-probe/material-batch-01/exports/translation-fixtures.json `
  /models/reconstructed-materials-batch-01 `
  scripts/generated/shader-probe/material-batch-01/webgl-checks.json
```

`validated.requests.json` contains only the requested IDs present in
`materials/build-report.json`; failed instances stay in `build-errors.json`.

## Assembly batch integration

The active development index combines 53 preserved meshes and 40 validated material
instances. `check-assembly-coverage.mjs` discovers sixteen complete items, including one
with no legacy GLB. Thirty material instances are used across their 37 equipped
part occurrences; eight materials are staged dependencies and two support the partial
head/body skin pair described below. Source
bindings determine eligibility; outfit-dependent replacements are checked again
at equip time. The fitting preview below handles a bounded set of interactions;
native evaluation and matched in-game appearance remain separate work.

`check-material-batch.py` independently validates built instances and records CPU
failures, allowing the remaining batch to proceed. `check-webgl.mjs` likewise
records per-instance failures before returning a nonzero exit code. Only matching
CPU/GPU passes are accepted by `stage-validated-materials.py`, which verifies shader
and texture payload hashes before copying into an empty local runtime directory.
Build success alone must not be used to activate a material.

All twelve assembly dependencies now pass 246 comparisons per backend. The shared
cloth camera anchor handles masked register layouts such as XYW. The knight-skirt
discrepancy exposed a reference-interpreter bug: `sincos` must read its source before
writing either aliased destination. The armband discrepancy came from assuming square
texture dimensions during validation; its rectangular OCM texture changes decal UVs.
CPU fixtures now use the built texture dimensions and array depths. GPU checks require
their shader hash to match the manifest and actual code. Pass `--materials` when
generating GPU fixtures; omitting it is only for synthetic CPU experiments.
All 35 materials were rechecked: 594 cases per backend, maximum GPU error 6.68e-6.

Rebuild the combined asset and availability indexes with:

```powershell
python scripts/shader-probe/build-assembly-assets.py `
  --meshes public/models/reconstructed-meshes-v2 public/models/reconstructed-meshes-batch-01 public/models/reconstructed-meshes-reference-01 `
  --materials public/models/reconstructed-assemblies-v1 public/models/reconstructed-materials-batch-01 public/models/reconstructed-materials-assembly-02 public/models/reconstructed-materials-reference-02 public/models/reconstructed-skin-v1 public/models/reconstructed-details-v2 public/models/reconstructed-hair-v1 public/models/reconstructed-hair-variants-v1 `
  --coverage public/models/reconstructed-coverage-v2 public/models/reconstructed-coverage-reference-01 `
  --exports scripts/generated/shader-probe/coat-assembly-shaders-v1 scripts/generated/shader-probe/material-batch-01/exports scripts/generated/shader-probe/assembly-batch-01/exports scripts/generated/shader-probe/reference-outfit-01/exports scripts/generated/shader-probe/reference-outfit-01/extra-shaders scripts/generated/shader-probe/reference-hair-variants-01/exports `
  --legacy scripts/asset-sources.generated.json `
  --attachment-body /Game/Discovery/Characters/Body/SK_Body_M.SK_Body_M `
  --output public/models/reconstructed-assemblies-v1/assets.json
node --import tsx scripts/shader-probe/check-assembly-coverage.mjs `
  public/models/reconstructed-assembly-v2/customization.json `
  public/models/reconstructed-assemblies-v1/assets.json `
  public/models/reconstructed-assemblies-v1/supported-items.json
node scripts/shader-probe/check-assembly-batch.mjs
node scripts/shader-probe/check-source-coat-poses.mjs --all
node --import tsx scripts/shader-probe/check-source-skeleton.mjs
python scripts/shader-probe/test_sm5_semantics.py
```

`prepare-material-batch.py --built` accepts multiple validated runtime directories
to avoid requeueing earlier successes. Prefer dependencies that complete an item
over unrelated high-reference companion materials. The assembly batch's recorded
requests, dependency audit and exception reports live under
`scripts/generated/shader-probe/assembly-batch-01`.

The material loader aliases identical texture bindings after checking their payload
and sampler settings. This reduces the red puffer's fifteen material bindings to
thirteen sampler units, leaving room for preview lighting on a 16-unit WebGL device.
Cache keys include the alias layout. The sixteen real item renders, mixed upper/lower
outfit, failure rollback/retry and general isolation checks pass, as do all 37 part
pose/coverage-lifecycle checks and the earlier viewer regression suites.

`SourceSkeleton.ts` preserves garment-only bone branches that are absent from the
body driver, including the knight skirt/belt's hip accessory bones. Their authored
bind transforms attach through the source hierarchy, compensating for the driver's
different rest axes. Staging does not mutate the active body; commit attaches the
branches and unequip removes them. Synthetic tests exercise a rotated/posed driver,
descendant hierarchy, bind restoration and cleanup. Cloth/accessory dynamics and
native wrap/morph evaluation are still separate work.


## Shared fitting and full assembly coverage

With `reconstructed=1`, preserved meshes, source assembly and source fitting enabled
(the defaults for that preview), the viewer loads `reconstructed-meshes-v2/SK_Body_M.glb`
onto the existing medium-body animation driver. Its 33 authored morphs and eight
weights are preserved; the legacy skin textures/material still supply its appearance.
Source vertex colours contain masks and are disabled for this legacy material.
`sourceFitting=0` selects the old body and disables automatic fitting for comparison.

`SourceFitting.ts` accepts only the decoded `Customization.Shape.PushInsideClothes`
and `Customization.Shape.ShrinkWrap` groups. An exact leaf-name match to an existing
morph target activates weight 1. The tag names and morph deltas come from source;
the binary activation policy is a bounded preview inference. No native evaluator,
body-type selection, other shape groups, attachment adjustments or wrap solver is
claimed. Existing unrelated weights are preserved and owned weights restore when
their tags disappear. Hidden items and failed requested swaps cannot contribute
new fitting tags; the actual equipped outfit determines the final fitting state.

The body loader stages both inputs and validates the material layout before replacing
the old body. Failed loads preserve it; disposed/superseded loads cannot attach a late
result. Coverage/decal callbacks compose with the source skinning callback and restore
it when cleared. This is necessary to retain influences 5–8 on the GPU.

Generate coverage for the distinct meshes of all currently complete source items:

```powershell
node scripts/shader-probe/build-companion-masks.mjs --all --output public/models/reconstructed-coverage-v2
```

The first run produced 23 nonempty 2048×1024 masks, retaining both body UV tiles. It uses
the preserved medium body with zero fitting weights and the same A/idle intersection
projection described above. The manifest records `bodyFile` and `bodySha256`; the
asset builder validates these and the garment/mask hashes. Pass `--coverage` with
this directory in the combined index command above. Omitting `--coverage` retains
the older behavior of discovering masks beside material outputs. With no arguments,
the generator retains its historical five-companion/legacy-body workflow.

Masks hide body fragments and cannot resolve clothing against clothing, other body
variants or arbitrary motion. The current full-weight fitting rule improves the
representative interactions but requires matched in-game references before any
fidelity claim. Skin, head, eye and hair rendering remain separate work; the reference
jeans and shoes now use the second clothing family described below.

Run browser harnesses sequentially: their generated HTML files can trigger Vite HMR
and invalidate another harness's in-flight GLB texture loads.

```powershell
node --import tsx scripts/shader-probe/check-fitting-rules.mjs
node scripts/shader-probe/check-source-skinning.mjs
node scripts/shader-probe/check-coverage-tiles.mjs
node scripts/shader-probe/check-source-coat-poses.mjs --all --fitting
node scripts/shader-probe/check-source-fitting.mjs visual-diff/reconstructed/source-fitting-coverage
node scripts/shader-probe/check-assembly-batch.mjs
```

The skinning harness checks 90 GPU/CPU cases, including coverage plus decal rebuilds
and clearing. The fitted-pose harness now checks 37 assembled part occurrences and 16 body
cases, including coverage visibility/removal. The actual viewer captures three mixed
outfits before/after, from behind and in idle, verifies authored fitting activation,
rest-shape accuracy, restoration and failed/disposed body-load behavior. The assembly
batch also checks that failed companion swaps preserve active tags and morph weights.

## Reference-outfit clothing: geometry-dependent detail normals

`M_Character_8Layers_Master` differentiates a height-displaced surface before projecting
the result into its tangent frame. Its three-/eight-layer permutations now build for
dark-blue loose jeans and the two canvas high-top shoe instances. This brings the
active preview to 16 complete assemblies and the validated material set to 38.
It does not establish support for every permutation under that root.

`sm5_slice.py` validates the tangent/normal input signature and a unique world-position
anchor. Geometry-dependent slices receive position, tangent, normal, camera vector and
handedness. `ReconstructedMaterial.ts` supplies these in a reflected view frame, with
positions in source centimetres and interpolated vector lengths preserved. The source
arithmetic remains responsible for detail normals and view-dependent cloth inputs.
Original tangents are required; no per-instance normal-map adjustment is introduced.

Manifests record `sourceRoot`, `geometryDependentNormals` and live `requiredUvSets`.
The new three materials use UV0 only. The loader no longer demands UV1 when the shader
does not read it, and still rejects missing required attributes. Old manifests retain
their two-UV requirement. The active staged directory is
`public/models/reconstructed-materials-reference-02`; `reference-01` predates this UV
metadata and is retained only as historical output.

`quad_translation.py` independently executes the original SM5 over four pixels in
D3D top-left/top-right/bottom-left/bottom-right order. The expression evaluator and
`check-webgl.mjs` compare all four outputs; GPU checks use a 2×2 float target and map
WebGL bottom-up pixels back to that order. Fixtures vary UVs, layer IDs, camera angle,
tangent frames, mirrored handedness and affine varying normals. There are 114 quad
fixtures (456 sampled pixels per backend), with maximum CPU error 7.63e-6 and GPU
error 1.91e-5. These are additional to the earlier 594 scalar cases for 35 materials;
126 existing coat/companion GPU cases were rerun after the shared runtime change.

The translator reverses `dFdy` for D3D screen Y. SM5
[`deriv_rtx_coarse`](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/deriv-rtx-coarse--sm5---asm-)
uses one difference per quad. GLSL ES local differencing does not provide a portable
coarse-quad selector; see the derivative rules in the
[GLSL ES specification](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).
The affine fixtures avoid a coarse/fine ambiguity; curved or perspective-varying
surfaces can differ between implementations. Manifests record this `derivativePolicy`.
Passing these tests establishes bounded surface arithmetic, not original DXBC execution
or complete game-render equivalence. Three lighting and the earlier sampler limitations
still apply.

```powershell
python scripts/shader-probe/test_sm5_geometry.py
python scripts/shader-probe/test_sm5_semantics.py
python scripts/shader-probe/test_translation.py `
  --exports scripts/generated/shader-probe/reference-outfit-01/exports `
  --requests scripts/generated/shader-probe/reference-outfit-01/clothing.requests.json `
  --materials public/models/reconstructed-materials-reference-02
node scripts/shader-probe/check-webgl.mjs `
  scripts/generated/shader-probe/reference-outfit-01/exports/translation-fixtures.json `
  /models/reconstructed-materials-reference-02 `
  scripts/generated/shader-probe/reference-outfit-01/clothing-webgl.json
```

Coverage generation can target only newly supported items. `--items` requires `--all`
and validates every ID against the ready assemblies. The two shoe colourways reuse one
source mesh, so this pass generates two masks and retains the previous 23:

```powershell
node scripts/shader-probe/build-companion-masks.mjs --all `
  --items casual-tallsneakers-canvas,casual-loosejeans-denim-darkblue `
  --output public/models/reconstructed-coverage-reference-01
```

Rebuild both combined indexes using the command above afterwards. The new masks use
the same preserved medium-body, zero-fitting-weight, A/idle intersection policy.
All 20 assembly-viewer, 53 fitted-pose and 15 integration cases pass, alongside the
three mixed-outfit captures and body-load/weight-restoration checks. Current results
are recorded in `scripts/generated/shader-probe/reference-outfit-01/summary.json`.

`prepare-material-batch.py --root M_Character_8Layers_Master` selects this family;
omitting `--root` retains `M_Character_Layered`. The prepared queue has 469 compilation
candidates, including three already built and 466 pending. It matches extracted
bytecode identities, not necessarily translated ones: 93 pending candidates use the
master permutation that has only extraction/binding validation. Each selected variant
must pass translation and CPU/GPU checks before staging.

The same pass extracted/disassembled 32 SM5/SM6 shaders for reference clothing, body,
head and remaining facial/hair materials, checking 1,729/1,729 referenced SM5 material
buffer components. Only the three clothing instances were translated in this pass.
Two Afro Fade meshes (75,016 vertices) were independently preserved under
`reconstructed-meshes-reference-01`; they are staged outside the active mesh index.

The next adapters must respect source ownership: the head definition includes a body
part/material override, and Afro Fade modifies scalp parameters on the face material
while its mesh uses a separate masked hair shader and authored head attachment.
Integrate this with the persistent fitted body without creating a second body mesh.
Skin/face subsurface, mouth, refractive eyes, translucent eye layers and hair lighting
remain unreconstructed. Default and Frontend variants are recorded separately; the
current medium viewer uses the default context.

## Paired body and face skin surfaces

The next pass adds `MI_Body_Face_01_Base` (`M_Skin`) and
`MI_Head_Face_01_Base_Head` (`M_Face`). Both roots use `MSM_Subsurface`.
The translator preserves the six existing surface channels plus subsurface colour;
subsurface lighting is not implemented. That pass brought the count to 40 validated
materials, 16 complete clothing assemblies and one separately indexed **partial**
head/body pair. Eye/mouth fallback sections do not count as reconstructed materials.

Skin receives a source world frame instead of the clothing adapter's reflected view
frame. This is needed for the body world-up specular term and the face's bounds-centred
Fresnel term. The local preview supplies perspective camera vectors and imported
bounds, with zero high world tile, no engine normal override and zero global mip bias.
Material-local `sample_b` biases remain in GLSL. Bounds come from `ImportedBounds`
in the skeletal mesh export and are checked against the original mesh package hash.
They are transformed by the model matrix; animated/physics-driven engine bounds are
not recovered. Native opacity/discard, pixel depth offset, engine effects and
subsurface lighting remain excluded in the manifest.

`sample_b` adds bias to the sampled mip level ([Microsoft instruction reference](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/sample-b--sm4---asm-)).
SM5 `log` means base-two logarithm of the absolute source value ([Microsoft reference](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/log--sm4---asm-));
`exp` uses base two. The emitter supports these operations explicitly. Dynamic
indexable-array reads can be removed when dead, but any live unresolved lookup or
primitive-buffer field still rejects the material. Constant-texture quad fixtures
validate arithmetic rather than mip selection or original Direct3D execution.

The two materials retain 344/365 expression nodes and 9/10 texture bindings, using
8/9 unique samplers after aliasing. Fifteen distinct texture payloads are staged.
Each material passes 24 four-pixel CPU/GPU fixtures: 48 quads, 192 pixels per backend,
zero maximum CPU error and 7.15e-7 maximum GPU error. Fourteen synthetic instruction
tests cover the existing geometry paths, the new camera/bounds bindings, biased
sampling code generation and rejection of unsupported live inputs.

`build-skin-pairs.mjs` generates `skin-pairs.json` separately from the complete-item
index. It validates the source head/body parts, material overrides, exact legacy
fallback names and source-package hashes for bounds. The viewer stages both surfaces
before changing the existing fitted body. Face 01 uses seven preserved source
sections (68,614 vertices, eight skin influences); one skin section is reconstructed
and six eye/mouth sections keep matched legacy materials. The three previously hidden
eye layers stay hidden. Existing neck-edge alpha is retained while native opacity
remains pending. Source head/neck wrap fitting and hair/scalp overrides are also pending.

Coverage and decals run after the recovered surface, preserving the skinning callback.
Thirty synthetic GPU cases inspect the runtime world position, tangent, normal, camera,
bounds and handedness under moved/rotated roots, oblique cameras and influence-eight
deformation, then check coverage and paint being installed and cleared. Twelve actual
viewer/lifecycle cases check neutral/idle geometry, paired ownership, failure retention,
abort, retry, fallback, removal and disposal. The existing 20 assembly-viewer,
15 integration and three mixed-outfit fitting checks also pass with the skin adapter.

Revalidate the skin output and regenerate pair bindings with:

```powershell
python scripts/shader-probe/check-material-batch.py `
  --exports scripts/generated/shader-probe/reference-skin-01/exports `
  --requests scripts/generated/shader-probe/reference-skin-01/materials.requests.json `
  --materials public/models/reconstructed-skin-v1
node scripts/shader-probe/check-webgl.mjs `
  scripts/generated/shader-probe/reference-skin-01/exports/translation-fixtures.json `
  /models/reconstructed-skin-v1 `
  scripts/generated/shader-probe/reference-skin-01/webgl-checks.json
node --import tsx scripts/shader-probe/build-skin-pairs.mjs `
  public/models/reconstructed-assembly-v2/customization.json `
  public/models/reconstructed-assemblies-v1/assets.json `
  scripts/generated/shader-probe/reference-skin-01/properties `
  scripts/generated/shader-probe/meshes-v2 `
  public/models/reconstructed-assemblies-v1/skin-pairs.json head-face-01-base
python -m unittest discover -s scripts/shader-probe -p 'test_sm5_*.py'
node scripts/shader-probe/check-skin-adapter.mjs
node scripts/shader-probe/check-skin-pair.mjs
```

Run browser harnesses sequentially and finish source/asset edits before starting them:
Vite reloads can invalidate an in-progress viewer test. Current evidence is recorded
in `scripts/generated/shader-probe/reference-skin-01/summary.json`, with front/side/back
and mixed-outfit captures under `visual-diff/reconstructed/reference-skin-01`.
The cached extraction records retain their original run scope; copying them for this
pass does not constitute a fresh extraction of every shader in those records.

## Eyes, teeth and eyelash coverage (checkpoint before hair activation)

The current checkpoint has **44 validated material instances**, 16 complete clothing
assemblies and one separate partial Face 01 head/body pair. This pass adds four
instances from `M_EyeRefractive_2`, `M_Teeth`, `M_EyelashMaster` and
`M_Hair_Metahuman_01`. Eyes, teeth and lashes are enabled; hair is staged pending its
lighting, attachment and scalp-override adapters. Five of the head's seven source
sections now use reconstructed materials. The remaining eye-shell and eye-edge
sections stay hidden and do not count as recovered surfaces.

The eye shader keeps its source iris-refraction math, cubemap reflection and BC6H
midplane displacement texture. `TextureExport.cs` preserves each original cooked
mip and also records a hashed `RGBA16F` decode using the already bundled
AssetRipper.TextureDecoder 2.6.2. The packer and runtime retain half-float data rather
than quantizing it to RGBA8. Cubemaps keep all six faces in +X/-X/+Y/-Y/+Z/-Z order
and all authored mip levels. BGRA8 and G8 source formats are also supported.
The real eye-depth texture passes a complete comparison against native GPU BC6H
decoding: nine levels, 87,381 texels, zero difference in every RGBA component.

Lashes derive coverage from RGB classification, power and material gain; texture
alpha alone is not coverage. The translator captures that value before native
temporal dithering and engine effects, interpreting the SM5 conditional move as
float bits. An independently emitted coverage slice drives depth/distance shadow
passes. Runtime shadow support requires a slice with no live geometry inputs and a
separate source section. Eight-influence skinning composes with both passes.
Two-sidedness and the lash world-space normal are retained. Three's spatial alpha
hashing is an explicit preview policy; without temporal accumulation, some speckling
remains visible. This does not recover the original Unreal temporal renderer.

Hair uses a different input signature: vertex colours in register v2, UVs in v3 and
material constants in cb1. Its G-buffer value in o2.x is Scatter, not metalness, and
its Normal input describes a strand tangent. The manifest records these distinctions.
Its raw inputs pass validation, but the runtime rejects rendering it through the
ordinary surface adapter. Native hair scattering, the authored head attachment,
under-hat replacement and face/scalp parameter overrides remain the next work.

Validation for this pass includes 96 four-pixel CPU/GPU fixtures, including the
separate coverage GLSL; CPU maximum error is zero and GPU maximum error is 1.20e-7.
The runtime has 167 synthetic GPU cases: 126 cubemap samples across every fixture
face/mip, 21 half-float samples, five coverage-density checks, three world-normal
checks and 12 visible/shadow coverage comparisons under eighth-influence deformation.
The shadow comparisons check 786,432 pixels with no differing masks. The sRGB cube
test allows half an 8-bit code value for fixed-function GPU transfer approximation
(observed maximum 0.001325); linear half-float samples are exact. Eighteen synthetic
SM5 tests, 30 existing skin adapter tests, 12 head/body lifecycle cases, 20 assembly
viewer cases, 15 integration cases, TypeScript and the production JS/CSS bundle pass.
The bundle retains its existing size warning; generated game assets are excluded.

The shaders reuse the audited reference-outfit exports; provenance is recorded in
`scripts/generated/shader-probe/reference-details-01/provenance.json`. Active assets
use `public/models/reconstructed-details-v2`; `v1` is historical pre-shadow staging.
The combined asset-index command above includes the new materials. Rebuild the
skin-pair bindings after rebuilding that index.

```powershell
python scripts/shader-probe/check-material-batch.py `
  --exports scripts/generated/shader-probe/reference-details-01/exports `
  --requests scripts/generated/shader-probe/reference-details-01/materials.requests.json `
  --materials public/models/reconstructed-details-v2
node scripts/shader-probe/check-webgl.mjs `
  scripts/generated/shader-probe/reference-details-01/exports/translation-fixtures.json `
  /models/reconstructed-details-v2 `
  scripts/generated/shader-probe/reference-details-01/webgl-checks.json
node scripts/shader-probe/check-detail-adapter.mjs
node scripts/shader-probe/check-hdr-texture.mjs
node scripts/shader-probe/check-skin-pair.mjs
node scripts/shader-probe/render-head-details.mjs
```

`render-head-details.mjs` captures the same pose/camera with the previous skin-only
pair bindings and with all five recovered sections. The close-ups show brown iris
detail/reflections and lashes, alongside still-unresolved hair cards and the neck
seam. Captures and current evidence are in
`visual-diff/reconstructed/reference-details-01` and
`scripts/generated/shader-probe/reference-details-01/summary.json`. These checks do
not establish matched in-game lighting, skin scattering, native culling or complete
outfit reconstruction.

## Afro Fade: strand lighting, head attachment and scalp parameters

The current index has **16 clothing assemblies plus the base Afro Fade hairstyle**,
54 preserved meshes, 44 base material instances and one composed face/scalp variant.
The partial Face 01 head/body pair still has five recovered head sections. The six
Afro Fade colour variants require additional parameter combinations and remain
exceptions; having the base mesh and material alone does not make them ready.

`SourceAttachment.ts` composes the preserved medium-body bone frame with the
decoded UE local position/rotator/scale. It uses a single rigid influence to follow
the preview's reoriented head bone, preserving the source vertex positions,
tangents, UVs and RGBA masks. Regular and under-hat meshes are supported. Explicit
hat/hood hide rules affect cards separately from scalp activation. Other body
archetypes, attachment meshes, head-component attachments and wrap deformation
remain outside this static attachment path.

`HairLighting.ts` implements a shared R/TT/TRT preview from
[Karis's SIGGRAPH 2016 hair model](https://blog.selfshadow.com/publications/s2016-shading-course/karis/s2016_pbs_epic_hair.pdf).
It consumes the recovered pigment, roughness, specular, Scatter and fibre tangent.
Shared lobe widths use squared roughness with ratios 1, 0.5 and 2; cuticle tilt is
0.035 radians. These are preview policy, not extracted THE FINALS engine constants.
Fresnel uses a normal-incidence reflectance of 0.08 times the recovered Specular.
Directional/point/spot lights use fibre scattering without card-normal Lambert
attenuation. Environment lighting uses the paper's widened-lobe facing-normal
approximation. Direct rectangle-light integration is explicitly unsupported.
Three's regular shadows replace the unavailable exponential volume-shadow term.
Spatial alpha hashing consumes original coverage in colour/depth/distance passes;
the shared still-view accumulation described below now smooths coverage grain.
Pixel depth offset and native temporal rendering remain unfinished. This is not
native game-lighting parity.

The scalp is a parameter activation on the face material, not a second head or a
replacement hair shader. `material_inputs.py` accepts a job's `parameterOverrides`
list and copies only each selected instance's explicit dynamic values. Roots must
match the recipient. Donor static switches, parent defaults, base properties and
the overlay's shader are not copied. The combined index stores
these compositions separately in `materialVariants`; runtime requires an exact
source/override combination. Ordered activations within one item are supported as
described below; distinct item contributors remain rejected. The viewer keys scalp state
from the successfully equipped hair and restores baseline skin on removal.

The prepared reference job and texture request come from the decoded DA and the
current Face 01 pair, reusing existing shader exports:

```powershell
python scripts/shader-probe/prepare-hair-reference.py
# Extract textures.requests.json with ShaderProbe's textures command as above.
python scripts/shader-probe/build-materials.py `
  --exports scripts/generated/shader-probe/reference-hair-01/exports `
  --requests scripts/generated/shader-probe/reference-hair-01/requests.json `
  --textures scripts/generated/shader-probe/reference-hair-01/textures `
  --output public/models/reconstructed-hair-staging-v1
python scripts/shader-probe/check-material-batch.py `
  --exports scripts/generated/shader-probe/reference-hair-01/exports `
  --requests scripts/generated/shader-probe/reference-hair-01/requests.json `
  --materials public/models/reconstructed-hair-staging-v1
node scripts/shader-probe/check-webgl.mjs `
  scripts/generated/shader-probe/reference-hair-01/exports/translation-fixtures.json `
  /models/reconstructed-hair-staging-v1 `
  scripts/generated/shader-probe/reference-hair-01/webgl-checks.json
# Use stage-validated-materials.py with a NEW empty runtime output directory,
# then rebuild the combined indexes using the command above.
python -m unittest discover -s scripts/shader-probe -p test_material_overrides.py
node scripts/shader-probe/check-hair-adapter.mjs
node --import tsx scripts/shader-probe/check-hair-rig.mjs
node scripts/shader-probe/render-hair-reference.mjs
```

The composed shader has 363 live scalar nodes and ten bindings (nine unique
textures). Its 24 CPU/GPU quad fixtures pass with zero CPU error and GPU error
below 3.58e-7. The 58 new GPU adapter checks cover the published equations (maximum
error 8.19e-7), vertex masks, backlighting, fibre orientation, rigid skinning,
environment AO and identical visible/depth/distance coverage. Ten rule/rig checks
exercise 75,016 vertices across the regular and under-hat meshes, failures,
cancellation, disposal and scalp removal/reapplication. Four override unit tests,
the existing 167 detail GPU checks, 18 SM5 unit tests, 12 head/body lifecycle cases,
21 assembly cases, seven source-visibility outfit changes and 15 integration cases
pass. TypeScript and the production JS/CSS build pass with the existing size warning.

Active scalp assets use `reconstructed-hair-v1`; the hair material remains in
`reconstructed-details-v2`. Evidence and matched front/oblique/side captures are
in `scripts/generated/shader-probe/reference-hair-01/summary.json` and
`visual-diff/reconstructed/reference-hair-01`. Native temporal rendering, skin
scattering, eye-shell/eye-edge layers, the neck seam and native culling remain open.

## Shared still-view hair/lash smoothing

`StableFrameAccumulator.ts` collects 32 subpixel camera samples, one scene sample
per frame, in linear HDR. Two RGBA16F targets hold the scene sample and weighted
sum. A converged frame needs only the display pass; the existing contact-shadow
helper still performs its small offscreen draws. Shader inputs, original spatial
alpha hashing and material coverage/depth/distance passes are unchanged.

This follows the still-view accumulation idea documented by
[Three's TAARenderPass](https://threejs.org/docs/pages/TAARenderPass.html), which
also distinguishes it from reprojected temporal antialiasing. Our pass uses a
bounded progressive sequence, explicit invalidation and transparent-canvas colour
handling. It does not reconstruct THE FINALS' native TAA.

`StableFrameState.ts` detects camera, bone, morph, buffer, material, texture,
lighting, visibility and scene changes. Edits to buffers and textures must set
their normal `needsUpdate` flags. Custom time/`onBeforeRender` state outside those
tracked inputs must call `invalidate()`; this path is intended for static outfit
inspection, not arbitrary animated effects. Visible motion discards history.
`StableCamera.ts` bounds residual camera drift over the entire old view frustum
at one eighth of a physical pixel, comparing against the retained camera so slow
motion cannot freeze. Accumulating samples uses that exact retained camera; it
does not smear the tiny changing poses together. New history starts at the exact
current pose. Camera matrices and renderer state are restored even on failure.

The display pass unpremultiplies linear colour by coverage before tone mapping
and output transfer, then premultiplies for the canvas. This preserves transparent
edge colour. Both targets resize/dispose together. The preview activates only in
recovered lit mode with a visible recovered alpha-hashed surface; raw surface and
albedo calibration views bypass it. XR and missing float colour-buffer support
fall back to direct rendering. `temporal=0` disables the pass for comparisons.
`window.__temporalPreview` exposes convergence and resource counters in DEV only.

```powershell
node scripts/shader-probe/check-temporal-preview.mjs
node scripts/shader-probe/render-temporal-reference.mjs
node --import tsx scripts/shader-probe/check-hair-rig.mjs
node scripts/shader-probe/check-skin-pair.mjs visual-diff/reconstructed/reference-temporal-01/skin-pair-regression
node scripts/shader-probe/check-assembly-batch.mjs
node scripts/shader-probe/check-integration.mjs
npx tsc -b --noEmit
node --input-type=module -e 'import { build } from "vite"; await build({ publicDir: false });'
python scripts/shader-probe/summarize-temporal-reference.py
```

One hundred GPU checks cover coverage statistics, authored card layering, sharp
silhouettes, HDR/linear/sRGB/Neutral/ACES colour, history rejection, camera damping,
resize, state restoration, interrupted rendering and resource cleanup. Synthetic
partial-coverage variance falls by 96.8–96.9%; this statistic describes the test
surfaces, not a measured percentage of in-game appearance. The actual viewer
passes thirteen checks and has six matched front/oblique/side before/after images.
Existing hair, head/body, assembly and integration regressions pass. Evidence is
in `visual-diff/reconstructed/reference-temporal-01` and
`scripts/generated/shader-probe/reference-temporal-01/summary.json`.

The source index remains 16 clothing assemblies, one base hairstyle, 54 meshes,
44 base materials and one composed scalp variant, plus the partial Face 01 pair.
Moving views may show grain until they settle. Native motion reprojection, volume
shadows/depth offset, colour variants, skin scattering, remaining eye layers,
head/neck wrapping, native culling and in-game appearance checks remain open.

## Afro Fade colour batch and atomic hair/scalp swaps

The six colour options now render alongside the base hairstyle. The current
supported-item index has **23 items: 16 clothing assemblies and seven Afro Fade
options**, plus the separate partial Face 01 head/body pair. It still references
54 meshes and 44 base material instances; composed parameter combinations rise
from one to thirteen. The new runtime folder is `reconstructed-hair-variants-v1`.

`prepare-hair-variants.py` reads each decoded activation array, reuses the existing
hair/head shader exports, and selects the required material records and cooked
textures from the saved inventory. It records source paths and hashes, rejects
ambiguous material names, and checks that the source meshes/attachment rules match
the already supported geometry. No additional extraction or shader-family adapter
was needed for this batch.

[Epic's CopyParameterOverrides API](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/Materials/UMaterialInstanceDynamic/CopyParameterOverrides?application_version=5.5)
copies explicitly overridden instance values. The reconstruction follows that
dynamic-parameter behavior: donor parent defaults and static switches do not
replace the recipient's compiled shader. Some hair-colour donors enable secondary
colour code which is absent from the recipient permutation; copying their dynamic
values must not select that donor shader. Root compatibility remains required.

The scalp has two contributors from the same item: fade activation and colour.
The preview uses their authored array order, with later applicable dynamic values
winning. This is an explicit inference from the source layout, not proof of the
native evaluator's order. Runtime accepts only an indexed ordered combination
from one item. Reversed unindexed combinations and cross-item priorities fail
explicitly. Conditional scalp colours require the decoded Head tag; no extra
tag inference is introduced.

`CharacterRig.equipSourceItems` stages complete source items, including their
materials, before any commit. The viewer uses it for related hair/head updates
and hair removal. A failed or cancelled hair/scalp load keeps both previous
pieces. Source skeleton branches and staged resources remain unattached until
success. Body geometry, skeleton, fitting and unrelated clothing persist. An
unchanged appearance does not reload when another clothing slot changes.

```powershell
python scripts/shader-probe/prepare-hair-variants.py
python scripts/shader-probe/build-materials.py --exports scripts/generated/shader-probe/reference-hair-variants-01/exports --requests scripts/generated/shader-probe/reference-hair-variants-01/requests.json --textures scripts/generated/shader-probe/reference-hair-variants-01/textures --output public/models/reconstructed-hair-variants-staging-v1
python scripts/shader-probe/check-material-batch.py --exports scripts/generated/shader-probe/reference-hair-variants-01/exports --requests scripts/generated/shader-probe/reference-hair-variants-01/requests.json --materials public/models/reconstructed-hair-variants-staging-v1
node scripts/shader-probe/check-webgl.mjs scripts/generated/shader-probe/reference-hair-variants-01/exports/translation-fixtures.json /models/reconstructed-hair-variants-staging-v1 scripts/generated/shader-probe/reference-hair-variants-01/webgl-checks.json
# Stage into a NEW empty directory; retain existing validated outputs.
python scripts/shader-probe/stage-validated-materials.py --materials public/models/reconstructed-hair-variants-staging-v1 --exports scripts/generated/shader-probe/reference-hair-variants-01/exports --gpu scripts/generated/shader-probe/reference-hair-variants-01/webgl-checks.json --output public/models/reconstructed-hair-variants-v1
# Rebuild combined assets and supported-items with the command above.
node --import tsx scripts/shader-probe/check-hair-variants.mjs
python -m unittest discover -s scripts/shader-probe -p test_material_overrides.py
node --import tsx scripts/shader-probe/check-hair-rig.mjs
node scripts/shader-probe/check-skin-pair.mjs visual-diff/reconstructed/reference-hair-variants-01/skin-pair-regression
node scripts/shader-probe/check-assembly-batch.mjs
node --import tsx scripts/shader-probe/check-source-assembly.mjs
node scripts/shader-probe/check-integration.mjs
python scripts/shader-probe/summarize-hair-variants.py
```

The twelve compositions pass 288 CPU/GPU quad comparisons per backend: zero CPU
error and maximum GPU error 3.58e-7. Twenty-three source/viewer cases pass, including
unchanged original hair atlases, shader owner, coverage shader, under-hat bindings,
both hide rules, all six colour/scalp swaps, missing-member rollback, retry and
superseded loads. Five parameter unit tests and the existing hair, head/body,
assembly, visibility and integration suites pass. TypeScript and the production
JS/CSS bundle pass with the existing size warning.

Evidence and seven matched images are in
`visual-diff/reconstructed/reference-hair-variants-01`, with a labelled
`colour-variants.png` comparison sheet. The measured checkpoint is recorded in
`scripts/generated/shader-probe/reference-hair-variants-01/summary.json`.
Native lighting, contributor priority, remaining eye layers, skin scattering,
head/neck wrap, native culling and in-game appearance remain separate work.

## Shared neck matching and recovered fade (9 September)

The Face 01 source definition activates `HeadNeckMatch.head_neck_match`. Both
preserved meshes contain that exact target. `SourceFitting` now accepts this group
alongside the existing clothing groups, retaining the same weight-1 preview rule
and previous-weight restoration. This recovers a missing shape activation, not the
native wrap-deformer or weight evaluator.

The face shader binds `T_Face_NeckFade` independently of diffuse alpha.
`neck_fade_inputs` resolves its texture slot and the direct `FadeAmount` and
`NeckFadeEnabled` fields from decoded bindings. The slicer requires the observed
sample/gain and enable anchors; missing, ambiguous or incompatible anchors reject
the material. It retains the sample channel, bias and saturated gain. Only binary
enable values and finite nonnegative gains are accepted in this bounded path.

This is undithered material coverage. The source's temporal-noise sequence,
discard threshold, pixel depth offset and dynamic effect masks are excluded.
The viewer feeds the scaled mask through its existing alpha hashing and 32-sample
still-view smoothing. Visible, depth and distance passes share the independent
UV-only coverage slice. The old baked alpha and hard cutoff are removed only
when a manifest declares validated `skinCoverage: "neck-fade"`. The paired body
retains skin behind the fade rather than applying the old head coverage mask.

Eight face/scalp compositions are upgraded together: the bare face, the base
Afro Fade scalp and all six colours. Original material colour/normal/surface
inputs, atlases, meshes and source shader identity remain unchanged. The new
runtime folder is `reconstructed-neck-v1`. Counts remain 23 source items, 54 meshes,
44 base materials and 13 indexed parameter combinations. Face 01 is still partial.

```powershell
python scripts/shader-probe/prepare-neck-reference.py
python scripts/shader-probe/build-materials.py --exports scripts/generated/shader-probe/reference-neck-01/exports --requests scripts/generated/shader-probe/reference-neck-01/requests.json --textures scripts/generated/shader-probe/reference-neck-01/textures --output public/models/reconstructed-neck-staging-v1
python scripts/shader-probe/check-material-batch.py --exports scripts/generated/shader-probe/reference-neck-01/exports --requests scripts/generated/shader-probe/reference-neck-01/requests.json --materials public/models/reconstructed-neck-staging-v1
node scripts/shader-probe/check-webgl.mjs scripts/generated/shader-probe/reference-neck-01/exports/translation-fixtures.json /models/reconstructed-neck-staging-v1 scripts/generated/shader-probe/reference-neck-01/webgl-checks.json
# Use a NEW empty staging destination; preserve validated historical outputs.
python scripts/shader-probe/stage-validated-materials.py --materials public/models/reconstructed-neck-staging-v1 --exports scripts/generated/shader-probe/reference-neck-01/exports --gpu scripts/generated/shader-probe/reference-neck-01/webgl-checks.json --output public/models/reconstructed-neck-v1
# Run after rebuilding the combined asset index and skin pairs as well.
python scripts/shader-probe/activate-neck-reference.py
python -m unittest discover -s scripts/shader-probe -p test_neck_fade.py
node --import tsx scripts/shader-probe/check-fitting-rules.mjs
node scripts/shader-probe/check-neck-adapter.mjs
node scripts/shader-probe/check-neck-fitting.mjs
node scripts/shader-probe/check-preview-fallback.mjs
node --import tsx scripts/shader-probe/check-hair-variants.mjs
node scripts/shader-probe/check-skin-pair.mjs visual-diff/reconstructed/reference-neck-01/skin-pair-regression
node scripts/shader-probe/check-source-fitting.mjs visual-diff/reconstructed/reference-neck-01/fitting-regression
node scripts/shader-probe/check-assembly-batch.mjs
node scripts/shader-probe/check-integration.mjs
node scripts/shader-probe/check-detail-adapter.mjs
python scripts/shader-probe/summarize-neck-reference.py
```

The activation script verifies the existing source/parameter identities and
unchanged texture bindings before replacing exactly the eight entries. It keeps
the previous asset/skin-pair manifests for matched captures. Colour-regression
tests now resolve their fault-injection routes from the active asset index so a
new validated material folder cannot bypass a failure test.

The batch passes 192 CPU/GPU quad comparisons per backend (zero CPU error,
maximum GPU error 3.58e-7), five neck unit tests including 70 coverage combinations,
23 synthetic GPU adapter cases and 11 source/viewer cases. There are 13 matched
or interaction captures, including front/side/back in A and idle poses. Existing
hair-colour, head/body, fitting, assembly, integration and detail regressions pass.
Three additional viewer cases verify that disabling source meshes or fitting
selects compatible legacy hair/body paths, while the normal source preview stays
active. This fixes a diagnostic-mode attachment mismatch exposed by the fitting
regression after source hair became available.
TypeScript and the 647-module production JS/CSS bundle pass with the existing
bundle-size warning.

`visual-diff/reconstructed/reference-neck-01/neck-comparison.png` shows the hard
collar-shaped boundary reduced. Shoulder highlights and residual overlap remain;
the fade is not native opacity or complete skin rendering. Skin scattering,
translucent eye layers, native depth offset/wrapping/culling and body variants
remain open. Evidence is in `scripts/generated/shader-probe/reference-neck-01/summary.json`.
