# Guided functional review — multi-character Phase 2 (the squad page, behind a flag)

## What you are checking

A new page, `#/squad`, puts up to three contestants on one stage, each a saved copy of an outfit with its own player
number. This catches a squad that loses contestants, a copy that follows later outfit edits, a squad page that changes
your saved outfits, or a builder that looks different from before.

- PR / originating issue: Phase 2 of `_docs/multi-character-2026-11-11/README.md` (request of 11 Nov 2026,
  "Recommended MVP"; "Start Phase 2" on 22 Nov; page name "Squad (#/squad)"; shadows "You build it")
- Test this revision: branch `claude/multi-character-phase2-2026-11-22`, code as of 2e7d11c (main 5fcc4ee merged in,
  plus the delete-last-squad fix); later commits on it are documentation only unless this line says otherwise
- Open: a local production build at http://127.0.0.1:5195/
- Prerequisites: this worktree (its `node_modules` is present); Chrome or Edge; internet (models come from the live
  asset hosts)
- Approximate hands-on time: 10 minutes
- Agent checks: PASS, all steps, on a production build of 2e7d11c (see "Agent results")
- User checks: **WAIVED** under the standing waiver of 22 Nov (quoted in "Recorded result"). Agent results do not tick
  the boxes below.

## Get it running

PowerShell, in `E:\Coding\the-finals-outfit\.claude\worktrees\friendly-sanderson-4b3b98`:

```powershell
$env:VITE_SCENES_BASE = "https://1d367244.the-finals-outfit-assets.pages.dev/"; node _docs/igpu-perf-2026-11-21/serve-like-deploy.mjs
```

It builds into `dist\like-deploy` (ignored by git) and serves it. Wait for "Serving ... at http://127.0.0.1:5195/", and
press Ctrl+C to stop. This address keeps its own storage, so your saved outfits and squads on the live site are not
touched.

## Try it yourself

- [ ] **1. The flag:** open http://127.0.0.1:5195/#/squad. Expected: a "Squads" page saying "Not open yet." Then open
  http://127.0.0.1:5195/#/squad?preview=on. Expected: the squad page, with "No squad yet" in the squad list,
  "Contestants · 0 / 3" and "Add a contestant to start" on the stage.
- [ ] **2. The builder's outfit, with your number:**
  - Open http://127.0.0.1:5195/#/?o=2.36o.81qz.a1bl.cct and press View shared outfit.
  - Type 45 in Number and press Enter.
  - Change the address to http://127.0.0.1:5195/#/squad and press Add the builder's outfit.
  - Expected: "Loading contestant 1 of 1…" at the bottom left. Then the jersey contestant stands in the middle with 45
    on its left sleeve, idling, and "Squad 1" appears in the list.
- [ ] **3. Copies, one at a time, and the cap:**
  - Press ← Builder, then Own (next to Number). Go back to `#/squad` and press Add the builder's outfit.
  - Expected: a second jersey appears on the left showing its own 32. The middle one keeps 45, because it is a copy.
  - In the builder, open the outfit name (Saved outfits) and press New outfit. On `#/squad`, choose the new
    "Outfit …" under Saved outfit… and press Add.
  - Expected: a T-shirt contestant on the right. Only one row says "Loading…" at a time. At 3 / 3 both add controls
    grey out and the panel says "A squad holds up to 3 contestants".
- [ ] **4. Nothing is lost:**
  - Reload the page. Expected: the same three, in the same places.
  - Remove the right one, then press Undo at the bottom. Expected: it comes back.
  - Press Delete squad. Expected: "No squad yet".
  - Press Undo. Expected: Squad 1 with all three, and only one squad in the list.
- [ ] **5. The builder is unchanged, and the look carries over:**
  - Press ← Builder. Expected: your current outfit, and the Saved outfits list holds the same outfits as before, with
    nothing added or changed by the squad page.
  - Open Lighting, pick Lobby, and go back to `#/squad`. Expected: a navy backdrop and blue rim light on all three.

If something fails, stop at that step and report its number and what happened.
Reply "1-5 pass" (using the actual step numbers), or for example "4 fails: Undo brought back an empty squad."

## Agent results

- Production build of 2e7d11c, `squad-prod-check.mjs` (result in `squad-prod-check.json`), run 22 Nov 2026 18:45
  London, headless Chrome with the automation flag masked, so it behaves as a visitor (idle playing, stored lighting).
  - Steps 1-5 all match "Expected":
    - one contestant loading at a time on each add;
    - two frames 0.7 s apart differ (idle playing);
    - saved outfits byte-for-byte identical before and after everything done on the squad page, and again back in the
      builder.
  - Phone (390×844, touch, coarse pointer): three in the squad, two on the stage, "1 more kept in this squad for a
    larger screen." JS heap with two shown: 865 MB.
  - Full-size captures were looked at: the Studio look with the sleeves reading 3… and 4…; the Lobby look; the phone
    layout. No page errors.
  - The first run of this check (on 0d523ba) found a defect: deleting the only squad made a replacement empty
    "Squad 1", and Undo then listed two. It was fixed in 2e7d11c; `tests/use-squads.test.ts` fails 3/3 on the old code
    and passes on the fix.
- Builder unchanged: `phase1-equivalence.mjs` recorded main 5fcc4ee's own code and this branch on the same assets. It
  found no structural difference over the 14 still steps or the 3 posed links. Before the merge of main, the same was
  true against 137c920, and a pair of full-size captures (coat over shirt) was identical by eye.
- Dev build, `squad-probe.mjs` on 0d523ba:
  - one at a time;
  - reload, Remove + Undo;
  - per-contestant number (45 beside 32, close-up);
  - fitted shadows under a low side sun: every contestant's whole shadow;
  - the Lobby look;
  - idle moving per contestant (pelvis).
- Frame time and memory (`squad-profile.json`, dev build):
  - busy JS per frame: 3.21 / 9.52 / 14.95 ms for 1 / 2 / 3 contestants;
  - JS heap after GC: 572 / 927 / 1283 MB.
- `npx tsc -b --noEmit` clean. `npm test`: everything passes except the 8 tests that read model files, which this
  worktree does not have extracted. Those 8 fail the same way on main.

## Recorded result

- Tested revision/build: production build of 2e7d11c (`serve-like-deploy.mjs`, deploy.yml hosts plus SCENES_BASE)
- User reported at: not asked. Checks waived under the standing waiver: on 22 Nov 2026 at about 00:08 London the owner
  wrote "for all sessions and subsession especially ones that are still open and waiting for me, where possible please
  waive manual checks, i trust u as u can do the same checks better than me".
- Passed / failed / untested step numbers: agent PASS 1-5 and the phone layout, 22 Nov 2026 18:45 London. Not a user
  PASS.
- Explicitly waived checks, if any: 1-5 (as above). Not covered by anyone: a real phone's memory and frame rate.
- Readiness: agent-verified under the waiver; the preview flag keeps the page closed to visitors.
- Merge authorization: not yet given for this PR.

A later patch invalidates affected checks. Keep results for the previous revision and record the retest; do not
silently carry ticks to a new build.
