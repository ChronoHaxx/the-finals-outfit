# Season 12 item refresh, tier 2 onward (22 Nov 2026)

Goal (user, 22 Nov: "do s12 clothing refresh"): refresh the garments Season 12 reworked so they fit the body they were
made for, continuing after tier 1 (PR #52, 9 meshes, 81 items). The plan is `PLAN.md`; the hand-off for the active
index is `APPLY.md`. This file records what was built, the review, and what is left.

## Files

| File | What |
|---|---|
| `PLAN.md` | inputs, census, route stages, batches A/B/C |
| `APPLY.md` | batch A: the merge recipe for a main-folder session, publish list, checks, rollback |
| `review-outfits-batchA*.json` | the review outfits (13 + emote subset + 2 for the reworks) |
| `functional-review.md` | the guided checklist, run by the agent under the standing waiver |

Data (ignored, this worktree): `scripts/generated/s12-refresh-tier2-v1/` — proofs, census, indexes, patches, captures.
`APPLY.md` step 0 copies it to the root checkout's `public/models/s12-refresh-tier2-v1/`.

## Tools (`scripts/body-types/`)

- `surface-match-proof.py` (new): for "surface differs" meshes, permuted vs reworked; texture fit; material slots.
  11 tests.
- `refresh-route-census.py` (new): route stage per refused mesh and S12 items per stage through the item rule's
  fixpoint.
- `build-preview-index.py`: `settle()` (the fixpoint, shared), `--admit-surface`, `--admit-rework`, a material-slot
  guard. 16 tests.
- `skin-by-name-proof.py`: 4 vs 8 influences is judged by weights ("influences"), not a loader refusal. 11 tests.
- `serve-preview.mjs`: finds the nearest `node_modules` (no junction); `--overlay` serves a worktree mirror of
  `public/`.

## Rebuild on a moved index

Git Bash, from the root checkout. Every step only reads the active index and refuses an existing output.

```bash
W=.claude/worktrees/angry-darwin-c51aab
O=$W/scripts/generated/s12-refresh-tier2-v1   # or the copied public/models/s12-refresh-tier2-v1
A=public/models/reconstructed-assemblies-v1
P=public/models/s12-bodytype-refresh-v1
N=v5    # a new suffix each time
PY="/c/ProgramData/anaconda3/python.exe -X utf8 -I"
node $W/_docs/body-types-2026-11-06/scripts/morph-census.mjs $A/assets.json $O/morph-census-$N.json
$PY $W/scripts/body-types/morph-only-proof.py $A/assets.json $P/meshes $O/morph-only-proof-$N.json
$PY $W/scripts/body-types/skin-by-name-proof.py $A/assets.json $O/morph-only-proof-$N.json $P/meshes public/models/body/SK_Body_M.glb $O/skin-by-name-proof-$N.json
$PY $W/scripts/body-types/surface-match-proof.py $A/assets.json $O/skin-by-name-proof-$N.json $P/meshes public/models/body/SK_Body_M.glb $O/surface-match-proof-$N.json
$PY $W/scripts/body-types/build-preview-index.py $A/assets.json $O/morph-only-proof-$N.json $P/meshes $O/index-batchA-$N/assets.json \
    public/models/reconstructed-assembly-v2/customization.json --census $O/morph-census-$N.json --changed-only \
    --admit $O/skin-by-name-proof-$N.json --admit-surface $O/surface-match-proof-$N.json \
    --admit-only $(cat $O/batchA-admit-only-final.txt) --admit-reviewed $(cat $O/batchA-admit-reviewed-final.txt) \
    --admit-rework $(cat $O/batchA-admit-rework-final.txt)
$PY $W/scripts/body-types/make-merge-patch.py $A/assets.json $O/index-batchA-$N/assets.json $O/merge-patch-batchA-$N.json
```

The anaconda Python is required (`python` in Git Bash is 3.7). Run Python from the root checkout so data paths
resolve there; Git Bash converts `/e/...` arguments for native programs, but not paths inside `-c` strings.

## Review (batch A)

Servers (this worktree's code, never 5174): 5241 live index, 5242 the batch-A merged index (`--live-body`, as the
garments-only merge). Captures: `scripts/generated/s12-refresh-tier2-v1/captures/`; diffs with `diff-captures.py`,
then the pair images looked at full size.

(results below)
