# C2 run: the materials on the five C2 meshes, on map v1 (for the main-folder session)

Prepared 26 Nov 2026 by the S12 tier-2 session. Same route as C1 (`../c1-run/RUN.md`). **No apply here:** every step
writes only new folders, and the tool itself refuses the active folder.

## What it builds

Batch C wave C2 (`../BATCH-C-PLAN.md`, `../C2.md`): the 113 items that show one of five meshes. Shirt, Socks_Quarter,
Pants, AssaultPants and TightTechPants changed their UVs or UV sets in Season 12, so the 100 material instances bound
to their slots are rebuilt from the 17 Nov build on map v1 and rebound in a private preview (`rebindKeptMaterials`).
Parts on other meshes keep their active bindings. The meshes and masks move later, with the materials, in one refresh
patch.

Inputs checked here:
- Drift `drift/v1`: 96 identical. 17 starter Pants differ only by the appended MeshMergeModifiers override; the #109
  rule admits all 17, with the resolver giving the same result on Medium.
- The proxy-wrap guard, approved by the coordinator on 26 Nov for C2 only:
  - the 43 `starterset-shirt-flag-*` items pass with their WornCape (the flag cape, ClothSim proxy) kept as the
    flag-shirts wave admitted it;
  - the cohort records each one (`proxyWrapKeptSupported`);
  - must-fail self-checks run first: they refuse a wrapped part on a wave mesh, and an item that is not yet
    supported.
- A dry run against the root's inputs (active `e7cd0b2f…`): 113 rows, 0 skipped, no parameter overlays, 100 rebind
  materials (the planner's 100).

**Needs PR #109 in the root** (the rule file), like C1.

## Commands (Git Bash, from `E:\Coding\the-finals-outfit`)

Needs the root app on 5174 (serve-5174) for the gpu stage. Run step 4 in the background. E: is shared with another
extraction, so run this as the only heavy E: job, and not at the same time as C1's run.

```bash
cd /e/Coding/the-finals-outfit
C=_docs/s12-refresh-tier2-2026-11-22/c2-run

# 1. Bring this folder in as untracked files (before the docs PR merges: git fetch origin claude/s12-batchC-c2-2026-11-26).
test ! -e $C && git fetch origin main && git archive FETCH_HEAD $C | tar -x && ls $C
test -f scripts/shader-probe/merge-modifier-drift.mjs && echo "rule present" || echo "rule missing: merge #109 into the root first"

# 2. Copy in the 17 Nov definitions the drift gate read (new files only).
test ! -e $C/drift/v1/extract && cp -r .claude/worktrees/angry-darwin-c51aab/$C/drift/v1/extract $C/drift/v1/extract && ls $C/drift/v1/extract | wc -l
#    expect 115 (113 definitions plus assets.json and source-run.json)

# 3. Freeze the cohort and write batch-attached.json.
node --import tsx $C/prepare-cohort.mjs > $C/prepare-cohort.out 2>&1; echo "cohort exit $?"; head -20 $C/prepare-cohort.out

# 4. Source, build, gpu, index.
bash $C/run-v1.sh > $C/run-v1.out 2>&1; echo "c2 v1 exit $?"; cat $C/run-v1.out
```

## What success looks like

| Step | Expect |
|---|---|
| 3 | exit 0; `"rows": 113`, `"driftAdmission": {"identical": 95, "season12-import": 1, "merge-modifier-only": 17}`, `"mergeModifierAdmitted": 17`, `"proxyWrapKeptSupported": 43`, `"withParameters": []`, `"rebindKeptMaterials": 100`, `"itemsWithOtherParts": 71`, `"skipped": []` |
| source | exit 0; no mesh extracted; the usmap window guard refuses no root; nothing unresolved. Record the choice and default-material counts |
| build | exit 0; `built` 100, `buildErrors` {}, `cpuPassed` 100, `auditBlockers` {} |
| gpu | exit 0; 100 materials, 0 failed |
| index | exit 0; `public/models/reconstructed-s12-c2-preview-v1/preview.json` lists 100 `reboundMaterials`, 113 implemented (all readvertised), `addedMeshes` 0 |

- One of the 96 identical items counts as a Season 12 import instead, so the identical count in step 3 is 95.
- The source stage's View gate decides one non-layered root the plan flagged: a TightTechPants variant on
  `M_Character_PlasticSheet`. A refusal there is a result: send the `.out` file.
- If any other number differs, stop and send the tier-2 session the step's `.out` file.

What it writes:
- `scripts/generated/shader-probe/s12-c2-v1`;
- `public/models/reconstructed-s12-c2-v1/` and `public/models/reconstructed-s12-c2-preview-v1/`;
- the logs in this folder.

## After the run (tier-2 session)

1. UV checks on the 100 materials against the Season 12 meshes, and Pants_L's UV sets (the Light-sibling rule).
2. Masks for the five meshes, then the C2 refresh patch on the then-active index, with an index diff.
3. Captures against the icons, including the flag-shirt cape check: at least 6 flag shirts, live vs candidate, front,
   side and back.
