# Hand-off to the main session: Season 12 body-type refresh batch

For the session that owns `scripts/generated/catalog-public-worktree` and the active index. Nothing here has been
merged, pushed or published. Merge only when you are idle **and** the user has agreed, after their checks in
`functional-review.md`.

## Current recipe (6 Nov evening): index-v4, rebuilt on the moved index

**Applied.** The main session ran the garments-only recipe below on 6 Nov at 19:57 UTC: 178 repointed. The active
index is now `assets.json` `5c36c6b6…` with skin pairs unchanged at `f15a73a2…`. It ships in the 6 Nov release PR.
Record: `functional-review.md` ("Recorded result").

Everything below `## What the batch is` describes the earlier `index-v3` and `merge-patch-v1`. Those are pinned to the
old index `ae2c1ac0…` and **must not be applied**.

### The rebuild

The active index moved to `acdb9897…` (waves 104–116 and the kaiju pair). The rebuild was read-only on it, into new
files:
- **Census:** `inventory/morph-census-v2.json`. 1,460 meshes, 938 with a body-type morph. The 14 new ones are backfill
  meshes.
- **S12 read of the 14:** read offline with the pinned 12.00 mapping (`s12-read/requests-02.json`, raw records in
  `scripts/generated/shader-probe/s12-bodytype-refresh-v1/read-02`), built into `meshes-w152/` and copied into
  `meshes/`. The copy added files only; it overwrote nothing.
- **Proof:** `public/models/s12-bodytype-refresh-v1/morph-only-proof-v2.json`. 695 morph-only and 242 refused.
  - All 14 new meshes are morph-only with no morph change: the backfill was already built from S12 sources.
  - The 923 earlier rows are unchanged.
- **`index-v4`:** the active index plus the same 179 repoints as `index-v3`. Skin pairs are equal.
- **Coverage:** `coverage-v4.json`. 2,876 supported items: 1,135 S12 throughout, 885 mixed, 856 with no body-type mesh.
  No existing item changed status.
- **Patch:** `merge-patch-v2.json`, pinned to assets `acdb9897…` and skin pairs `f15a73a2…`.

### Two ways to merge

| | Garments only (recommended for production now) | With the S12 body |
|---|---|---|
| Repoints | 178 garments | 178 garments + `SK_Body_M` |
| App/tool change | none | yes: the body path is pinned in 12 places (below) |
| Production (masculine) | 83 garments change shape > 0.1 cm (28 > 1 cm) | the same, plus the body's `push_lower_torso` (0.79 cm, under 148 items) |
| Masculine captures | pixel-identical to the reviewed full candidate in 64 of 64 shots (16 outfits × 4 cameras) | reviewed earlier: no new defect |
| Dev-gated feminine | S12 garments on the live body. In the sampled outfits it is clean where the full candidate clipped at the dress hem (b2) and the tube top (b5). The cross-slot belt clips (b3, b4) remain. The live corset poke-through (a7) remains, because only the S12 body fixes it. | as reviewed in README section 6 |

The full-body variant needs these changes in the live worktree, in the same merge:
- `src/components/CharacterViewer.tsx`: the source-body URL.
- `src/rig/LegacyBodyCoverage.ts`: the regex gate (otherwise legacy body coverage silently switches off).
- `src/lib/reconstruction-status.ts`.
- `tests/legacy-body-coverage.test.ts`.
- `scripts/check-production.mjs` and `scripts/lib/reconstruction-assets.mjs`.
- `scripts/shader-probe/check-skin-pair.mjs`, `check-source-fitting.mjs`, `check-hair-rig.mjs`, `check-source-coat-poses.mjs`, `build-companion-masks.mjs` and `catalog-audit.mjs`.

The data part is `apply-merge-patch.py --body-url`. It rewrites `attachmentBody`, the body mesh entry and all 36 skin
pairs' `body.url`.

### Garments-only recipe

Run in **Git Bash**, from the root checkout `E:\Coding\the-finals-outfit`, while idle:

```bash
W=.claude/worktrees/quizzical-hermann-33b51b
A=public/models/reconstructed-assemblies-v1
sha256sum $A/assets.json $A/skin-pairs.json   # must be acdb9897… and f15a73a2…
python -I $W/scripts/body-types/apply-merge-patch.py $W/_docs/body-types-s12-refresh-2026-11-06/merge-patch-v2.json $A public/models/s12-bodytype-refresh-v1/merge-out-v2 --garments-only
```

What to expect, and how to swap the file in:
- The tool prints `meshesRepointed 178`, `skinPairsRewritten 0`, `assetsSha256 5c36c6b6a08e7d59…`, and skin pairs
  unchanged (`f15a73a2…`).
- `public/models/s12-bodytype-refresh-v1/index-v4a/assets.json` is the same output, made earlier with the same command.
- `git diff --no-index --stat $A/assets.json …/merge-out-v2/assets.json` shows 356 insertions and 356 deletions: a URL
  and a sha256 line for each of the 178 meshes.
- Swap it into place your usual way, after backing up the active `assets.json`.

**Publish** the 178 GLBs listed in `publish-list-v2.txt` (126.8 MB, all under
`public/models/s12-bodytype-refresh-v1/meshes/`). Publish only those, not the whole folder: it also holds 759 other
rebuilds and the index folders.

**Checks after the merge:**
- The active `assets.json` hashes to `5c36c6b6…`.
- The census on the merged index still finds 938 body-type meshes.
- `morph-only-proof.py` against the merged index, into a new file: the 178 swapped garments now report no morph change,
  because live is the S12 file. `SK_Body_M` and the held meshes still report changes.
- The live worktree's usual test and production checks.
- On 5174, the masculine football hoodie with the municipal pants (`sport-footballhoodie-jersey` +
  `municipal-pants-nylon`) should match `review-v4a/s12/a8-masculine-change/masculine-*.png`.

## What the batch is

- **Meshes:** `public/models/s12-bodytype-refresh-v1/meshes/` holds 923 S12 rebuilds. 179 of them are used: 178
  garments plus `SK_Body_M`. They are new files in a new folder, and nothing existing was touched.
- **Merge candidate index:** `public/models/s12-bodytype-refresh-v1/index-v3/assets.json`. It is a copy of the active
  index at sha256 `ae2c1ac0…` with 179 mesh entries repointed (URL and sha256), the body's sha256 changed, and an added
  `s12BodyTypePreview` metadata block (drop it or keep it; the app ignores it).
- **Skin pairs:** unchanged. `index-v3/skin-pairs.json` is equal to the active file as JSON, but its bytes are
  formatted differently, so its sha256 differs. Keep the active file; only the body URL decision below touches it.
- **Patch form:** `_docs/body-types-s12-refresh-2026-11-06/merge-patch-v1.json` lists every changed entry, from and
  to. It is pinned to the active index and skin-pairs hashes it was built on.

Each repointed mesh was proven to differ from its live GLB **only in morph deltas** (`morph-only-proof.py`). Every
derived artefact keyed to the live mesh stays valid: body masks, material bindings, wraps and transfers.

## Before merging: two decisions

1. **The body URL.** The preview server answers `models/reconstructed-meshes-v2/SK_Body_M.glb` with the S12 body,
   because `CharacterViewer.tsx` hard-codes that path and the rig accepts skin pairs only on it. A real merge must not
   overwrite the preserved file. The smallest route:
   - publish the S12 body at `models/s12-bodytype-refresh-v1/meshes/SK_Body_M.glb`;
   - change the source-body URL the viewer loads (`CharacterViewer.tsx`, `rig.loadBody(..., modelUrl(...))`) to that
     path, or read it from the index's `attachmentBody.url`;
   - set the index's `attachmentBody.url` and `meshes[SK_Body_M].url`, and every skin pair's `body.url`, to
     `../s12-bodytype-refresh-v1/meshes/SK_Body_M.glb`.
   - `reconstruction-status.ts` also names the preserved path for legacy body coverage. The S12 body has the same
     vertices, indices and UVs (morph-only proof), so that coverage stays valid, but the constant must follow.
   The S12 body differs from the preserved one in exactly two morphs: `medium_female` (3.65 cm max) and
   `push_lower_torso` (0.79 cm).
2. **Ship now, or wait for the refresh route.** 885 supported items stay mixed until their reworked meshes go through
   the S12 item refresh route (`refused-meshes.md`). The agent review found new defects on feminine in 4 of 5 mixed
   outfits, two of them from cross-item layering that the item rule cannot see. The user chooses between the three ways
   forward at the end of `README.md` section 6:
   - wait for the refresh;
   - an outfit-level morph fallback (a rig change);
   - masculine-only now.

   `route-review-2026-11-06.md` recommends the fallback made asymmetric: `medium_female` only, with `medium_male` S12
   per mesh. It also records three things:
   - the fallback needs baked `_s12` targets, including `push_lower_torso` on the body;
   - it needs per-mesh flags in the index;
   - the active index is now `acdb9897…`, so the section below applies.

## If the active index moved since `ae2c1ac0…`

Do not apply the patch. Rebuild the candidate on the new index. All of this is read-only on the active index, and every
tool refuses an existing output. Run in **Git Bash**, from this worktree
(`E:\Coding\the-finals-outfit\.claude\worktrees\quizzical-hermann-33b51b`):

```bash
P=../../../public/models/s12-bodytype-refresh-v1
A=../../../public/models/reconstructed-assemblies-v1
D=_docs/body-types-s12-refresh-2026-11-06
node _docs/body-types-2026-11-06/scripts/morph-census.mjs $A/assets.json $D/inventory/morph-census-v2.json
python -I scripts/body-types/morph-only-proof.py $A/assets.json $P/meshes $P/morph-only-proof-v2.json
python -I scripts/body-types/build-preview-index.py $A/assets.json $P/morph-only-proof-v2.json $P/meshes $P/index-v4/assets.json ../../../public/models/reconstructed-assembly-v2/customization.json --census $D/inventory/morph-census-v2.json --changed-only
python -I scripts/body-types/rewrite-skin-pairs.py $A/skin-pairs.json $P/index-v4/assets.json $P/index-v4/skin-pairs.json
```

Rerunning the proof compares the rebuilds with whatever the new index points at: a mesh the main session rebuilt in the
meantime (a new weight transfer, say) is judged again. `build-preview-index.py` stops if a proven mesh's live URL
changed since the proof, or if the census describes another index. A mesh newly merged with a `medium_*` morph and no S12
rebuild counts as pre-S12, so it holds its items. To include it, read and rebuild it first (README step 2).

## Preview servers (this worktree, never 5174)

**PowerShell**, in `E:\Coding\the-finals-outfit\.claude\worktrees\quizzical-hermann-33b51b`:

```powershell
node scripts/body-types/serve-preview.mjs --port 5193
```

```powershell
node scripts/body-types/serve-preview.mjs --port 5194 --preview ../../../public/models/s12-bodytype-refresh-v1 --index ../../../public/models/s12-bodytype-refresh-v1/index-v3
```

5193 is the live index and 5194 the merge candidate. Both serve this worktree's app code, which is main plus stage 1
(`?bodyType=`), not the live worktree's code.
