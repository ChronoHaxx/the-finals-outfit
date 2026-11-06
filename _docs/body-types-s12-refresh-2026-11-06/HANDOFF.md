# Hand-off to the main session: Season 12 body-type refresh batch

For the session that owns `scripts/generated/catalog-public-worktree` and the active index. Nothing here has been
merged, pushed or published. Merge only when you are idle **and** the user has agreed, after their checks in
`functional-review.md`.

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
