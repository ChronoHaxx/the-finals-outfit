# Light rows behind fix-wave Mediums: plan (25 Nov 2026), approved, not run

## Decisions (coordinator, 25 Nov)

**Order:** bulk apply → C0 → b10 → proof 1″ and u8 → the processing waves.

0. **b10 fresh read: yes.** Read-only, same runner and pins (map v1 plus the window guard).
   - Run it when the root runner is free: after the bulk apply, and never overlapping the main-folder session's w177
     or C0 runs.
   - The slot is agreed with that session.
1. **Proof 1″, "permutation-equal": yes, on these conditions.**
   - **Bijection:** every vertex is matched exactly once. Ties between identical vertices (same position, UVs, normal
     and weights) are broken deterministically, and the matched multisets must be equal.
   - **Triangles under the mapping:** an equal multiset of mapped index triples, not two lists compared separately.
   - **Morph targets** are compared under the same permutation, as in 1′: differences are recorded, not refused.
   - **Joint-list order is freed only through the by-name skin match.** Joint names, inverse binds and the weight per
     (vertex, joint name) stay exact, under 1′'s epsilons.
     - **Reading to confirm:** "joint names" means the joints that carry weight on either side. They must be the same
       set, each with an inverse bind within 1e-5.
     - Entries that carry no weight on either side are recorded per row, not compared. Measured on 25 Nov:
       KnightNeckCloth lists 14 vs 92 joints and RetroRobotHands 59 vs 62. Neither's extra live entries carry any
       weight, and the shared names' binds agree within 6e-7.
     - Under a full-list reading these 2 rows skip.
   - **Record** each row's permutation hash.
   - **Negative tests** must fail on:
     - a moved triangle;
     - a weight swapped between two joints;
     - a morph delta on one vertex. This is recorded as a morph difference, so the test checks it is recorded,
       never silently passed;
     - an extra duplicate vertex.
   - **No vertex-indexed runtime data.** Rows whose items carry any are refused (evidence in the next section).
     1″ refuses a Medium named in any per-vertex registry, such as `head-wraps.json`.
2. **The two 8-bit rows: yes.**
   - Quantize the fresh weights to u8 the same way the live converter does, then require an exact match.
   - This applies only to rows whose live copy stores u8 weights, and each such row is recorded.
   - The implementation must take the quantization from the converter that built those copies (w139 `p?b`, w84
     `led-head-b1-v3`), not assume it.
3. **Per-wave weight processing on `_L`,** only for rows b10 shows are ours. Approved as planned, with the idle review.

**Asked by:** the coordinator, 25 Nov. The 25 Light rows whose live Medium is one of our own fix-wave builds are to be
planned with proof 1′, sized per fix wave. They come after the bulk apply and C0.

**Input:** the S12 tier-2 session's list `light-fixwave-mediums.tsv` (branch `claude/s12-batchC-c0-2026-11-25`,
d25e25d). It has 30 rows:
- 25 counted as S12;
- 2 with no S12 proof row (RetroRobotHands, RetroRobotLegs);
- 2 in R (the SpacePilotJacket pair, w170 cloth-sim);
- 1 in C0 (BasicTshirt).

Per-row table: [rows.tsv](rows.tsv). Script: [fixwave_census.py](fixwave_census.py), read-only.

## What actually differs

Proof 1′ compares the live Medium with the staged Medium exactly, in order. To size the work, the census compares them
without regard to order instead:
- vertices are matched by position (1e-5 m), UV0 modulo whole tiles (1e-3) and normal (1e-2);
- triangles are compared as a multiset, keeping winding;
- skin weights are compared per vertex **by joint name** after u16 quantization.

The staged Medium is the 18 Oct read, because none of these rows was in the bulk batches.

| Census | Rows | Waves | What it means |
| --- | ---: | --- | --- |
| **reordered** | 15 | w139 ×5, w84 ×4, w125 ×4, w82 ×2 | Same vertices, triangles and skin by name. Only the vertex order differs, and for 2 the joint list (the live copy lists the whole skeleton). This is a converter difference, not processing. |
| **reweighted**, one 8-bit step | 2 | w139, w84 | Same geometry. Weights differ by exactly 257 or 514 u16, one or two u8 steps: the live copy stores 8-bit weights. |
| **reweighted** | 8 | w84 ×4, w80, w82, w121, w125 | Same geometry, different skin on 28 to 1,229 vertices. Either the game changed the weights after 18 Oct, or our wave did (w121 and the w125 t-batch are proxy weight transfers). |
| **geometry** | 5 | C0, w170 ×2, w80, w125 | Vertex sets differ: a different read, or processing that moved vertices. |

**Nothing at runtime indexes these Mediums' vertices, so a reorder is harmless there.** Checked against the code, the
active index and the wave records on 25 Nov:
- **w139 part-hide:** body-UV textures. `scripts/shader-probe/build-part-hide-masks.py` bakes them; it is in the main
  checkout's working tree, not tracked. The runtime reads them per item and mesh through `itemBodyMasks`
  (`src/rig/SourceAssembly.ts:1219`). It never reads garment vertex ids.
- **w80 wraps:** a preflight gate only (`_docs/goal-100-2026-10-11/w80-wrap-preflight/probe.py`, main checkout,
  untracked). `src/` has no proxy-wrap runtime, and the resolver skins a wrapped part on its own skinning.
- **w84 LED:** in the materials, by slot (`src/rig/ReconstructedMaterial.ts` emission paths).
- **Mesh entries** carry only url, sha256, slots, kind and the body-mask fields.
- **The one per-vertex registry** in the active folder is `head-wraps.json` (head-component wraps, `src/rig/HeadWrap.ts`).
  It names none of the 30 Mediums. Only `supported-items.json` names them, as the item catalog.

So the "same processing on `_L`" premise holds only for the weight rows. Half the list needs an equality rule, not
processing.

## Plan

Run in order. Nothing writes the index; applies go through the main-folder session as before.

0. **Fresh read, batch b10.** Read Medium, Light and Heavy for all 45 bulk follow-ups: these 30 plus the 15 "served
   from the S12 refresh" rows I already owe. That is about 135 packages.
   - It uses `run-light-bulk.py` into `light-bulk-v2`: same map v1, guard and pins. The request list goes in a new plan
     folder, `light-fixwave-plan/requests/b10.json`.
   - Then rebuild on the active index.
   - It answers the main open question: which differences are the game's (the fresh Medium equals the live copy) and
     which are ours. It also makes every row current without the S11 `--proven` route.
   - Cost: about 2 minutes of reading and 10 of building, both read-only.
1. **Proof 1″, "permutation-equal Medium". This is a rule change, so it needs your approval.** It stays as strict as 1′
   on content and drops only the ordering:
   - exact triangle multiset under a vertex bijection;
   - per matched vertex: positions 1e-5 m, every UV set 1e-6 (no tile wrap: the clamped legacy paths make wrapping
     unsafe), normals 1e-4;
   - material slot order exact;
   - skin exact by joint name after u16, inverse binds by joint name within 1e-5;
   - morphs recorded as in 1′;
   - no fallback. A row that fails 1″ is skipped and listed.

   The Light mesh still has to pass proofs 3–5 against the staged Medium, unchanged. Tests come in pairs, positive and
   negative: reorder only; one triangle flipped; one weight off by one step; a joint renamed; slot order swapped.
   - **Yield:** 15 rows, 19 items, 18 preset uses.
   - **Optional, also your call:** the two 8-bit rows join if 1″ compares weights at the live file's stored precision
     (one u8 step). That adds 2 rows and 2 items.
2. **Weight rows (8), after b10.**
   - Where the fresh Medium's skin equals the live copy's by name, the game made the change. The fresh `_L` pairs
     under 1′ or 1″, with no processing.
   - Otherwise it is ours, and the `_L` gets the same processing with its own proof:
     - w121 / w125 t-batch proxy weight transfer (FrontTieCropTopSleeves, SpaceCape): `proxy_weight_transfer.py` on the
       `_L` with its own cloth proxy, then the w117 preflight. Review in the **idle** pose, because cloth-sim proxies
       float sleeves (decision #18).
     - w84 / w82 / w80 rows (SpacePilotPants, SpacePilotPantsBelt, SpaceBracerScreen, SpaceSoldierBandolier,
       KnightCape, ChainBelt): read each wave's record first. I'll size them once b10 says which are ours.
   - **Yield:** 8 rows, 10 items.
3. **Geometry rows.**
   - HeadscarfStraps (w80) and SportyRobotLegs (w125 re-sweep): b10 decides, as in step 2. 5 items.
   - BasicTshirt: C0 refreshes its Medium; the next Light build proves it. Nothing to do here.
   - SpacePilotJacket and its Ultimate (w170): parked behind S12's R read and the cloth-sim decision #18. 3 items.

**Value:** about 37 items beyond the T-shirt. Step 1 gives the most for the least: 19–21 items for one rule with tests,
in the same build as step 0's read. Steps 2–3 cost per wave and give 15 items.

Decided 25 Nov: see "Decisions" at the top. The conditions there take precedence over the step 1–2 sketches above.
