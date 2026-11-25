# Visual-diff route trap: which records relied on it, and a 30-item re-score (25 Nov 2026)

On 25 Nov 2026 the C0b review found that no script in `scripts/visual-diff/` passed `?reconstructed=`. PR #98 (merge
`963d906`) recorded the finding. A dev server draws the reconstructed route, the one the site shows, only with
`reconstructed=1`. So every dev-server harness run from 9 Sep (`04a0e3b`, when production started drawing that route)
to 25 Nov scored the older cosmetics route.

This record answers three questions:
- which decisions or acceptance records used affected runs;
- whether the harness's stored verdicts still hold on the route the site draws;
- whether a full re-score is worth doing.

The harness fix is PR #99: every harness URL now carries `reconstructed=1` unless `VDIFF_ROUTE=cosmetics` says otherwise.

## 1. Inventory: no decision in the window used an affected run

Searched: the root checkout's `_docs/` and `scripts/generated/`, this repository's tracked `_docs/`, the root
`visual-diff/` output folders, every worktree, and the Vibe worker journals. The targets were the 13 harness scripts
by name, `visual:render`/`visual:compare`, the verdict tools (`merge-verdicts`, `next-batch`) and the env switches
`VLIST`/`VOUT`.

| Record | Date | Script and URL | Decision it supported | Affected? |
|---|---|---|---|---|
| `scripts/visual-diff/verdicts.generated.json` (239 verdicts) | 5–11 Jul 2026 | `verify-render2.mjs`, `http://localhost:5173/?outfit=…&cam=…&fov=…&pose=a` | census pass/fail per item; `next-batch.mjs` picks unjudged items from it | No, it predates 9 Sep. It describes the cosmetics route, and it is **stale** (section 2). |
| Catalog-audit cluster map (82-item sample, renders in root `visual-diff/audit/`, ~2,800 files) | 21 Jun 2026, renders to 11 Jul | `verify-render2.mjs` + `audit-judge.workflow.js`, same URL form | glass and metal fixes shipped; colours, wrong-mesh and decals marked gated | No, it predates 9 Sep. Its gated clusters look different on the site route (section 2). |
| Root `visual-diff/out`, `verify`, `verify2`, `verify-m5`, `scores.json`, `report.html` | Jun – 13 Aug 2026 | `render.mjs`, `compare.mjs`, `verify-render*.mjs` | colour-model calibration, early checks | No, they predate 9 Sep. |
| `_docs/2026-09-08-material-bindings.md` | 8 Sep 2026 | `material-bindings.mjs` | material binding correction | No, the day before. |
| C0b review, `_docs/s12-refresh-tier2-2026-11-22/C0b.md` | 25 Nov 2026 | `render.mjs`, first without the switch, then with `VDIFF_QUERY=reconstructed=1` | TallSneakers correction, gate 2 | No. It found the trap and scored on the right route. |

Records in the window that only *mention* harness scripts are not runs:
- worker event logs from 11–17 Sep (accessory, nails, paint contracts, waist coverage, FModel catalog) and the Vibe
  journals w45–w95 read `package.json` (which names `visual:render`) or listed the folder;
- `scripts/generated/*` release and merge snapshots copy the scripts.

No harness run between 9 Sep and 25 Nov fed a decision or an acceptance record.

Other capture paths checked for the switch:
- **Goal-wave red/blue reviews:** the `capture-cam.mjs` lineage (w87 to w157), `capture-context-v2.mjs`,
  `purple-recheck-v1` and `w57 live-check` all build URLs with `outfitUrl()` in
  `scripts/shader-probe/coverage-preview-harness.mjs`, which adds `reconstructed=1`. The other `scripts/shader-probe`
  captures (`catalog-audit`, `check-assembly-batch` and the rest) pass it too. Unaffected.
- **Body-type and S12 refresh reviews:** `capture-review.mjs` and every URL in their `functional-review.md` carry
  `reconstructed=1`. Unaffected.
- **Feature PR checklists in tracked `_docs/`:** they run against a production preview (route on by default) or pass
  the switch. The few dev-server probes without it check things the route doesn't touch:
  - `saved-outfits` storage;
  - `igpu-perf/scene-stats`;
  - `hair-motion-vectors/probe-stack-union`;
  - the `c0-run` warm-up.
- **Shader-probe adapter checks:** `check-detail-adapter`, `check-hair-adapter`, `check-neck-adapter`,
  `check-skin-adapter` and `check-temporal-preview` open a dev URL without the switch. They drive
  `ReconstructedMaterial` directly on fixture geometry, so the viewer route does not matter.

Not exhaustive: the one-off probe scripts in the root `_docs/goal-100-2026-10-11/` (hundreds) were not classified
one by one. The review-capture lineages above were.

## 2. Re-score: 30 items on both routes, judged by eye

The sample was stratified, not random:
- 27 items from the verdict ledger: 10 judged good and 17 failing, covering every category (colour wrong or too light,
  missing print, emissive missing, artifact, wrong mesh, metal grey, and one just under the bar);
- 3 garment-cluster items from the June map: colours too light (×2) and wrong mesh (×1).

All 30 are in the live index. The ledger's in-index items are earrings, eyewear and facewear.

Setup:
- `verify-render2.mjs` from PR #99, rendered with `VDIFF_ROUTE=cosmetics` and with the default.
- Dev server on this branch (`scripts/body-types/serve-preview.mjs`) against the root checkout's live index on disk.
- Read-only. Captures settle for 2.5 s on the reconstructed route.
- Each item was judged at full size as icon | cosmetics | reconstructed, cropped per slot. The bar is "matches its icon"
  (the ledger's ≥ 75).
- Items 17 and 30 were re-shot with a wider camera to see the cap and the horns.

Mesh-level proof that the switch changes the route: with `reconstructed=0`, 0 of 8–9 meshes have a reconstructed
material; with `reconstructed=1`, 7–8 of them do.

| # | Item | Recorded verdict | Cosmetics today | Site route | What decides it |
|---|---|---|---|---|---|
| 1 | earrings-barricadespike-01 | pass 85 | pass | pass | |
| 2 | earrings-gem-01 | pass 76 | pass | pass | |
| 3 | earrings-miniature-ak-01 | pass 77 | pass | pass | |
| 4 | earrings-safetypin-01 | pass 80 | pass | pass | site threads the lobe like the icon |
| 5 | attachment-shootingglasses-a-metal | pass 90 | pass | pass | |
| 6 | steampunk-monocle-gold-blackglass | pass 82 | pass | pass | only the site lens is black |
| 7 | streetwear-casualglasses-metallic-blackfinals | pass 85 | **fail** | pass | cosmetics lens is opaque milky white |
| 8 | military-rebreather-rubber-kcp | pass 80 | **fail** | pass | cosmetics lacks the logo eye patch |
| 9 | sport-umpiremask-leather-blackyellow | pass 84 | **fail** | pass | cosmetics padding white, cage yellow |
| 10 | streetwear-balaclava-cotton-black | pass 86 | pass | pass | site: nose tip pokes through (below) |
| 11 | earrings-christmasball-01 | fail 32 | pass | **pass** | ledger stale on both routes |
| 12 | earrings-skull-01 | fail 48 | pass | **pass** | ledger stale on both routes |
| 13 | attachment-roundsunglasses-metallic-redglass | fail 44 | fail | **pass** | pink metal frame, red tinted glass |
| 14 | attachments-aviatorsunglasses-metal | fail 58 | fail | **pass** | red lenses, gold temples (cosmetics: navy) |
| 15 | military-tacticalglassessplit-plastic-black | fail 42 | fail | **pass** | tinted lens (cosmetics: grey opaque) |
| 16 | military-rebreather-rubber-cns | fail 45 | fail | fail | right colour, LED "CNS" visor missing |
| 17 | streetwear-bandanacap-cotton-blackfinals | fail 24 | fail | **pass** | yellow-logo cap and logo bandana |
| 18 | earrings-hoopsthick-01 | fail 48 | pass | **pass** | ledger stale on both routes |
| 19 | streetwear-pokerglasses-plastic | fail 65 | fail | **pass** | dark smoke lens (cosmetics: navy) |
| 20 | streetwear-balaclava-leopard | fail 35 | fail | **pass** | spots present (cosmetics: plain tan) |
| 21 | earrings-candycane-01 | fail 48 | pass | **pass** | ledger stale; stripes faint on site |
| 22 | samurai-facemask-base-cns | fail 38 | fail | fail | black mask, glowing cyan circuits missing |
| 23 | sport-fencermask-nylon-black | fail 28 | fail | **pass** | glossy dome with red line (cosmetics: smeared stripes) |
| 24 | scifi-hackergoggles-metal | fail 20 | fail | **pass** | chrome band with green LED slit |
| 25 | earrings-firehorse-01 | fail 22 | pass | **pass** | ledger stale on both routes |
| 26 | earrings-cashbox-01 | 72 (under bar) | pass | **pass** | ledger stale on both routes |
| 27 | earrings-namatama-evilgood-01 | fail 40 | fail | **pass** | gold egg with hat (cosmetics: grey horned egg) |
| 28 | actionhero-sentinelpants-nylon-yellow | June cluster: too light | fail | **pass** | bright yellow (cosmetics: olive) |
| 29 | casual-basicshorts-cotton-yellowfinals | June cluster: too light | fail | **pass** | logo and black leggings (cosmetics: neither) |
| 30 | attachment-hannyamask-brass-headwear | June cluster: wrong mesh | fail | **pass** | polished gold with horns (cosmetics: bronze) |

**Flip rate, recorded verdict against the site route: 18 of 30 (60%), all fail → pass. No pass → fail.**
- 12 of those flips come from the route itself (13–15, 17, 19, 20, 23, 24, 27–30). On today's cosmetics route they
  still fail.
- 6 come from the ledger being out of date (11, 12, 18, 21, 25, 26). They pass on both routes today.
- 2 of the 20 recorded failures still fail on the site route: 16 and 22, both CNS emissive or LED parts.

**Today's cosmetics route against the site route: 15 of 30 differ**, every one in the site route's favour. That
includes 3 items the ledger passed that the cosmetics route now draws wrong (7–9). Cosmetics verdicts say little about
what visitors see.

Limits:
- The sample leans on recorded failures (20 of 30), so 60% overstates the catalog-wide flip rate.
- One judge (this session), no ΔE.
- The index is the root checkout's on disk, which may include locally applied changes not yet deployed.
- The slot cameras crop some items; 17 and 30 were re-shot.

Seen in passing on the site route: on both balaclavas (10, 20) the tip of the nose pokes through the knit. Neither
icon shows it.

Evidence, gitignored, in the worktree `adoring-mclean-e8c1c8`:
- `visual-diff/route-rescore-2026-11-25/montage/` holds the 30 triptychs and two wide shots;
- `cos/` and `rec/` hold the raw renders;
- `list.json` is the sample;
- `route-probe.txt` is the mesh-level proof;
- the three scratch scripts that made them are alongside.

## 3. Recommendation

A full re-score of the old ledger and cluster map is worth it only as a fresh census on the reconstructed route. The
grounds:
- No decision in the window rested on an affected run, so nothing needs reverting.
- The stored verdicts describe a route visitors no longer see.
- 60% of a failure-weighted sample flips.

Suggested order:
1. Retire or relabel `verdicts.generated.json` and the June cluster map as cosmetics-route history.
2. Before re-judging anything, re-run `verify-render2.mjs` (now on the reconstructed route) over the 119 ledger items
   in the index.
3. Expect most of the old "colour wrong", "missing print" and "wrong mesh" failures to clear, the glass cluster
   above all.
4. Keep the CNS LED and emissive items (16, 22) and the balaclava nose poke-through as real site findings.

The red/blue goal records need no re-score: they never used the affected scripts.
