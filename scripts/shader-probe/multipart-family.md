# Ordinary multipart family runner (schemaVersion 2)

`prepare-multipart-family.py` and `freeze-multipart-family.mjs` are an opt-in sibling of the single-mesh runner
(`family-runner.md`). The v1 files, manifests and evidence are unchanged: v1 rejects a v2 manifest and v2
rejects a v1 manifest. The v2 Python `MultipartFamily` subclasses v1 `Family`. It reuses configuration isolation,
the baseline/preview/GPU/fitted-pin guards and the Large Sneakers stage module. It overrides only single-mesh
code. The node freeze imports v1's pure exports.

## Supported slice

The slice covers Medium only, with two or more distinct, unattached skeletal parts. Each part has exactly one
material slot, and every slot is bound through an explicit item `MaterialOverrides` entry. The following are
rejected, per choice with the exact reason, before anything is frozen:

- static, effect, attached or head parts; logic modules, wrap deformation, local offsets, parameter overlays or
  unresolved rules
- hidden parts, and any `TagOverrides` rule other than a Light/Heavy archetype swap (hide rules are out of scope)
- missing, extra or reordered parts
- an override key that matches no component slot, or a component slot with no override (default-only)
- tags that differ from the one shared exact `fittingTags` set (split-tag cohorts need separate manifests)
- a component mesh or cohort material already present in the active index (reuse provenance is not proven here)

## Integrated real proofs (updated 2026-09-19)

Astra has since accepted two real families through this shared path: eight Tactical Trousers variants (`_docs/multipart-tactical-proof-2026-09-18`) and six Dress Shoes variants (`_docs/multipart-dress-shoes-2026-09-18`). Their acceptance records include exact source/GLB/material/GPU checks, per-component coverage, actual browser captures, additive-index checks and explicit pending human acceptance. The worker-only limitations below describe the original isolated delivery; Dress Shoes is no longer an untested family. Active component/material reuse, mismatched sibling tags, conditional hidden components and wrap meshes remain unsupported by schema 2.

Direct `check-family-outfits.mjs` calls now preflight the whole scenario sequence before browser launch or evidence creation. A `samePage:true` step must keep the effective camera and pose. Set `samePage:false` explicitly for a different view; doing so starts a new restoration baseline. Framing in reports is derived from the validated scenario/navigation, not camera introspection.

## Request and manifest

Preflight takes a request. It is the manifest without the per-component pins:

```json
{
  "id": "example-multipart",
  "schemaVersion": 2,
  "paths": {"docs": "_docs/example-multipart", "work": "scripts/generated/shader-probe/example-multipart-v1",
            "runtime": "public/models/reconstructed-example-multipart-v1",
            "preview": "public/models/reconstructed-example-multipart-preview-v1",
            "active": "public/models/reconstructed-assemblies-v1", "sourceIndex": "public/models/reconstructed-assembly-v2",
            "catalog": "src/data/items.json", "resolver": "src/rig/SourceAssembly.ts",
            "refresh": "scripts/generated/shader-probe/catalog-refresh-20260912", "appUrl": "http://127.0.0.1:4173/",
            "metadata": ["src/data/share-item-ids.json", "src/data/source-catalog-names.json"]},
  "itemSlot": "lowerBody",
  "components": [
    {"sourceIndex": 0, "source": "/Game/Example/SK_Shell_M.SK_Shell_M", "slot": "Shell"},
    {"sourceIndex": 1, "source": "/Game/Example/SK_Liner_M.SK_Liner_M", "slot": "Liner"}
  ],
  "fittingTags": ["Customization.Shape.PushInsideClothes.push_full_pants"],
  "coverage": {"mode": "fitted-conservative-shared-uv", "composition": "per-component-union"}
}
```

- `components` is listed in ascending source part order, with unique indices, sources, file stems and slots.
  Preflight writes `docs/family.json`, which adds these fields to each component: `sha256` (GLB),
  `sourcePackageSha256`, `sourceDtoSha256`, `facts` (vertices, triangles, uvSets, bones, materialSections = 1 and
  maxInfluences) and `morphNames` (exact order).
- `paths.metadata` names the share/name/review metadata files explicitly. The baseline pins them together with the
  three active index files, the catalog and the resolver.
- `docs/cohort.json` lists the exact IDs. `meshes` holds the component sources in part order. Each item's
  `materials` holds one material per component, in component order. This is the expected binding that the freeze
  must reproduce.
- `coverage`: `none` needs a `reason`. Every other mode needs `"composition": "per-component-union"`. The
  existing generator writes one mask per source mesh, and the runtime unions masks per item slot.

## Stages

```
python scripts/shader-probe/prepare-multipart-family.py --request R preflight [--reuse-probe WORK]
python scripts/shader-probe/prepare-multipart-family.py --manifest M run [--stages mesh,freeze,...]
```

`run` executes `mesh, freeze, source, build, gpu, index, coverage, verify, freeze-verify` one at a time. Each
stage gets its own log, timing and exit code in a receipt at `docs/runs/<stamp>.json`. Receipts are never
overwritten, and a failed attempt keeps its receipt. You can also call each stage explicitly with `--manifest M
<stage>`. The freeze runs as `node --import tsx scripts/shader-probe/freeze-multipart-family.mjs --manifest M
[--verify-only]`.

- **preflight**
  1. Validates the request and cohort.
  2. Pins `frozen-baseline.json`.
  3. Rejects active reuse before any extraction.
  4. Extracts every component package in one exact request (`meshes-01`) through the shared probe.
  5. Converts each component with the shared converter and runs the DTO-to-GLB attribute verifier (topology, UVs,
     all influences, morphs).
  6. Writes `mesh-report.json` (`formatVersion: 2`, one report per component) and the pinned manifest.

  `--reuse-probe` copies an earlier extraction byte for byte only when its request set, run record and records
  match exactly. It then reconverts each DTO, and the result must hash-equal the probe GLB. Otherwise it fails,
  and you should extract fresh.
- **freeze** replays current definitions (package hash and decoded properties) and resolves them through the
  product resolver. It writes `resolved-cohort.json`, `batch.json` and `adapter-baseline.json` once. The baseline
  hashes must equal the preflight pin. Each choice records `effectiveParts` in the form `{sourceIndex, mesh,
  binding: "explicit-override", slots: [{slot, material}]}`.
- **source** is the shared `stage_source`, given the multipart plan (every component part with its override
  slots).
- **build** composes the shared compiler, the CPU check and the Large Sneakers surface audit. It then
  re-verifies each component and writes `meshes.json` in part order. It repeats about eight lines of
  material-job and copy glue, because `prepare-large-sneakers.build` hard-codes one mesh report. The UV-geometry
  contract checks each material against every component it binds.
- **gpu/index/coverage** are the v1 stages. Before them, a completed build record must match the current build
  outputs. The index stage checks every coverage record before the shared stage runs, because that stage checks
  only the first record. Fitted evidence pins one completed record per component (mask plus diagnostic), and
  each component's preview entry must index its own mask.
- **verify** is read-only. It replays the component meshes, the frozen cohort, the build and geometry, and the
  fresh GPU evidence. It then checks the preserved preview entries against the pinned `active-before` snapshot:
  every existing mesh, material, variant, skin pair, advertised item, ready entry and exclusion. Finally it
  checks the completed coverage. A bare preliminary index fails.

## Fitted coverage across components

The fitted generator tests occlusion against faces of the **same source mesh** only, and the runtime unions the
per-component masks. So where only the combination hides skin (for example at a trouser hem over a sock top),
per-component restoration can reveal skin. This is conservative toward showing skin, not a recovered culling
rule. Treat it as a candidate that needs Astra's focused opening and outfit review.

## Known limits

- Real extraction, material compile, GPU, coverage and resolver integration were not run in this workspace.
  The tests use synthetic fixtures and fake stage functions.
- Already-active meshes and materials cannot be reused, even when the entries are identical. A later slice needs
  proven provenance before it can share them.
- A component whose derived coverage is empty makes the generator skip that record, and the stage then fails.
  There is no per-component `none` policy.
- Starter Sneakers, Dress Shoes (a shared sock mesh that other families may add), split-tag groups, Dede Tights,
  wrap meshes and Steampunk stay out of scope. The Tactical Trousers group is the only group whose definitions
  were checked against this contract. Starter Sneakers can now opt into the section below.

## Opt-in active component reuse (`activeComponentReuse`, first slice)

Without the field nothing changes: the refusal of any active overlap, the `frozen-baseline.json` shape and every gate
stay as before. schemaVersion 1 never accepts the field. The code is `multipart_active_reuse.py` and
`multipart-active-reuse.mjs`. Both reuse the `family_active_reuse.py` and `freeze-family.mjs` whole-entry hash,
URL resolution and pinned reads unchanged.

Request field (fitted mode only):
`{"policy": "exact-active-component-v1", "components": [{"source": <component>, "originReport": "public/models/.../derived-coverage.json"}]}`.

**Scope**
- `components` is a nonempty proper subset of the manifest components, in component order, with exact names.
  At least one component stays new.
- There is no material reuse. Every material and every new component must be absent from the active index, with
  ASCII case folded. Each declared component must be exactly one active entry.
- The report path must be explicit and lie outside this family's outputs.

**Preflight: the early receipt**
- Before extraction, preflight writes one receipt into `frozen-baseline.json`. Per component it holds `entrySha256`
  (the whole canonical entry, unknown fields included), `glbSha256`, `maskSha256` and `originReportSha256`.
- The entry is read from the hash-pinned `assets.json` bytes. File paths must match their exact on-disk case.
- The originating report must meet all of these:
  - It holds one completed A+idle fitted record for the source, naming the entry's mask file next to the report.
  - That record gives the entry's GLB and mask hashes and its UV tiles.
  - The report is a source-geometry, all-surfaces-covered, fitted-occlusion report with settings.
  - Its applied tags are this manifest's `fitted_tags`, and its helper, generator and body are today's files.

**Preflight: resume and conversion**
- A resume re-derives the receipt and compares it with the saved one; it never repins.
- A saved baseline without the receipt fails. So does an extraction or conversion that no receipt precedes.
- After conversion, the receipt is re-derived again. The fresh GLB must be byte-identical to the active GLB, with
  the entry's slot and default material. The pinned manifest carries the receipt verbatim.

**Freeze**
- Freeze re-derives the receipt and compares it with the manifest and with `frozen-baseline.json`.
- It then admits only the declared meshes, and writes the receipt into `adapter-baseline.json`. `_baseline()`
  requires that value, or its absence for ordinary v2.

**Index**
- The shared stage's `ACTIVE_MESH_REUSE` hook keeps exactly the pinned entries.
- The preserved-entry checks also require all of these:
  - the snapshot entry equals the pin;
  - the preview keeps it after rebasing;
  - the accepted files still match the receipt;
  - unknown `assets.json` and `supported-items.json` fields are unchanged.
- The unrelated-mask check exempts only new components.

**Coverage**
- Every component, reused or new, gets a fresh fitted derivation.
- Before the coverage-complete index, each reused record must reproduce the pinned mask bytes, UV tiles and mesh.
  Its report inputs and settings must equal the originating report's.
- Any difference fails closed. There is never a second mask, a dropped component or a `none` fallback. Fresh
  files are evidence only.

**Verify**: `verify` replays all of this read-only.

### Tag-delta policy (`exact-active-component-tag-delta-v1`)

This is a separately named opt-in under the same field. `exact-active-component-v1` is unchanged: its receipt shape
is the same, and its origin tags must still equal today's. Any other policy name fails. The request has the same
shape (`source`, `originReport`). A request that carries receipt fields or any extra key, such as a bypass flag,
fails.

This policy changes only one rule: the originating report may have applied other fitting tags than this manifest
applies today. Every other rule above still holds.

- **Origin tags.** The report's own `occlusionPolicy.fittingTags` must be a nonempty list of unique supported
  `Customization.Shape.(PushInsideClothes|ShrinkWrap|HeadNeckMatch)` tags. The ordered list must differ from today's
  applied tags; identical tags belong to `exact-active-component-v1`. Missing, empty, duplicate, non-string or
  unsupported tags fail. They are never ignored.
- **Other origin checks.** All the other origin checks still apply: exact GLB/mask/UV tiles, format, source
  geometry, all-surfaces-covered, fitted-occlusion, settings, today's body/helper/generator, and a completed A+idle
  record. The report is judged under its own recorded tags.
- **Early receipt.** Per component, the receipt adds three fields to the four pins:
  - `originFittingTags`: the report's ordered tags;
  - `appliedFittingTags`: today's ordered `fitted_tags`;
  - `fittingTagDelta`: `{removed, added}`, each in its own list order.

  These fields are written only under this policy. Before extraction, they go into `frozen-baseline.json`, and then
  verbatim into the pinned manifest and `adapter-baseline.json`.
- **Replay.** Every replay re-derives the tag fields from the pinned report bytes and today's manifest. This covers
  the preflight resume, `_reused_entries`, and the Node freeze's `assertComponentReuse`. A manifest's tag fields are
  never trusted on their own.
- **What fails after the early pin.** Any later change to the report, mask, GLB, whole entry or manifest tags fails.
  A self-consistent forged tag pin also fails.
- **Fresh coverage.** `require_fresh` compares every field it compares under v1 except `occlusionPolicy.fittingTags`.
  Those are checked instead:
  - the origin report must still record the pinned origin tags;
  - the fresh report must record exactly the pinned intended tags, not merely different ones;
  - the pinned delta must be exact.

  Mesh, mask-byte and UV identity, settings, body, helper and generator are compared as before. A changed mask fails
  closed.
- **Material reuse.** The `activeMaterialReuse` material slice works unchanged on top of this policy.

## Opt-in active material reuse (`activeMaterialReuse`)

Only a manifest that already has `activeComponentReuse` (at least one component stays new) may add it. Without it,
nothing changes: an already-active cohort material is still refused. Code: `multipart_material_reuse.py` and
`multipart-material-reuse.mjs`.

Request: `{"policy": "exact-active-material-v1", "materials": [{"source": "/Game/.../MI_X.MI_X"}]}`. List sources
sorted and unique (case-insensitive). Each one must be a cohort material, and at least one cohort material must stay
new. Preflight adds these pins per material:

- `entrySha256`: the canonical hash of the whole active binding. Only the documented URL string is accepted.
- `manifestSha256` and `canonicalSha256`: the manifest bytes, and its canonical JSON with every field, unknown fields
  included.
- `files`: the real byte hashes of the manifest, the `.glsl` and every `.rgba.gz.bin` texture it names.

Pin rules:

- Referenced files must be plain names beside the manifest, spelled with their exact on-disk case. Traversal,
  subfolders, unknown formats, missing files and case aliases are refused.
- The manifest texture `sha256` hashes decoded texels, not the file, so it is never compared with a file hash.

Stages:

- **Preflight** pins before any extraction, in `frozen-baseline.json`, and rechecks after conversion. A resume
  compares and never repins. A missing receipt fails.
- **Freeze** (`freeze-multipart-family.mjs`) re-derives the pins with the same canonical hash. It then stores them in
  `adapter-baseline.json`.
- **Build**: every material, kept ones included, is still extracted, built and checked on CPU/GPU and for geometry.
  After the CPU check, `material-reuse-proof.json` records each fresh staged bundle: canonical manifest and shader and
  texture bytes. It is written before any comparison, so a differing fresh output stays as evidence. Any difference
  fails, and no build record is written. The proof's hash joins the build hashes that the GPU record binds.
- **Index**: `prepare-large-sneakers.ACTIVE_MATERIAL_REUSE(added, active, PREVIEW)` keeps a declared binding only if:
  - it is exactly one active key, with no case variants;
  - the old bundle still matches its pins;
  - the staged fresh copy is identical.
  Undeclared overlaps, case collisions and unvalidated declared materials fail. The kept entry keeps its exact old URL;
  only new materials, components and items are added.
- **Preserved entries** add exactly the implemented materials minus the kept keys. Everything else must be unchanged.
- **Verify** replays the pins against the frozen `active-before` snapshot and today's old bundle bytes. It also
  re-derives the proof from today's staging and compares it with the saved one.

Hook leaks:

- A v2 family without the field refuses a leaked hook as `stage hooks`.
- `prepare-family.py` (v1, immutable) does not know this hook. Each family gets a private stage module, and the hook
  refuses any other `PREVIEW` and any addition without its declared, validated materials.
