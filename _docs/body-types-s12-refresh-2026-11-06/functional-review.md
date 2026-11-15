# Guided functional review: Season 12 body-type refresh (whole catalogue)

## What you are checking

This preview gives the body and 178 garments their Season 12 body-type morphs together. It is checking two things:
- entirely-S12 outfits fit cleanly at hems, waistbands, necklines and layers in all three Medium body types;
- items that stay pre-S12 (reworked in S12, so not swappable) look acceptable on the S12 body, or not.

Details:
- Originating request: the stage 1 conclusion in `_docs/body-types-2026-11-06/README.md` ("one refresh, body and
  garments together"). The batch is described in `README.md` in this folder.
- Test this revision: branch `claude/quizzical-hermann-33b51b`. App code is `aa6c2e6` (stage 1, unchanged here); tools
  and docs are in the commits after it. The data under test is
  `public/models/s12-bodytype-refresh-v1/index-v4`. This is the merge candidate rebuilt on the moved active index
  (`acdb9897…`) on 6 Nov evening, with the same 179 meshes repointed as `index-v3`. 5195 serves the garments-only
  variant `index-v4a` (178 repoints, live body), which is the recommended merge for production (`HANDOFF.md`).
- Open: two local dev servers from this worktree. **5193** is live data and **5194** the S12 merge candidate. Neither
  is the main session's 5174.
- Prerequisites: none beyond this machine. Nothing is downloaded, and the game is not touched.
- Approximate hands-on time: 10–15 minutes.
- Agent checks: see **Agent results** below.
- User checks: **WAIVED, not run** (relayed by the main session; see **Recorded result**). Agent results do not tick
  the boxes below.

## Get it running

Both servers were left running at the end of the agent session. If a link does not load, start that server in its own
window.

**PowerShell**, in `E:\Coding\the-finals-outfit\.claude\worktrees\quizzical-hermann-33b51b`:

```powershell
node scripts/body-types/serve-preview.mjs --port 5193
```

```powershell
node scripts/body-types/serve-preview.mjs --port 5194 --preview ../../../public/models/s12-bodytype-refresh-v1 --index ../../../public/models/s12-bodytype-refresh-v1/index-v4
```

```powershell
node scripts/body-types/serve-preview.mjs --port 5195 --preview ../../../public/models/s12-bodytype-refresh-v1 --index ../../../public/models/s12-bodytype-refresh-v1/index-v4a --live-body
```

- Each server prints a `Local: http://127.0.0.1:<port>/` line.
- The first page load takes about a minute while Vite builds.
- Stop a server with Ctrl+C in its window.
- Neither server writes to `public/`.

## Try it yourself

Every outfit uses Face 01 and the tall canvas sneakers. Drag to orbit and scroll to zoom. To change body type, edit
`bodyType=` in the address bar and press Enter. To compare with live data, change the port from 5194 to 5193.

- [ ] **1. Start, and a live defect this batch fixes (corset, feminine):**
  <http://127.0.0.1:5194/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMiLCJ1cHBlckJvZHkiOiJtZWRpZXZhbC1kZW1vbmNvcnNldC1sZWF0aGVyIiwibG93ZXJCb2R5IjoiY3V0ZS1hbmltZWFyY2hlcnNraXJ0In19&reconstructed=1&bodyType=feminine>
  - Expected: the character loads in the demon corset and the anime archer skirt, with no error banner. The fishnet
    sleeves stay under the corset's edges at the chest and upper arms.
  - Then change the port to **5193**. Expected: the fishnet pokes through the corset. This is the live defect; only
    the body differs between the two ports.
- [ ] **2. An entirely-S12 outfit in all three body types (bare-shoulder sweater, gothic skirt):**
  <http://127.0.0.1:5194/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMiLCJ1cHBlckJvZHkiOiJjdXRlLWJhcmVzaG91bGRlcnN3ZWF0ZXItY290dG9uLWJsYWNrZGlzc3VuIiwibG93ZXJCb2R5IjoiZ290aGljLXNraXJ0LWNvdHRvbiJ9fQ&reconstructed=1&bodyType=feminine>
  - Look at the off-shoulder neckline, the sweater hem and the skirt waistband, front and back.
  - Expected: no skin or inner layer shows through at those edges. Then try `bodyType=masculine` and
    `bodyType=androgynous`: clean too.
  - Androgynous looks the same on 5193 and 5194.
  - The sweater activates `push_lower_torso`, the body fitting morph that S12 changed by 0.79 cm in every body type
    (`route-review-2026-11-06.md`). So this step also checks that the change stays hidden under the sweater.
- [ ] **3. What every production user would see change (football hoodie, municipal pants, masculine):**
  <http://127.0.0.1:5194/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMiLCJ1cHBlckJvZHkiOiJzcG9ydC1mb290YmFsbGhvb2RpZS1qZXJzZXkiLCJsb3dlckJvZHkiOiJtdW5pY2lwYWwtcGFudHMtbnlsb24ifX0&reconstructed=1&bodyType=masculine>
  - Both garments carry new Season 12 `medium_male` morphs (up to 2.55 cm and 1.81 cm).
  - Expected: compared with 5193, the shapes differ slightly. There are no gaps or poke-through at the crop hem, the
    belt or the harness straps.
- [ ] **4. A pre-S12 top over the S12 municipal pants (zebra hoodie, masculine):**
  <http://127.0.0.1:5194/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMiLCJsb3dlckJvZHkiOiJtdW5pY2lwYWwtcGFudHMtbnlsb24iLCJ1cHBlckJvZHkiOiJzdHJlZXR3ZWFyLWhvb2RpZS16ZWJyYSJ9fQ&reconstructed=1&bodyType=masculine>
  - The hoodie stays pre-S12 (reworked); the pants are S12. This is the cross-item risk for production masculine.
  - Look at the hoodie's rib hem over the pants' waistband, front, side and back.
  - Expected: no gap and no waistband or harness poking through the hem. It looks like 5193 apart from slightly
    different pants.
  - Optional: change to `bodyType=feminine` and zoom to the back waist. The two harness strap ends under the belt
    show their cut tops on 5194, not on 5193. That is the pants' own S12 shape (one mesh); report whether you see it.
- [ ] **5. A pre-S12 top over S12 jeans (tech crop top, feminine):**
  <http://127.0.0.1:5194/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMiLCJ1cHBlckJvZHkiOiJzdHJlZXR3ZWFyLXRlY2hjcm9wdG9wLW55bG9uLWl2YWRhIiwibG93ZXJCb2R5IjoiY2FzdWFsLXRpZ2h0amVhbnMtZGVuaW0tYmx1ZSJ9fQ&reconstructed=1&bodyType=feminine>
  - Zoom to the front waist.
  - Expected (the agent's finding): the jeans' belt cuts through the crop top's pink strap. The same view on 5193 is
    clean.
  - Report whether you see the same, and whether it would be acceptable to ship before the refresh.
- [ ] **6. A pre-S12 garment over the S12 body (tube top, short skirt, feminine):**
  <http://127.0.0.1:5194/?outfit=1.eyJzbG90cyI6eyJmYWNlIjoiaGVhZC1mYWNlLTAxLWJhc2UiLCJmZWV0IjoiY2FzdWFsLXRhbGxzbmVha2Vycy1jYW52YXMiLCJ1cHBlckJvZHkiOiJjYXN1YWwtdHViZXRvcC1jb3R0b24tYmxhY2siLCJsb3dlckJvZHkiOiJjYXN1YWwtc2hvcnRza2lydC1jb3R0b24ifX0&reconstructed=1&bodyType=feminine>
  - Expected (the agent's finding): the S12 chest pokes through the tube top's neckline. On 5193 it does not.
- [ ] **7. Ordinary use (S12, feminine):** on 5194 with `bodyType=feminine`, change Upper Body and Lower Body to any
  other items in the panel.
  - Expected: they load and follow the feminine body, and the body type stays feminine after each change.
  - Note any item where something pokes through. If it also does on 5193, it is not this batch's.

If something fails, stop at that step and report its number and what happened. For example, reply "1-4 and 7 pass,
5 and 6 seen" or "2 fails: skin shows between the sweater and the skirt".

## Agent results

Agent PASS for the batch as a preview: built, proven, indexed and reviewed. It is **not** an agent PASS for shipping
feminine piecemeal (see the findings).

**Tests** (re-run 6 Nov, 14:00):
- `python -I scripts/body-types/test_build_preview_index.py`: 7 / 7 pass (item rule, census guard, kept-unchanged
  refusals, root-cause reasons, fixpoint cascade, `--changed-only`).
- `node --import tsx --test tests/rig/body-type-preview.test.ts`: 14 / 14 pass (stage 1 app code, unchanged here).

**Proof and coverage** (`README.md` steps 3–5):
- 923 meshes rebuilt: 681 morph-only and 242 refused (199 reworked in S12, 11 live-derived, 32 with no pre-S12 copy).
- Merge candidate `index-v3` repoints 179 meshes (178 garments and the body). 1,123 supported items are S12
  throughout, and 885 stay mixed.

**Captures** (headless Edge, 1500×1100, 5193 live against 5194 `index-v3`):
- `review-v1`: 12 outfits × 3 body types × 5 cameras × 2 servers = 360 shots.
- `review-v1-masculine`: 30 shots.
- `review-v1-cross`: 3 outfits × 3 body types × 4 cameras × 2 servers = 72 shots.
- 0 console errors in every run. The S12 server served the rebuilt file for exactly the swapped garments.

**Findings** (read at full size, side by side):
- Entirely-S12 outfits (a1–a8) are clean in all three body types.
- The corset outfit's live feminine poke-through is fixed by the S12 body.
- Androgynous matches live everywhere.
- On masculine, the mixed outfits match live, and the two changed garments (football hoodie, municipal pants) fit each
  other.
- Pre-S12 hoodie, crop top and tee over the S12 municipal pants: no masculine defect; on feminine, clean edges except
  the exposed harness strap ends at the back. Those come from the pants' own S12 sculpt, because harness and pants are
  one mesh.
- On feminine, 4 of 5 mixed outfits show a new defect: short dress back hem, crop-top strap, hoodie rib hem, tube-top
  neckline. Steps 5 and 6 are two of them.
- Two defects are on live too: a2 tights fleck at the back waistband, a5 body-mask stair-step at the lower back flank.

## Recorded result

Recorded 6 Nov 2026, evening, from the main session's relay (session `local_5cf48e40`, the release owner). This
session did not see the user's words itself.

- Tested revision/build: none. The user did not run the checks.
- User reported at: about 19:30 London, 6 Nov 2026, in the main session's chat.
- Passed / failed / untested step numbers: steps 1–7 untested.
- Explicitly waived checks: all 7. The user selected the S12 body-type refresh among the pending pieces to ship. The
  main session reports that the option's label named 179 meshes and said the checks were pending. The user's words,
  verbatim as relayed:
  1. "also please merge everything we have locally so its live"
  2. "obviously for all of them check with the owner session so eveyrthing goes smoothly, after merge done and
     confirmed live only then archive the session (make sure no outstanding or parked issue lost),PR #15 SEO
     basics,PR #24 site health,S12 body-type refresh,Face of Éternel"
- What shipped: the **garments-only** variant (178 meshes, live body), on this session's recommendation. The user's
  selection named 179; nobody re-asked them about 178 against 179.
  - The main session applied `merge-patch-v2.json` with `--garments-only` to the active index at 19:57 UTC: 178
    repointed, 0 skin pairs rewritten.
  - The log is in the root checkout at `_docs/goal-100-2026-10-11/release-evening/s12-garments-merge/apply-v2.log`.
  - Verified here afterwards: the active `assets.json` is sha256 `5c36c6b6a08e7d59…`, identical to `index-v4a`, and
    `skin-pairs.json` is unchanged at `f15a73a2…`.
- Readiness: shipped on the waiver, with agent evidence only (**Agent results**).
  - Steps 1–6 target 5194, the full candidate with the S12 body. Steps 1 (corset fix) and 6 (tube-top neckline)
    depend on that body, so they do not describe what shipped.
  - Steps 3 and 4 are the masculine changes visitors see, captured by the agent on both variants.
  - No agent capture covers step 7, changing items in the panel, or free orbiting. Those stay unchecked until someone
    looks at live.
- Merge authorization: the user, through the main session, which ships it in the 6 Nov release PR.
