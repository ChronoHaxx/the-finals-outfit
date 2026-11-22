# Apply batch A to the active index (main-folder session)

For the session that owns the active index in the root checkout (`E:\Coding\the-finals-outfit`). The tier-2 session
cannot write the root checkout (worktree guard), so it prepared everything here. Nothing below has been applied,
uploaded or pushed. Do it only while the index is idle, after the coordinator's approval line.

## What it does

Repoints **113 garment meshes** to their Season 12 rebuilds, as data only (URL and sha256 lines). The body, skin pairs
and app code stay unchanged. Result: **1,422 items S12 throughout** (1,220 before, +202).

| Repointed | Meshes | How |
|---|---:|---|
| by proof: tier-1 "re-encoded" | 28 | `skin-by-name-proof.py` |
| by proof: "permuted" (same triangles, new vertex order) | 34 | `surface-match-proof.py` (new) |
| by review: weights / normals / morph set | 15 | captures, `README.md` |
| by review: permuted + weights / morph set | 5 | captures, `README.md` |
| by review: reworked with the same UVs (every UV set) and no masks | 2 | captures, `README.md` |
| released by the item rule (morph-only meshes it held until now) | 29 | `build-preview-index.py` |
| (admitted but still held by the item rule: their items show another pre-S12 mesh) | 33 | not repointed |

Racing_Helmet, KnightGlovesSpikesL and PhantomMaskTranslucent lose their `medium_male` morph in S12 (0.62 cm, 0.24 cm,
0.02 cm): a small production-Masculine change, included as game-faithful (coordinator told, 22 Nov).

## Files (from the tier-2 worktree)

`W=.claude/worktrees/angry-darwin-c51aab`, data in `$W/scripts/generated/s12-refresh-tier2-v1/` (ignored):
- `merge-patch-batchA-v5.json` — the patch, pinned to active `3f64b2e6…` and skin pairs `f15a73a2…`;
- `publish-list-batchA-v5.txt` — the 113 GLBs (89.7 MB), all under `public/models/s12-bodytype-refresh-v1/meshes/`;
- proofs and census behind it (`*-proof-v1/v3.json`, `route-census-v3.json`), the preview indexes and captures.

## Steps (Git Bash, from the root checkout)

```bash
W=.claude/worktrees/angry-darwin-c51aab
D=$W/scripts/generated/s12-refresh-tier2-v1
A=public/models/reconstructed-assemblies-v1
PY="/c/ProgramData/anaconda3/python.exe -X utf8 -I"

# 0. Keep the evidence: copy the tier-2 data next to tier 1's, so archiving the worktree loses nothing.
#    (New folder; robocopy /E never deletes. Exit code 1 = copied.)
cmd //c "robocopy $(cygpath -w $D) $(cygpath -w public/models/s12-refresh-tier2-v1) /E /XJ /NFL /NDL /NP"

# 1. Pins: must print 3f64b2e6… and f15a73a2…
sha256sum $A/assets.json $A/skin-pairs.json

# 2. Patched copy into a NEW folder (the tool refuses an existing one and every stale pin)
$PY $W/scripts/body-types/apply-merge-patch.py public/models/s12-refresh-tier2-v1/merge-patch-batchA-v5.json $A \
    public/models/s12-refresh-tier2-v1/merge-out-batchA-v5-applied --garments-only
#    expect: meshesRepointed 113, skinPairsRewritten 0, assetsSha256 3ddde00d…
git diff --no-index --stat $A/assets.json public/models/s12-refresh-tier2-v1/merge-out-batchA-v5-applied/assets.json
#    expect: 226 insertions, 226 deletions (a url and a sha256 line per mesh)

# 3. Back up the active assets.json, then swap the new one in your usual way.
mkdir public/models/s12-refresh-tier2-v1/backup-active-3f64b2e6-$(date +%F)
cp $A/assets.json public/models/s12-refresh-tier2-v1/backup-active-3f64b2e6-$(date +%F)/
```

If step 1 prints another hash, the index moved: **do not apply**. Ask the tier-2 session (or rerun
`README.md` → "Rebuild on a moved index"); every tool refuses stale inputs.

**Rollback:** copy the backup `assets.json` back over the active one (hash `3f64b2e6…`).

## Publish (coordinator approval, with the next release)

The 113 GLBs ship like tier 1's: staged on the release's leaf host under `models/s12-bodytype-refresh-v1/meshes/`,
reached through the release's rewrite of the control `assets.json` to absolute leaf URLs (that folder matches no
`routes` prefix). After deploy, every repointed URL must return 200 and gunzip to its pinned sha256 (hosted meshes are
gzip bodies without `Content-Encoding`).

## Checks after the apply

- Active `assets.json` = `3ddde00d…`.
- `morph-only-proof.py` + `skin-by-name-proof.py` on the new index, into new files: none of the 113 is refused any more
  (the live file is now the S12 file).
- `morph-census.mjs` on the new index: 986 body-type meshes, was 988 (Racing_Helmet and KnightGlovesSpikesL lose
  both body-type morphs; PhantomMaskTranslucent keeps `medium_female`).
- The usual live-worktree tests, and on 5174: `?outfit=` of `o01-rainjacket-combat` (Masculine, idle) should match
  `captures/idle-s12/s12/o01-rainjacket-combat/masculine-front.png`.
