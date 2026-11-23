#!/bin/bash
# Re-plan the tier-2 S12 refresh (v9 and later: batch B plus mask-only fixes for batch A) on whatever index is active.
# Git Bash, from the root checkout. Usage: bash replan.sh SUFFIX   (a new suffix each time, e.g. v10)
#
# Every step only reads the active index and refuses an existing output. Inputs that do not depend on the index are
# reused: the package proof (17 Nov containers), the mask proofs (masks regenerated from pinned GLB files; the builder
# refuses one whose files or mask list no longer match), the shipped S12 masks and the admission lists.
#   W     the tier-2 worktree (default .claude/worktrees/angry-darwin-c51aab)
#   O     its data folder, or the copy in public/models/s12-refresh-tier2-v1
#   TOOLS scripts/body-types of the worktree, or of main once PR #84 is merged
#   PROOFS reuse the census and proofs of an earlier suffix on the SAME active index (skips the slow steps)
#   LISTS  prefix of the admission lists, LISTS-admit-{only,reviewed,rework}.txt in O (default v9)
#   MASKS  mask proofs, comma-separated paths (default batch A's and batch B's)
#   SHIP   file holding the --ship-s12-masks value (default O/ship-masks-v9.txt)
set -euo pipefail
N=${1:?usage: replan.sh SUFFIX}
W=${W:-.claude/worktrees/angry-darwin-c51aab}
O=${O:-$W/scripts/generated/s12-refresh-tier2-v1}
TOOLS=${TOOLS:-$W/scripts/body-types}
LISTS=${LISTS:-v9}
MASKS=${MASKS:-$O/mask-proof-batchA-v1.json,$O/mask-proof-batchB-v1.json}
SHIP=${SHIP:-$O/ship-masks-v9.txt}
# The filtered lists are written as SUFFIX-admit-*.txt; the same name as LISTS would overwrite the inputs.
if [ "$LISTS" = "$N" ]; then echo "LISTS must differ from the suffix ($N)" >&2; exit 2; fi
A=public/models/reconstructed-assemblies-v1
P=public/models/s12-bodytype-refresh-v1
PY="/c/ProgramData/anaconda3/python.exe -X utf8 -I"

echo "active $(sha256sum $A/assets.json | cut -c1-16), skin pairs $(sha256sum $A/skin-pairs.json | cut -c1-16)"
R=${PROOFS:-$N}
if [ -z "${PROOFS:-}" ]; then
  node $W/_docs/body-types-2026-11-06/scripts/morph-census.mjs $A/assets.json $O/morph-census-$R.json
  $PY $TOOLS/morph-only-proof.py $A/assets.json $P/meshes $O/morph-only-proof-$R.json
  $PY $TOOLS/skin-by-name-proof.py $A/assets.json $O/morph-only-proof-$R.json $P/meshes public/models/body/SK_Body_M.glb $O/skin-by-name-proof-$R.json
  $PY $TOOLS/surface-match-proof.py $A/assets.json $O/skin-by-name-proof-$R.json $P/meshes public/models/body/SK_Body_M.glb $O/surface-match-proof-$R.json
fi
# (The builder refuses proofs of another index: live URLs and hashes are pinned per mesh.)

# Admission lists: the LISTS lists, keeping only meshes the new morph-only proof still refuses (an applied mesh is live).
$PY - "$O" "$N" "$R" "$LISTS" <<'EOF'
import json, sys
from pathlib import Path
O, N, R, LISTS = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
refused = {n for n, r in json.loads((O / f'morph-only-proof-{R}.json').read_text(encoding='utf-8')).items()
           if r.get('status') == 'refused'}
for kind in ('only', 'reviewed', 'rework'):
    names = [n for n in (O / f'{LISTS}-admit-{kind}.txt').read_text().strip().split(',') if n]
    kept = [n for n in names if n in refused]
    (O / f'{N}-admit-{kind}.txt').write_text(','.join(kept))
    print(f'{kind}: {len(kept)} of {len(names)} still refused')
EOF

# A list flag goes in only with a non-empty list: an empty value would swallow the next flag (23 Nov, v11a).
LIST_ARGS=()
for kind in only reviewed rework; do
  v=$(cat $O/$N-admit-$kind.txt)
  if [ -n "$v" ]; then LIST_ARGS+=(--admit-$kind "$v"); fi
done
v=$(cat $SHIP)
if [ -n "$v" ]; then LIST_ARGS+=(--ship-s12-masks "$v"); fi
$PY $TOOLS/build-preview-index.py $A/assets.json $O/morph-only-proof-$R.json $P/meshes $O/index-$N/assets.json \
    public/models/reconstructed-assembly-v2/customization.json --census $O/morph-census-$R.json --changed-only \
    --admit $O/skin-by-name-proof-$R.json --admit-surface $O/surface-match-proof-$R.json \
    --package-proof $O/package-proof-1117-v2.json --mask-proof $MASKS "${LIST_ARGS[@]}" \
    | tail -c 200
$PY $TOOLS/make-merge-patch.py $A/assets.json $O/index-$N/assets.json $O/merge-patch-$N.json
echo "patch $(sha256sum $O/merge-patch-$N.json | cut -c1-16)"
