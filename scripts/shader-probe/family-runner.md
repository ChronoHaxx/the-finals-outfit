# Ordinary single-mesh family runner

`prepare-family.py` and `freeze-family.mjs` replace per-family adapter/freeze/test copies for **new** ordinary
families: one skeletal mesh, one material slot, one material per choice, resolved on the Medium rig
(`Customization.Archetype.Medium`). Older adapters stay as they are. A new family needs only a manifest.

## Manifest (schemaVersion 1)

Every field is required except `marker` (default `shader-probe/prepare-family/<id>`). Unknown fields, wrong
types, unsupported coverage modes and overlapping or non-repository-relative paths are rejected. Example
(placeholder values; `mesh.sha256` must be the pinned preflight GLB hash):

```json
{
  "id": "example-family",
  "schemaVersion": 1,
  "paths": {
    "docs": "_docs/example-family-2026-09-16",
    "work": "scripts/generated/shader-probe/example-family-v1",
    "runtime": "public/models/reconstructed-example-family-v1",
    "preview": "public/models/reconstructed-example-family-preview-v1",
    "active": "public/models/reconstructed-assemblies-v1",
    "sourceIndex": "public/models/reconstructed-assembly-v2",
    "catalog": "src/data/items.json",
    "resolver": "src/rig/SourceAssembly.ts",
    "refresh": "scripts/generated/shader-probe/catalog-refresh-20260912",
    "appUrl": "http://127.0.0.1:4173/"
  },
  "mesh": {
    "source": "/Game/Discovery/Characters/Example/Assets/SK_Example_M.SK_Example_M",
    "slot": "Example",
    "itemSlot": "hands",
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "facts": {"vertices": 1, "triangles": 1, "uvSets": 2, "bones": 1, "materialSections": 1},
    "morphNames": ["medium_male", "medium_female"]
  },
  "fittingTags": ["Customization.HideMesh.NailsCovered"],
  "coverage": {"mode": "derived"}
}
```

- Outputs: `docs` under `_docs/`, `work` under `scripts/generated/shader-probe/`, `runtime` and `preview` under
  `public/models/`; no output may equal or nest in another output or any input (`active`, `sourceIndex`,
  `catalog`, `resolver`, `refresh`).
- `appUrl`: plain `http` on `localhost`/`127.x.x.x`/`[::1]`, any port, no query or fragment.
- `fittingTags` is compared as an exact set (order free, no duplicates); `[]` means the definitions activate no
  tags. `morphNames` is exact by name and order.
- `coverage.mode`: `derived` (build-companion-masks.mjs as before), `conservative-shared-uv` (the same command with
  `--conservative-shared-uv`), `none` with a required `reason` (no derivation; this mesh gets no mask and
  unrelated masks stay inherited), or the explicit opt-in `fitted-conservative-shared-uv` (see *Fitted coverage
  mode* below; the manifest must list at least one fitted shape tag).
- `docs` holds the preflight `cohort.json`, `mesh-report.json` and `frozen-baseline.json` (still read by the
  shared index stage; pinned automatically by preflight before extraction).

## Stage order (from the repository root)

```
python scripts/shader-probe/prepare-family.py --manifest M mesh
node --import tsx scripts/shader-probe/freeze-family.mjs --manifest M
python scripts/shader-probe/prepare-family.py --manifest M source
python scripts/shader-probe/prepare-family.py --manifest M build
python scripts/shader-probe/prepare-family.py --manifest M gpu
python scripts/shader-probe/prepare-family.py --manifest M index
python scripts/shader-probe/prepare-family.py --manifest M coverage
python scripts/shader-probe/prepare-family.py --manifest M verify
node --import tsx scripts/shader-probe/freeze-family.mjs --manifest M --verify-only
```

1. **mesh** validates the pinned preflight conversion (extraction/conversion stays in the shared `s.mesh` API):
   report/GLB/DTO hashes, the exact mesh request and package, one SkeletalMesh, the one manifest slot in DTO and
   GLB, manifest facts, original UV sets, skinning, morph names/order and zero default weights.
2. **freeze** resolves every choice through the manifest's `SourceAssembly.ts` and writes `resolved-cohort.json`,
   `batch.json` and `adapter-baseline.json` together. The baseline (advertised/indexed/catalog counts, structural
   readiness through `resolveSourceRigParts`, the unadvertised structurally ready ids, hashes of the active index
   and catalog, the manifest hash) is derived once. A rerun compares the full set first: identical is a no-op,
   any drift or a partial set fails before writing.
3. **source/build/gpu/index/coverage** run the Large Sneakers stages on a private module instance and require,
   before and after, the unchanged manifest and bindings, mesh contract, frozen cohort/tags/definition hashes,
   same-build mesh and material sources, and an active index equal to `adapter-baseline.json`. gpu archives a
   fresh content-addressed run tied to the build outputs; index/coverage refuse a GPU run that is stale, reused or
   older than the build. The preview must add only this family and keep the baseline's unadvertised ids.
4. **verify** (read-only) replays the same mesh, cohort, build, UV-geometry and GPU evidence and checks the saved
   preview against the saved baseline. It does not compare against today's active index (the family may already
   be active) and fails if any file under the manifest folders changed. `--verify-only` freeze replays current
   source and resolver against the saved choices without writing.

Acceptance and activation stay with Astra: every preview keeps `visualAcceptance`/`humanAcceptance` pending.

## Complete batch workflow

Use `preflight-family.py --request REQUEST.json --include-materials` to pin current source defaults,
extract/convert the mesh through the existing shared converter, and produce the manifest. The three
reviewed request/manifest examples are under `_docs/family-runner-2026-09-16/pilot/`.
Then `run-family.py --manifest MANIFEST.json` runs the stage order above and saves separate logs and
timings. Reuse `capture-family.mjs` with a data-only capture configuration, and
`check-family-outfits.mjs MANIFEST SCENARIOS NEW_OUTPUT preview` for fitting/visibility transitions.
Hands can use the shared `positive-x-item` capture framing. Screenshots still need visual inspection.

`run-family-review.mjs MANIFEST CONFIG_DIRECTORY NEW_VERSION` validates the data-only `variants.json`,
`geometry-a.json`, `geometry-idle.json` and `outfits.json`, filters out non-implemented variants, and runs
the three capture passes plus outfit transitions with separate logs/timing. It never activates items.
`family-review-sheet.py --report REPORT --output NEW_IMAGE --slot SLOT` makes diagnostic overview sheets;
inspect original close-ups and combined outfits too. A passing browser report does not establish visual
acceptance. The September 17 batch caught a Varsity cuff gap only during the combined rear view, and
deferred that family despite its earlier contact-sheet review and automated passes.

### Generate routine review configs

`generate-family-review.mjs` creates those four config files from a saved family manifest and a reusable
profile in `review-profiles.json`. Supported baseline profiles are `upperBody`, `lowerBody`, `hands` and
`upperBack`, each for one ordinary mesh and one material per candidate. For example, from the repository root:

```text
node scripts/shader-probe/generate-family-review.mjs PATH_TO_FAMILY.json hands NEW_CONFIG_DIRECTORY
node scripts/shader-probe/run-family-review.mjs PATH_TO_FAMILY.json NEW_CONFIG_DIRECTORY NEW_REVIEW_VERSION
```

The output directory must not exist. The generator validates the manifest/cohort mesh and slot, exact item
bindings, catalog membership, preview implementation IDs, and profile cameras/base outfit before writing.
`variants.json` retains every cohort candidate because the review runner filters it to implemented IDs;
geometry and outfit scenarios select only implemented candidates. Implementation eligibility does not mean
visual acceptance: a source-ready family with a known defect can still be reviewed without being activated.

The default geometry representative is the first eligible ID in ordinal order, and the alternate is the next
distinct eligible ID. Use `--representative ID` and `--alternate ID` for a deliberate choice. Invalid/deferred
IDs fail. An alternate that collides with the default representative requires an explicit different
representative. A singleton omits only the switch step and records why. Every profile generates front/back
variant views, eight geometry angles in A and idle poses, and equip/switch/remove/restore/idle/rear outfit
scenarios. Camera or pose changes reload the page instead of using a same-page swap that would ignore them.

Hands add both positive- and negative-X outfit views; lower-body adds a rear view with the shirt removed to
expose the waistband. Hands retain detailed A-pose framing and use a wider root-centered idle view: a tight
camera at the lowered hand can enter the torso during rotation. Profiles can specify `idleCapture` with a
`camera` and `framing` override. These baseline profiles **do not replace** extra family-specific cuff, footwear,
attachment, fitting or defect scenarios. Inspect the generated framing and keep those additional cases.
Changing routine framing is a JSON profile edit, not a new family implementation.

`receipt.json` separates candidates, implemented IDs and excluded IDs, pins exact input/output hashes and
the CLI generator/validator/harness code hashes, and leaves visual/human acceptance pending. Generation
does not render, replay GPU/source verification, change the active index or publish anything. Identical inputs
produce identical configs; a receipt changes when its input or implementation provenance changes.

All tools must use the same actual app: `paths.catalog`, `paths.resolver` and `paths.appUrl` refer to the
product checkout, even when it is a nested worktree. Coverage derives `APP_ROOT` from that resolver;
`APP_URL` must point to its running server. This prevents checking a stale parallel checkout.

For independent previews frozen from the same baseline, `merge-family-previews.py` creates a combined
preview after source, visual and outfit acceptance are recorded. Review that combined outfit before
using its explicit `--activate` option; activation rechecks evidence and retains the original active
index as a rollback copy. It only activates local data. Publication and human acceptance are separate.

For a held family whose only change is a derived body mask, retain its original manifest and preview.
Stage a sibling preview containing that mask change and review it. Acceptance may add
`coveragePreviews: { "family-id": { "preview": "public/models/...", "coverageReport": "public/models/.../derived-coverage.json" } }`
and `activeBaselineHashes` pinning the three **current** active index files. The same merger verifies the
original frozen evidence, limits the amendment to that source mesh's coverage fields, checks geometry/body
and mask hashes, and rejects new hidden texels, changed UV layout, emptied coverage, or unrelated changes.
It merges into the current baseline, preserving intervening accepted additions. Combined preview and
visual acceptance still precede activation. See `_docs/coverage-boundaries-2026-09-17/acceptance.json`.

Check overlapping body UVs before introducing a new coverage algorithm. In the September 17 follow-up,
the existing `conservative-shared-uv` policy closed the Varsity cuff gap for nine variants. The opening-rim
and fan experiments were not activated; their retained evidence does not justify a general coverage claim.

The first pilot accepted 32 choices across three families without adding family-specific Python,
JavaScript or test files. Its replay, limitations and accounting are recorded in
`_docs/family-runner-2026-09-16/acceptance.md`.

### Fitted occlusion preview masks

`build-companion-masks.mjs --fitted-occlusion` is an explicit derived-coverage experiment for source
assemblies with body fitting tags. Use it with `--all`, exact `--items`, `--conservative-shared-uv`,
`--fitting-tags` containing the recorded comma-separated tags, and a new `--output` folder. It
computes the previous zero-fitting mask unchanged, then tests fitted body texel centres with
outward occlusion rays. The footprint repair also evaluates triangle/cell intersection vertices
in a boundary flood, including partial cells whose centres lie on another triangle. Rays start
at the skin surface. It only restores skin; it cannot add hidden texels. Existing output folders
are rejected. The default policy remains unchanged.

Each report records the previous mask hash, source body/mesh hashes, generator/helper hashes,
fitting tags, ray settings and per-pose statistics. The diagnostic PNG marks normal-ray restoration
red, oblique-ray restoration green and retained hiding full blue. Blue 128 together with red/green
marks restoration only through a footprint vertex. `coveredTriangles` remains the old
projection count; use the explicit pixel/restoration fields for the candidate. This is a preview
heuristic, not recovered native culling. CPU/GPU skinning, sub-texel pockets and silhouette corners
missed by the samples, mipmapped minification, other fitting combinations and views beyond the
sampled directions remain limitations.

The September 17 waist task visually accepted nine Oversized Cargo Pants with the first policy;
their saved masks remain unchanged. The footprint repair closes the visible Starter Pants gap
for twelve variants. Three isolated edge-pixel differences remain against a no-mask control, so
the Starter result is reviewed for blue/polish Medium coverage, not the stricter seam-free gate.
Do not enable the policy for an entire queue from a structural or numeric pass.
Preserve the original family evidence, stage a mask-only amendment, and run focused openings before
the full family/outfit review and guarded merge. Evidence: `_docs/waist-coverage-2026-09-17/starter-repair/`.

#### Fitted coverage mode for new manifests

A **new** manifest can opt in with `"coverage": {"mode": "fitted-conservative-shared-uv"}`. The mode never
applies automatically. Historical manifests, masks and accepted evidence are unchanged, and the older modes
keep their commands and checks. The coverage stage runs the same generator:
`--all --items <implemented ids> --index <preview> --output <runtime>/coverage --conservative-shared-uv
--fitted-occlusion --fitting-tags <applied>`. The applied tags are the manifest `fittingTags` that fully match
`Customization.Shape.(PushInsideClothes|ShrinkWrap|HeadNeckMatch).<leaf>`, in manifest order. Both validators
reject the mode when no tag matches. Other tags stay in the manifest and runtime metadata, but the generator
does not receive them.

- `<runtime>/coverage` must not exist, not even as an empty folder. After a failed or rejected run, keep that
  folder and use a new runtime folder (a new manifest). Do not delete the folder and retry.
- Before the shared index stage runs, the report must be a completed fitted report with the following checks:
  `fitted-occlusion` policy, `all-surfaces-covered` shared-UV policy, exactly the applied tags, and
  generator/helper hashes equal to the files that ran. It must also be derived from this preview, with one
  record for the pinned manifest mesh hash and the current Medium body hash. A/idle fitted counts must be
  present, and the folder must contain only the report, mask and diagnostic PNG, with hashes that match.
  `progress.json` then pins this evidence and the exact command in its one `coverage-derived` record.
- `index`, `coverage` and read-only `verify` replay the pinned evidence and require the preview mask for this
  mesh, and its UV tiles, to match the pinned mask. An unpinned, changed or unfitted report, or a changed PNG,
  fails.

This is the same derived, Medium-only preview heuristic with the limitations above. It is not native engine
culling. Enabling it does not fix the whole queue. Focused openings, full visual/outfit acceptance and the
guarded merge are still required before activation.


### Active mesh reuse (opt-in, schemaVersion 1 only)

This mode adds **new** material variants for a mesh that the active index already binds. A request opts in with
`"activeMeshReuse": {"policy": "exact-active-entry-v1"}`. If the field is absent, every stage, receipt and gate is
unchanged, and the shared index still refuses any active mesh. schemaVersion 2 rejects the field.

- **Supported:** one skeletal Medium mesh with exactly one slot, coverage mode `derived` or
  `conservative-shared-uv`, and an active entry with complete `bodyMaskUrl`/`bodyMaskUvTiles`/`coverageSource`.
  Every cohort material must be absent from active `materials` (case-insensitive), and no candidate may already
  be advertised or skin-paired.
- **Deferred:** `none`/fitted coverage, entries without a mask, multipart reuse and material reuse.
- **preflight** pins the entry, GLB and mask bytes *before* any extraction, from the same `assets.json` bytes it
  hashes, and saves that early pin (plus `source`) as `activeMeshReuse` in `frozen-baseline.json`. A resumed
  preflight must re-derive exactly the saved pin; a saved baseline without it, or a conversion without a saved
  baseline, is refused (use a new docs folder). After the conversion the current entry, GLB and mask must still equal
  the early pin, the fresh GLB must equal the active GLB byte for byte, and the source slot/default must equal the
  entry `slots`. The manifest gets the early pins: `entrySha256`, `glbSha256` (= `mesh.sha256`) and `maskSha256`.
  Freeze re-derives them, requires any early pin to match, and records them in `adapter-baseline.json`. Requests
  without the field write `frozen-baseline.json` exactly as before; accepted evidence without an early pin verifies
  unchanged.
- **Entry hash** (`family_active_reuse.canonical` = `freeze-family.mjs` `entryCanonical`): sorted keys (UTF-16
  order), no spaces, numbers as `JSON.stringify` prints them (`1.0` -> `1`, `-0.0` -> `0`, `1e-07` -> `1e-7`).
  Integer/string/array entries hash as before. Non-finite numbers, integers beyond +-(2^53-1) and lone surrogates
  are refused on both sides, never rounded; unknown fields are hashed whole.
- **Every stage** rechecks the pins against the current active files (`verify` uses the frozen `active-before`
  snapshot). The shared index keeps the whole active entry, unknown fields included, through the scoped
  `ACTIVE_MESH_REUSE` hook. It adds only new materials and ids and records `reusedActiveMeshes`. Pre-existing
  meshes, materials, other assets keys, skin pairs, supported rows, exclusions and metadata must equal the
  snapshot after rebasing.
- **coverage** runs the family's normal command once into a new `<runtime>/coverage`. The result must be an
  unfitted report for this preview, pinned GLB and current body, and its mask bytes and UV tiles must equal the
  active mask. If anything differs, the stage fails closed: nothing is indexed, and `index`/`verify` refuse the
  unpinned folder. The structural preview never passes `verify`. Materials, CPU and GPU checks always run fresh.

For the two proof cases (Tactical Boots Pouch OSPUZE, Racing Gloves IVADA), Astra writes a normal single-choice
request (new id and folders, `cohort.json` with the new material) using the old mesh/slot/itemSlot/fittingTags.
The request uses `coverage.mode` `conservative-shared-uv` for Tactical Boots Pouch (the old manifest mode). Racing
Gloves has no old family manifest, so choose the mode whose fresh mask reproduces the active bytes; if neither
does, the item stays out. Then run `preflight-family.py --include-materials` and the usual stage order.

### Body and companion fitting evidence

For an opted-in fitted coverage manifest, the initial structural preview is input to derivation only.
Final `verify` requires the completed pinned fitted report and its indexed preview; skipping `coverage`
cannot satisfy the verification gate used by the guarded merger.

`check-family-outfits.mjs` records the final product `__sourceAssembly` and all rig mesh morphs through `family-fitting-evidence.mjs`. The product resolver cross-checks the effective definitions; requested and effective IDs/tags remain separate so a complete coat's suppressed shirt cannot contribute fitting. Only that specific shirt omission is explained by a BodyUpper conflict. Body/support meshes receive the same weight/bookkeeping checks as candidates. Tags without a drivable morph are reported without a compatibility claim.

For same-page A/B/A scenarios, observed inactive weights form restoration baselines per mesh UUID. Nonzero values are preserved; first-seen-active states cannot prove their original baseline. Reload resets the tracker and replacement meshes get separate baselines. Failures retain the full fitting snapshot. These checks verify implemented fitting behavior, not native-game visual fidelity. Existing capture/material/request checks remain. Evidence and13 behavioral tests: `_docs/fitting-evidence-2026-09-17/acceptance.md`.
