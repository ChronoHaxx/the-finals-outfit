# Light bulk extraction: plan, ready to start (23 Nov 2026; not run)

**Asked by:** the coordinator (23 Nov), while the main-folder session hand-patches a 12.03 usmap.

**Goal:** reach the bar for unflagging Light, which the coordinator has passed to the user as a suggestion:
- the starting outfit builds whole on Light;
- most presets lose at most one piece.

**Not run:** nothing here reads the game containers or writes `public/models`.

**Update (23 Nov, late).** The patched map v1 is proven (`f36b7c4f…`, with the window guard `check_window.py`), so
this plan is runnable. Queue order (coordinator):
1. the main-folder session proves v1 end to end on w177;
2. this extraction runs, starting-outfit batch first (see "Run order with map v1" below);
3. then Heavy (`SK_Body_H`).

Index applies go one at a time through the main-folder session (local_602c33b0), after the release is live.

This supersedes the 22 Nov draft in [BULK-EXTRACTION.md](BULK-EXTRACTION.md).

## The rows (v2, with proof 1′ as approved)

**v2 is current.** It is planned from the builder run on the active index `b164180c…` with `--live-equal-medium
--proven`. The snapshots are [light-bulk/rows-v2.tsv](light-bulk/rows-v2.tsv),
[light-bulk/followups-v2.tsv](light-bulk/followups-v2.tsv) and [light-bulk/summary-v2.json](light-bulk/summary-v2.json).
v1 (907 rows, planned before proof 1′) is kept beside them as history.

- **852 Light class meshes to read**, in 9 batches of 100 (batch 9 has 52):
  - 792 `medium sibling not staged`: the 18 Oct S11 read never covered them;
  - 60 `S11 read not proven current`: they pass every proof, including 1′, but have no 17 Nov proof row, so today's
    read settles them.
- **Each batch** is one probe read of the Medium, Light and Heavy packages: 2,554 packages in all, each read once. The
  Heavy siblings are staged but not built until `SK_Body_H` is proven.
- **Order:** the starting outfit's pieces first, then by preset impact (presets showing an item that needs the mesh),
  then by item count, then by name.
- **The row table** (`rows-v2.tsv`) gives, for each row:
  - its order and batch;
  - its Light, Medium and Heavy mesh;
  - the reason it is planned, and the folder the live Medium is served from;
  - its preset and item counts, and a starting-outfit flag;
  - the proof 1′ verdict and the morph targets that differ from the live Medium (max delta in cm, and targets on one
    side only).

  The morph columns fill in for the rows proof 1′ has already compared (the 60). For the rest, each wave's build
  writes them to `proof1-prime.tsv` beside `report.json`.
- **Early win, in W1** (coordinator, 23 Nov). These pass proof 1′ against their S12 Medium, and their packages are
  proven current by the 17 Nov proof. Their morph differences come from the S12 re-sculpt:

  | Light mesh | Morph targets that differ (max delta) |
  | --- | --- |
  | `Casual_LowWedgeHeels_L` | `medium_female` 0.16 cm, `medium_male` 0.09 cm |
  | `CrossPromo_NRSuitBelts_L` | `medium_female` 1.39 cm |
  | `Military_PantsWithHolsterPouch_L` | `medium_female` 1.32 cm |

  `FromTencent_AsianSpiritBoots_L` was the fourth candidate. Under the approved tolerances it fails: its S12 Medium's
  inverse-bind matrices moved beyond 1e-5. It is skipped and listed, with no fallback.
- **Follow-ups, neither read nor applied here: 45 rows failed proof 1′** against the live Medium (`followups-v2.tsv`):
  - 41 `medium changed in the game`: 27 indices, 10 skin joint names or order, 3 positions, 1 inverse-bind;
  - 4 `live Medium reweighted`: 3 joint indices, 1 weights.
  - **Medium refresh (30):** the live Medium is served from an older build than the game's. The class mesh can join
    only after its Medium is refreshed, which is S12 refresh territory. **This includes the starting outfit's T-shirt**
    (`SK_Casual_BasicTshirt_M`, served from `reconstructed-meshes-v2`; S12 reworked it, and it is in S12 tier-2's
    batch C).
  - **Served from the S12 refresh (15):** here the S11 read is the old side, and the live Medium is S12's. A fresh read
    may pass. Read their Light siblings in the S12 territory's runs, which read the same Medium packages.
- **Not in this plan:**
  - 25 Light meshes refused by a proof: reshaped, so each needs its own masks;
  - 89 rows whose Medium is not in the active index;
  - 7 Light offset-rule items;
  - 2 swap conflicts.

**Coverage if each batch lands.** These are upper bounds: every proof is assumed to pass. The early win counts from
batch 1 on.

| Through | Items on Light (of 2,953) | Presets whole (of 352) | Presets losing at most one piece |
| --- | --- | --- | --- |
| now | 960 | 6 | 15 |
| batch 1 | 1,742 | 49 | 113 |
| batch 2 | 2,035 | 80 | 175 |
| batch 4 | 2,376 | 142 | 243 |
| batch 6 | 2,514 | 196 | 293 |
| all 9 | 2,740 | 258 | 330 |

- **"Most presets lose at most one piece"** comes at about batch 4–6.
- **"The starting outfit whole" does not come from this plan alone.** The sneakers and jeans are in batch 1, but the
  T-shirt waits for its Medium refresh (S12 batch C).
- **What still holds pieces back after batch 9:**
  - Light meshes refused by a proof (63 preset pieces);
  - follow-ups (52);
  - Medium meshes missing from the index (6);
  - offset rules (3);
  - a swap conflict (1).

## Prerequisites (state late on 23 Nov)

1. **Map v1 is proven:** done (main-folder session). `run-light-bulk.py` pins it by sha256 (`f36b7c4f…`).
   `SOURCE_USMAP` may point at a copy, but the copy must have that sha256.
2. **Proof 1′ is approved** (coordinator, 23 Nov, with conditions) and built as `--live-equal-medium`
   (`LIVE_EQUAL` and `live_equal` in `build-archetype-index.py`).
   - **Why it is needed:** a fresh read is never byte-identical to the live Medium. Even a re-convert of the same 18 Oct
     read differs in the last digit of its joint rotations.
   - **The rule.** The Medium read beside the class mesh must equal the live Medium GLB as follows:

     | What | Rule |
     | --- | --- |
     | primitive and vertex counts, indices | exact |
     | positions | within 1e-5 m |
     | every UV set | within 1e-6 |
     | normals | within 1e-4 per component |
     | material slot names, in order | exact |
     | skin joint names, in order | exact |
     | inverse-bind matrices | within 1e-5 per element |
     | joint indices (JOINTS_n) | exact |
     | weights (WEIGHTS_n) | exact after quantizing to normalized u16 |
     | morph targets | may differ; recorded per row, never hidden |

   - **Results:**
     - A surface, slot or skeleton difference skips the row as `medium changed in the game`.
     - A joint-index or weight difference skips it as `live Medium reweighted`.
     - The skip records what differs. There is no fallback: only one staged copy is compared, today's read when
       there is one. A failing row is never admitted another way.
   - **Every comparison**, passing or not, goes to `report.json` (`proof1Prime`) and `proof1-prime.tsv`, with its
     morph differences.
   - **Tests** (`test_build_archetype_index.py`, 20 in all):
     - passes: the real 18 Oct read against its re-convert; float noise in the binds; a weight change within u16
       quantization;
     - fails: a different surface, a changed joint order, binds beyond epsilon, a weight change beyond quantization,
       a swapped material slot.
   - **Weight rounding edge:** exact u16 comparison can flip one step when a weight sits exactly on a rounding
     boundary. A re-convert gives identical float weights, so this only shows up as a listed skip.
3. **Builder input for fresh reads:** done. `--staging <run dir>` takes the runner's GLBs and its `run.json`. The
   builder exits unless:
   - the control passed;
   - every batch was read with the pinned map, passed the guard and read every package.

   With `--staging`, an S11 mesh (read before 17 Nov) still needs `--proven`.
4. **Re-runs on the applied index:** done. The builder re-proves an applied class body, and keeps the applied
   `archetypes` record.

## Run order with map v1

Run in Git Bash from this branch's worktree, or from main once this PR is merged. The tools are read from the main
checkout. `RUN` sits in the main checkout's `scripts/generated`, so it survives a worktree archive. Nothing writes
`public/models`.

```
M=/e/Coding/the-finals-outfit
PROOF=$M/scripts/generated/archetypes/nov17-proof-apply-b4f2/proof.json
PLAN=$M/scripts/generated/archetypes/light-bulk-plan-go
RUN=$M/scripts/generated/archetypes/light-bulk-v1
```

0. **Refresh the plan after w177.** w177 may move the active index.

   ```
   python -I scripts/archetypes/build-archetype-index.py --live-equal-medium --proven $PROOF --out scripts/generated/archetypes/bulk-pre --publish-dir reconstructed-archetypes-v1
   python -I scripts/archetypes/plan-light-bulk.py --report scripts/generated/archetypes/bulk-pre/report.json --out $PLAN
   ```

   Diff `$PLAN/rows.tsv` and `followups.tsv` against [light-bulk/rows-v2.tsv](light-bulk/rows-v2.tsv) and
   [light-bulk/followups-v2.tsv](light-bulk/followups-v2.tsv). A row that left must be in the new report with a reason.
   The planner refuses a report built on another index. The run takes about 6 minutes, most of it in the proof 1′
   comparisons.
1. **Control, once.** It proves that map v1 reads meshes exactly as the 18 Oct map did.

   ```
   python -I scripts/archetypes/run-light-bulk.py control --run $RUN --proof $PROOF
   ```

   It re-reads 24 packages that are byte-identical between the 18 Oct read and the 17 Nov containers. Every mesh
   export must equal the 18 Oct one byte for byte, and the guard runs too. Stop if it fails.
2. **Batches, starting with 01.** Batch 01 holds the starting outfit's sneakers and jeans, plus 98 rows by preset
   impact.

   ```
   python -I scripts/archetypes/run-light-bulk.py batch --run $RUN --plan $PLAN --batch 01
   ```

   A batch converts only after all of these hold:
   - the pins (probe `57948870…`, map `f36b7c4f…`);
   - every package read, after retrying any missing one on its own;
   - `check_window.py` exits 0 over every read folder;
   - the probe's own `source-run.json` names the pinned map.

   Each batch is recorded in `$RUN/run.json`. A recorded batch is never re-read into the same folder.
3. **Build after each wave:**

   ```
   python -I scripts/archetypes/build-archetype-index.py --staging $RUN --live-equal-medium --proven $PROOF --out scripts/generated/archetypes/bulk-w1 --publish-dir reconstructed-archetypes-v1
   ```

   `--live-equal-medium` is approved (coordinator, 23 Nov). `--proven` lets the S11 early-win rows join. Every row
   lands in `added`, `refused` or `skipped` with a reason; record `skipped.tsv`. Expect a run of
   tens of minutes: the weight comparison is the slow part, so run it in the background.
4. **Hand off each apply to the main-folder session** (local_602c33b0) through [APPLY.md](APPLY.md), after the release
   is live. Each apply is a one-line coordinator approval.
   - **Apply waves:**
     - W1: batch 1 and the 3 early-win rows (49 presets whole; the starting outfit still lacks its T-shirt);
     - W2: batches 2–6 (the presets bar);
     - W3: batches 7–9.
   - **Checks:** captures at full size of the starting outfit and the top presets of the wave, on Light against Medium.

**Checked without the game:**
- `run-light-bulk.py`: its pins resolve on this machine.
- A batch run with a stand-in probe that replays three packages of the 18 Oct read:
  - it read the packages, ran the guard and converted them;
  - a batch with a missing package failed closed after its retry, without converting;
  - re-running a recorded batch was refused.

**Size:** the 63 applied Light meshes are 61.3 MB, so 907 come to roughly 0.9 GB uncompressed. They are hosted
gzipped on the release's leaf shards. The staged Heavy siblings are about the same size again and stay local.

**Time:** not measured. Batch 1 will give the rate.
