# C0 run: the T-shirt's 43 materials on map v1 (for the main-folder session)

Prepared 25 Nov 2026 by the S12 tier-2 session, which may not write the root checkout. Run by the main-folder session
in its queue: w177, then the Light bulk apply, then this. **No apply here:** every step writes only new folders, and
the tool itself refuses the active folder.

## What it builds

The 43 BasicTshirt items (batch C wave C0, `../BATCH-C-PLAN.md`). The Season 12 T-shirt changed its UVs, so its 43
material instances must come from the same build. The batch rebuilds them from the 17 Nov containers (map v1
`f36b7c4f`, View layout gate C838D617) and rebinds them in a private preview (`rebindKeptMaterials`, the w107 route in
`prepare-accessory-defaults.py stage_index`). The batch keeps the live mesh; the refresh patch repoints the mesh, its
mask and these 43 materials in one apply later.

Inputs checked here: drift `drift/v1` (map v1) is 43 identical. A dry run of `prepare-cohort.mjs` against the root's
inputs gave 43 rows, 0 skipped, no parameter overlays and 43 rebind materials, equal to the planner's scope.

## Commands (Git Bash, from `E:\Coding\the-finals-outfit`)

Needs the root app on 5174 (serve-5174) for the gpu stage. Run step 4 in the background: it is long.

```bash
cd /e/Coding/the-finals-outfit
C=_docs/s12-refresh-tier2-2026-11-22/c0-run

# 1. Bring this folder in as untracked files. The root stays on its branch; nothing is staged or committed.
#    Before PR merge use the branch: git fetch origin claude/s12-batchC-c0-2026-11-25
test ! -e $C && git fetch origin main && git archive FETCH_HEAD $C | tar -x && ls $C

# 2. Stage the T-shirt's Season 12 body mask beside batches A and B (a new file only; refuses to overwrite).
M=public/models/s12-refresh-tier2-v1/coverage-s12/SK_Casual_BasicTshirt_M.bodymask.png
test ! -e $M && cp .claude/worktrees/angry-darwin-c51aab/scripts/generated/s12-refresh-tier2-v1/coverage-s12/SK_Casual_BasicTshirt_M.bodymask.png $M && sha256sum $M | cut -c1-16
#    expect 9ff2ed9bb3cf9b1b

# 3. Freeze the cohort and write batch-attached.json.
node --import tsx $C/prepare-cohort.mjs > $C/prepare-cohort.out 2>&1; echo "cohort exit $?"; tail -12 $C/prepare-cohort.out

# 4. Source, build, gpu, index (warms 5174 itself before the gpu stage; retries only a load timeout).
bash $C/run-v1.sh > $C/run-v1.out 2>&1; echo "c0 v1 exit $?"; cat $C/run-v1.out
#    A stage that stops can be rerun alone: bash $C/run-v1.sh gpu   (or index)
```

## What success looks like

| Step | Expect |
|---|---|
| 3 | exit 0; `"rows": 43`, `"skipped": []`, `"withParameters": []`, `"rebindKeptMaterials": 43` |
| source | exit 0; 43 choices and 43 default materials extracted, no mesh extracted; the usmap window guard refuses no root; nothing unresolved |
| build | exit 0; `built` 43, `buildErrors` {}, `cpuPassed` 43, `auditBlockers` {} |
| gpu | exit 0; 43 materials, 0 failed |
| index | exit 0; `public/models/reconstructed-s12-c0-preview-v1/preview.json` lists 43 `reboundMaterials`, 43 implemented (all readvertised), `addedMeshes` 0, `addedMaterials` 43 |

If a number differs, stop there and send the tier-2 session the step's `.out` file; don't adjust and rerun.

Written: `scripts/generated/shader-probe/s12-c0-v1`, `public/models/reconstructed-s12-c0-v1`,
`public/models/reconstructed-s12-c0-preview-v1`, and the logs in this folder. In w177 the auto-mode permission check
refused the index stage because it writes under `public/models`. Here, too, it writes only the preview folder above.
If it is refused again, run `bash $C/run-v1.sh index` once the user allows it.

## After the run (tier-2 session)

Read-only on the root:
1. Check the 43 materials' `requiredUvSets` and tile-index reads against the Season 12 mesh (it has UV0 and UV1).
2. Build the patch on the then-active index:
   `make-refresh-patch.py public/models/reconstructed-assemblies-v1 $C/refresh-spec.json <out>`.
   This writes the patch, `.expected.json` (the sha256 the apply will write) and `.publish.txt`.
3. Capture against the icons.
4. Send the coordinator the sha and the publish list.

The apply follows the batch A/B route (`../APPLY.md`) through the queue.
