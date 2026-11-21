# Guided functional review — multi-character Phase 1 (groundwork + head-static fix)

## What you are checking

The builder's outfit loading and animation bookkeeping moved out of the viewer into reusable pieces (so a scene can
hold several characters later); this catches an outfit, emote, idle setting or shared pose that behaves differently
from the live site.

The head-static fix (1.5) has nothing you can look at today: in the live builder head items go through source
assemblies, which were already placed correctly, and in legacy mode the one affected item found (Earrings Bullet 01)
sits inside the earlobe at rest with or without the fix. Its evidence is the agent results below; the turned-character
case becomes visible with the Scene page (Phase 2).

- PR / originating issue: https://github.com/ChronoHaxx/the-finals-outfit/pull/66; design `_docs/multi-character-2026-11-11/README.md`
  (request of 11 Nov 2026, "Recommended MVP", Phase 1)
- Test this revision: branch `claude/multi-character-2026-11-21` at its head (code as of 214991e; later commits on it
  are documentation only unless this line says otherwise)
- Open: a local production build of the branch at http://127.0.0.1:5195/, next to the live site
  https://chronohaxx.github.io/the-finals-outfit/
- Prerequisites: this worktree (its `node_modules` is present); Chrome or Edge; internet (models come from the live
  asset hosts)
- Approximate hands-on time: 10-15 minutes
- Agent checks: see "Agent results" below
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

PowerShell, in `E:\Coding\the-finals-outfit\.claude\worktrees\friendly-sanderson-4b3b98`:

```powershell
node _docs/igpu-perf-2026-11-21/serve-like-deploy.mjs
```

It builds into `dist\like-deploy` (ignored by git) and serves it; wait for "Serving ... at http://127.0.0.1:5195/".
Ctrl+C stops it. Your saved outfits on the live site are not touched (a different address keeps its own storage).

## Try it yourself

- [ ] **1. Start:** open http://127.0.0.1:5195/. Expected: the default outfit (Face 01, black T-shirt, jeans,
  sneakers) loads and the idle plays, as on the live site.
- [ ] **2. Outfit changes:** pick a hair (High Ponytail Black), a hat, a pair of glasses and a long coat, then switch
  the face to Face 03 Base, then remove the hat. Expected: each piece appears as it does on the live site; removing the
  hat brings the full hair back; no error banner.
- [ ] **3. Emotes and the idle setting:** open Emotes and play one; press Pause, drag the timeline, press Play; close
  the emote. Then press Animated (it turns to Animate, the still pose) and reload the page. Expected: the emote plays,
  pauses and scrubs as on live and closing returns to the idle; after the reload the character stays still. Press
  Animate and reload again. Expected: the idle plays after the reload.
- [ ] **4. Shared pose:** play an emote and pause it partway through, press Share outfit, copy the link (with
  "Include this frame" ticked) and open it in a new tab. Expected: the same outfit, paused on the same frame.

If something fails, stop at that step and report its number and what happened.
Reply "1-4 pass" (using the actual step numbers), or e.g. "3 fails: the idle starts again after reload."

## Agent results

- Still equivalence (`phase1-equivalence.mjs`, 14 scripted outfit edits through the app's own build store: hair,
  helmet, mask, glasses, coats, decals, face swap, legacy statics, body types) and posed equivalence (3 paused pose
  links: idle with ponytail spring, boomerang props, ace-pilot with glasses/earrings/bangles/backpack): no structural
  difference from main. After the rebase onto main a2c6019 both were re-recorded from main's own code on the same
  assets (`main-a2c6019`) and compared again: no difference. (Against the older b2e9c14 baseline the Bullet earring
  now loads as a source assembly: the shared asset index changed on 21 Nov, not the code.)
- Idle setting: stopping the idle, reloading, starting it and reloading again keeps each choice (dev build, headless
  Chrome).
- Head statics: `tests/rig/head-static-placement.test.ts` (all four kinds turned, mid-emote and both; eye anchor and
  earlobe with a head; glasses swapped mid-emote after others), failing before the fix. Real app, dev legacy mode
  (`head-static-swap.mjs --legacy`): the earring swapped in mid-emote is identical to one equipped at rest; the old
  code put it on the head bone, 7.4 cm off. Close-ups (`--shot`) show the earring inside the lobe either way, so this
  is not a user check.
- Type check; `npm test` (the worktree lacks extracted models, so 8 model-reading tests fail there and on main alike).
- Phase 1.4 (frame-time) code reached main through PR #64 before this PR; its profile evidence is kept here.

## Recorded result

- Tested revision/build: none yet
- User reported at: pending
- Passed / failed / untested step numbers: 1-4 untested
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given

A later patch invalidates affected checks. Keep results for the previous revision and record the retest; do not
silently carry ticks to a new build.
