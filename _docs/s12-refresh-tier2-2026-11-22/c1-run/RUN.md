# C1 run: the materials on the six batch C meshes, on map v1 (for the main-folder session)

Prepared 26 Nov 2026 by the S12 tier-2 session, which may not write the root checkout. The route is C0's
(`../c0-run/RUN.md`). **No apply here:** every step writes only new folders, and the tool itself refuses the active
folder.

## What it builds

The material side of batch C wave C1 (`../BATCH-C-PLAN.md`, `../C1.md`). These are the 52 items that show one of the
six batch C meshes: Streetwear Hoodie, UtilityBelt, TacticalKnightTop, TacticalKnightBelt, AssaultPantsNoKneepad and
CardboardPants. Those meshes' Season 12 UVs or UV sets changed, so the 52 material instances bound to their slots must
come from the 17 Nov build.
- The batch rebuilds them on map v1 `f36b7c4f`, with the View layout gate C838D617, and rebinds them in a private
  preview (`rebindKeptMaterials`).
- Parts on other meshes (14 items show some) keep their active bindings.
- The batch keeps the live meshes. The C1 refresh patch repoints the meshes, the masks and these 52 materials in one
  apply later.

Inputs checked here:
- Drift `drift/v1` (map v1): 18 identical and 35 differing only by an appended MeshMergeModifiers override.
- `prepare-cohort.mjs` admits those 35 by the option A rule (`scripts/shader-probe/merge-modifier-drift.mjs`, PR #109),
  checking per item that the resolver gives the same result on Medium. It records each verdict in the cohort.
- A dry run against the root's inputs (active `e7cd0b2f…`) gave:
  - 52 rows: 17 identical, 35 admitted;
  - 1 skipped, `casual-longcoat-leather-camo` (proxy wrap without passing evidence; its C1 material is rebuilt
    through other items, `../C1.md`);
  - no parameter overlays, and 52 rebind materials (the planner's 52).

**Needs PR #109 in the root checkout** (the rule file). Without it, step 3 stops with "missing
scripts/shader-probe/merge-modifier-drift.mjs".

## Commands (Git Bash, from `E:\Coding\the-finals-outfit`)

Needs the root app on 5174 (serve-5174) for the gpu stage. Run step 4 in the background: it is long. E: is shared with
another extraction at the moment, so run this as the only heavy E: job.

```bash
cd /e/Coding/the-finals-outfit
C=_docs/s12-refresh-tier2-2026-11-22/c1-run

# 1. Bring this folder in as untracked files. The root stays on its branch; nothing is staged or committed.
#    Before the docs PR merges, use its branch: git fetch origin claude/s12-batchC-c1-2026-11-26
test ! -e $C && git fetch origin main && git archive FETCH_HEAD $C | tar -x && ls $C
test -f scripts/shader-probe/merge-modifier-drift.mjs && echo "rule present" || echo "rule missing: merge #109 into the root first"

# 2. Copy in the 17 Nov definitions the drift gate read (55 files, not in git; new files only). No mask to stage:
#    C1's masks come with the patch.
test ! -e $C/drift/v1/extract && cp -r .claude/worktrees/angry-darwin-c51aab/$C/drift/v1/extract $C/drift/v1/extract && ls $C/drift/v1/extract | wc -l
#    expect 55

# 3. Freeze the cohort and write batch-attached.json.
node --import tsx $C/prepare-cohort.mjs > $C/prepare-cohort.out 2>&1; echo "cohort exit $?"; tail -25 $C/prepare-cohort.out

# 4. Source, build, gpu, index (warms 5174 itself before the gpu stage; retries only a load timeout).
bash $C/run-v1.sh > $C/run-v1.out 2>&1; echo "c1 v1 exit $?"; cat $C/run-v1.out
#    A stage that stops can be rerun alone: bash $C/run-v1.sh gpu   (or index)
```

## What success looks like

| Step | Expect |
|---|---|
| 3 | exit 0; `"rows": 52`, `"driftAdmission": {"identical": 17, "merge-modifier-only": 35}`, `"mergeModifierAdmitted": 35`, `"withParameters": []`, `"rebindKeptMaterials": 52`, `"itemsWithOtherParts": 14`, one skipped (`casual-longcoat-leather-camo`, proxy wrap) |
| source | exit 0; no mesh extracted; the usmap window guard refuses no root; nothing unresolved. The choice and default-material counts are new ground: C0's items showed one mesh, and 14 of these show others too. Record them and go on |
| build | exit 0; `built` 52, `buildErrors` {}, `cpuPassed` 52, `auditBlockers` {} |
| gpu | exit 0; 52 materials, 0 failed |
| index | exit 0; `public/models/reconstructed-s12-c1-preview-v1/preview.json` lists 52 `reboundMaterials`, 52 implemented (all readvertised), `addedMeshes` 0 |

**Run on 26 Nov (`RUN-RESULT-2026-11-26.md`):** two of these expectations were wrong; nothing drifted.
- "Nothing unresolved": the source stage resolves every default material of every part, and its guard refuses the
  two `MI_FloatingHologram_SponsorTrack*` hologram programs on other-part hologram meshes. The index keeps their
  live bindings.
- "Built 52": the build covers other parts' choice materials too (68). The index rebinds only the 52.
Accepted by the coordinator; details in `../C1.md`, "After the run".

If `activeAssetsSha256` in step 3 is not `e7cd0b2f…`, that is expected when an apply has moved the index (Light 3′
→ `9f5dd6d2…`). The counts must still match. If a number differs, stop there and send the tier-2 session the step's
`.out` file; don't adjust and rerun.

The source stage's View gate decides three roots the plan could not forecast: the cardboard pants'
`M_CharacterAttachment`, and TacticalKnightTop and TacticalKnightBelt, whose older material files record no root. A
refusal there is a result, not a failure of the run: send the `.out` file.

What it writes:
- `scripts/generated/shader-probe/s12-c1-v1` (the source stage onward);
- under `public/models`:
  - build: `reconstructed-s12-c1-v1/staging`;
  - index: `reconstructed-s12-c1-v1/meshes` and `materials`, and `reconstructed-s12-c1-preview-v1`;
- the logs in this folder.

All of these are new paths; the active folder is never written. If the permission check refuses a step that writes
under `public/models`, stop and ask the user. A stopped stage reruns alone (`bash $C/run-v1.sh index`).

## After the run (tier-2 session)

Read-only on the root:
1. Check the 52 materials' `requiredUvSets` and tile-index reads against the Season 12 meshes, and each rebuilt
   material's UV sets against its `_L` sibling (Hoodie_L: the plan's Light-sibling rule).
2. The mesh side (`../C1.md`, "Next"): the 16 mesh reads, the 45 admitted meshes, the masks.
3. Build the C1 refresh patch on the then-active index, with an index diff.
4. Captures against the icons; send the coordinator the sha and the publish list.
