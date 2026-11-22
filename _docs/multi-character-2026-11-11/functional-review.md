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
- Test this revision: branch `claude/multi-character-2026-11-21` at its head (code as of e4d7233, the merge of main
  96bf586: emote speed and facial animation switch, Season 1-2 emotes, the early-stop fix, player number; later
  commits on it are documentation only unless this line says otherwise)
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
- After merging main 80ea734 (7e482c3; #58 speed slider and facial animation switch touch the moved animation code):
  both equivalence probes against the `main-a2c6019` baselines show no difference; `npm test` 933 pass (same 8
  model-reading failures); production-like build: the speed slider runs the emote at 1.5x, and the facial animation
  switch stops the face (0 of 610 facial bones moving) and restarts it (289 moving, as before switching off).
- After merging main 1081108 (3a5eebd; #69's early-stop fix lives in the first-motion step this PR moved into
  `useAnimationBinding.ts`, so it was carried over there): both equivalence probes unchanged; `npm test` 938 pass;
  #69's own probe on a production build: Valkyria and Applause Pause, picked 0.5 s after the emote button enables, play
  to their end and then the idle (without the carried-over fix both snap to the idle within a second).
- After merging main 96bf586 (e4d7233; #60 player number, an import conflict in `CharacterViewer.tsx`): both
  equivalence probes unchanged; `npm test` 954 pass; dev build, #60's checklist outfit: 2 pieces print a number, each
  its own (32, 14) until 45 is set, then both garments' compiled programs read 45.

## Recorded result

- Tested revision/build: 5cd9819 (code as of e4d7233), production-like build (`serve-like-deploy.mjs`, 5195), headless
  Chrome as a visitor (navigator.webdriver masked), 22 Nov 2026, by the agent on the owner's instruction below
- User reported at: not a user run; the owner handed the checks to the agent (22 Nov 2026)
- Passed / failed / untested step numbers: 1-4 passed (agent run). 1: default outfit (Face 01 Base, SPECTATOR STANDARD,
  BUCKLE-UP JEANS, CANVAS SHOES), the outfit idle playing, no banner. 2: High Ponytail Black, CASE-CLOSED FEDORA,
  Glasses Metal, Coat Leather Black, Face 03 Base, hat removed: each worn as picked, no banner; still renders of the
  outfit with and without the hat are identical to the live site front and back, the full ponytail back once the hat
  is off. 3: Valkyria's Embrace played, paused (time held), timeline dragged frame 45 → 168 while paused, played on,
  closed back to the idle; Animated → Animate, after reload still (button Animate); Animate, after reload the idle
  plays. 4: paused at 2.273 s (frame 68), short link with "Include this frame" ticked
  (`&emote=ace-pilot&t=2.273&paused=1`, clipboard matches); the new tab opens the same 7 pieces paused at 2.273 s, the
  same pose on screen. Only console error: the share panel's preview-card request to the share Worker is refused by
  CORS from 127.0.0.1 (the Worker answers the live origin; the share panel is not in this PR).
- Explicitly waived checks, if any: all four handed to the agent. The owner, 22 Nov 2026: "do the cheks for me, if
  pass merge" (verbatim). Steps 1-4 are run by the agent on that instruction; they are agent results, not user ticks.
- Readiness: ready (steps 1-4 passed in the agent's run; CI build, tests and share-link compatibility green)
- Merge authorization: given on condition that steps 1-4 pass (same message)

A later patch invalidates affected checks. Keep results for the previous revision and record the retest; do not
silently carry ticks to a new build.
