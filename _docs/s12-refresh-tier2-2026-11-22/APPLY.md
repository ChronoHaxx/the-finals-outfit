# Apply batch A to the active index (main-folder session)

For the session that owns the active index in the root checkout (`E:\Coding\the-finals-outfit`). The tier-2 session
cannot write the root checkout (worktree guard), so it prepared everything here. Nothing below has been applied,
uploaded or pushed. Do it only while the index is idle, after the coordinator's approval line.

## What it does

Repoints **104 garment meshes** to their Season 12 rebuilds, as data only (URL and sha256 lines). The body, skin pairs
and app code stay unchanged. Result: **1,410 items S12 throughout** (1,220 before, +190).

Batch A also completes tier 1's "batch 2" (the rest of tier 1 after the pilot, PR #52), rebuilt on `3f64b2e6`. See
`README.md` → "Tier-1 batch 2".

| Repointed | Meshes | How |
|---|---:|---|
| by proof: tier-1 "re-encoded" | 26 | `skin-by-name-proof.py` |
| by proof: "permuted" (same triangles, new vertex order) | 33 | `surface-match-proof.py` (new) |
| by review: weights / normals / morph set | 14 | captures, `README.md` |
| by review: permuted + weights / morph set | 4 | captures, `README.md` |
| by review: reworked with the same UVs (every UV set) and no masks | 2 | captures, `README.md` |
| released by the item rule (morph-only meshes it held until now) | 25 | `build-preview-index.py` |
| (admitted but still held by the item rule: their items show another pre-S12 mesh) | 28 | not repointed |

**Every repointed mesh's package is byte-identical in today's (17 Nov) game containers** to the 6 Nov 12.00 read it
was built from (`package-proof-1117-v1.json`, coordinator condition of 22 Nov). Five batch-A meshes whose packages
changed on 17 Nov stay live, and three more stay live because their items show one of those five (see `README.md`).
`SK_Streetwear_PopGothShoes_M` is held: in the feet review its S12 weights stretch the lower lacing (`README.md`).

Racing_Helmet, KnightGlovesSpikesL and PhantomMaskTranslucent lose their `medium_male` morph in S12 (0.62 cm, 0.24 cm,
0.02 cm): a small production-Masculine change, included as game-faithful (coordinator, 22 Nov: "include the four").
The fourth, Cleats, is held with batch B. To drop the three, remove their entries from the patch's `meshes` before
step 2.

## Files (from the tier-2 worktree)

`W=.claude/worktrees/angry-darwin-c51aab`, data in `$W/scripts/generated/s12-refresh-tier2-v1/` (ignored):
- `merge-patch-batchA-v8.json` (sha256 `876e2f75…`): the patch, pinned to active `3f64b2e6…` and skin pairs
  `f15a73a2…`;
- `publish-list-batchA-v8.txt`: the 104 GLBs (81.5 MB), all under `public/models/s12-bodytype-refresh-v1/meshes/`;
- `package-proof-1117-v2.json`: per mesh, the package sha256 on 6 Nov and today;
- proofs and census behind it (`skin-by-name-proof-v2.json`, `surface-match-proof-v4.json`, `route-census-v3.json`),
  the preview indexes and captures.

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
$PY $W/scripts/body-types/apply-merge-patch.py public/models/s12-refresh-tier2-v1/merge-patch-batchA-v8.json $A \
    public/models/s12-refresh-tier2-v1/merge-out-batchA-v8-applied --garments-only
#    expect: meshesRepointed 104, skinPairsRewritten 0, assetsSha256 b4f28192…
git diff --no-index --stat $A/assets.json public/models/s12-refresh-tier2-v1/merge-out-batchA-v8-applied/assets.json
#    expect: 208 insertions, 208 deletions (a url and a sha256 line per mesh)

# 3. Back up the active assets.json, then swap the new one in your usual way.
mkdir public/models/s12-refresh-tier2-v1/backup-active-3f64b2e6-$(date +%F)
cp $A/assets.json public/models/s12-refresh-tier2-v1/backup-active-3f64b2e6-$(date +%F)/
```

If step 1 prints another hash, the index moved: **do not apply**. Ask the tier-2 session (or rerun
`README.md` → "Rebuild on a moved index"); every tool refuses stale inputs.

**Rollback:** copy the backup `assets.json` back over the active one (hash `3f64b2e6…`).

## Publish (coordinator approval, with the next release)

The 104 GLBs ship like tier 1's: staged on the release's leaf host under `models/s12-bodytype-refresh-v1/meshes/`,
reached through the release's rewrite of the control `assets.json` to absolute leaf URLs (that folder matches no
`routes` prefix). After deploy, every repointed URL must return 200 and gunzip to its pinned sha256 (hosted meshes are
gzip bodies without `Content-Encoding`).

## Checks after the apply

- Active `assets.json` = `b4f28192…`.
- `morph-only-proof.py` + `skin-by-name-proof.py` on the new index, into new files: none of the 104 is refused any
  more (the live file is now the S12 file).
- `morph-census.mjs` on the new index: 986 body-type meshes, was 988 (Racing_Helmet and KnightGlovesSpikesL lose
  both body-type morphs; PhantomMaskTranslucent keeps `medium_female`).
- The usual live-worktree tests, and on 5174: `?outfit=` of `o01-rainjacket-combat` (Masculine, idle) should match
  `captures-v7/func-idle-s12/s12/o01-rainjacket-combat/masculine-front.png` (v7 and v8 differ only in the
  PopGoth shoes, which o01 does not wear).
