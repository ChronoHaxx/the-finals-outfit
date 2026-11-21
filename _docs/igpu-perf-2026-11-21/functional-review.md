# Guided functional review — integrated-GPU frame rate (Shocka item 7)

## What you are checking

The viewer stops spending most of each frame re-checking the head's skeleton, so it runs faster on slow processors
(MSAA and Off most of all) and looks exactly the same; this catches a slower or changed-looking viewer, or a view that
no longer settles after you move it.

- PR / originating issue: PR_LINK; `_docs/feedback-shocka-2026-11/README.md`, item 7
- Test this revision: branch `claude/igpu-perf-2026-11-21`, commit COMMIT
- Open: a local production build of the branch at http://127.0.0.1:5195/, next to the live site
  https://chronohaxx.github.io/the-finals-outfit/
- Prerequisites: this worktree (its `node_modules` is already linked); Chrome or Edge; internet (models come from the
  live asset hosts)
- Approximate hands-on time: 10 minutes
- Agent checks: see "Agent results" in `_docs/igpu-perf-2026-11-21/README.md` (timing before/after, unit tests,
  type check, same-pose pixel comparison)
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

PowerShell, in `E:\Coding\the-finals-outfit\.claude\worktrees\sweet-goldberg-8ef292`:

```powershell
node _docs/igpu-perf-2026-11-21/serve-like-deploy.mjs
```

It builds into `dist\like-deploy` (ignored by git) and serves it; wait for "Serving ... at http://127.0.0.1:5195/".
Ctrl+C stops it. Your saved outfits on the live site are not touched (a different address keeps its own storage).

## Try it yourself

- [ ] **1. Start:** open http://127.0.0.1:5195/. Expected: the default outfit (Face 01, black T-shirt, jeans,
  sneakers) loads and the idle plays.
- [ ] **2. Faster under a slow processor:** in both tabs (local and live), open Graphics: Low, Resolution 50%,
  FPS counter on. Open DevTools (F12) > Performance > the gear > CPU: 4x slowdown (keep DevTools open). Switch
  anti-aliasing TAA, MSAA, Off in each tab and note the FPS. Expected: the local build is clearly faster in every
  mode, most of all MSAA and Off (live: Off slowest; local: Off about as fast as TAA or faster).
- [ ] **3. Looks the same:** turn CPU throttling off. In both tabs: Graphics High, Resolution Auto, TAA; press
  Pause; zoom onto the face. Expected: the two faces look the same (skin, eyes, brows, lashes, shading). Repeat
  with Off. Expected: the same.
- [ ] **4. Settles after moving (Off):** local tab, anti-aliasing Off, paused. Drag to orbit the camera, then let go.
  Expected: the view goes still and sharp within a second, no lingering shimmer or doubled edges; the same with
  MSAA.
- [ ] **5. Other heads and the face moving:** local tab, Face: pick Face 11, then Face 02. Press Play, open Emotes
  and play one with facial animation. Expected: each head sits correctly on the neck and its face moves with the
  emote; nothing stretches or lags behind the head.
- [ ] **6. Nearby ordinary use:** equip a hat and hair, take a screenshot with the camera button. Expected: the
  screenshot looks like the view; the hat and hair follow the head while the idle plays.

If something fails, stop at that step and report its number and what happened.
Reply "1-6 pass" (using the actual step numbers), or e.g. "4 fails: Off keeps shimmering after I let go."

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given

A later patch invalidates affected checks. Keep results for the previous revision and record the retest.
