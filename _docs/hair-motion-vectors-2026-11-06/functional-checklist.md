# Guided functional review — smooth moving hair (motion vectors) and the Graphics setting

## What you are checking

Hair and sheer fabric should stay smooth while anything moves (the idle, emotes, camera drags) on the new High
setting. A Graphics dropdown (Auto by default) picks the setting. This catches grain on moving hair, ghost trails
behind moving parts, a pop when movement stops, and a setting that is forgotten or wrongly chosen.

- PR / originating issue: none yet (the user's report on 6 Nov: grain on any movement)
- Test this revision: uncommitted working tree of branch `claude/hair-motion-vectors-2026-11-06`, base `0e272b0`,
  worktree `E:\Coding\the-finals-outfit\.claude\worktrees\agitated-northcutt-fbe7d2`
- Open: http://127.0.0.1:5181/?reconstructed=1 (dev server in the session's "showcase 5181" terminal tab)
- Prerequisites: none to download. Use the default outfit, or add a long hairstyle from **Hair**.
- Approximate hands-on time: 6 minutes
- Agent checks: PASS (README "Checks": 102 + 38 + 19 GPU checks, unit tests, typecheck, build, headless UI check,
  ground-truth scores and full-size captures reviewed by eye)
- User checks: **WAIVED** on 10 Nov ("i didnt check but just ship it"). The boxes below stay unchecked.

## Get it running

If the 5181 server is up, reload the page first (Ctrl+R) so the new code loads. Otherwise, in **PowerShell**, working
directory `E:\Coding\the-finals-outfit\.claude\worktrees\agitated-northcutt-fbe7d2`:

```powershell
node _docs/showcase-animation-2026-11-05/serve-5181.mjs
```

## Try it yourself

- [ ] **1. The setting:** look at the top right of the 3D view. Expected: a **Graphics** dropdown next to **Studio**
  that reads "Auto · High" on your PC.
- [ ] **2. Idle, High vs Balanced:** zoom in on the head (scroll) with a long hairstyle and let the idle play. Switch
  Graphics between **High** and **Balanced** a few times, watching the hair for a few seconds each. Expected: on High
  the moving hair keeps fine strands and soft edges, with no salt-and-pepper speckle. Balanced looks like before
  (grainier while it moves).
- [ ] **3. Emote:** on **High**, play a lively emote: search `vie` and play **C'est la vie** (the dance the
  measurements used), or **Funky Fresh**. Expected: hair
  and clothes stay smooth while moving, and nothing leaves a ghost or trail on the background. A faint soft edge
  behind a fast hair swing is a known limit.
- [ ] **4. Drag and stop:** click **Animated** (it changes to **Animate**) to hold the still pose, drag the view
  quickly and let go. Click **Animate** to bring the idle back and drag again. Expected: the hair stays smooth all the way to a stop. There is no grain burst while
  it eases out, and no pop or brightness change when it settles.
- [ ] **5. Remembered:** pick **Low**, reload the page. Expected: it still says Low and looks a little softer. Pick
  **Auto** again and reload: "Auto · High".

If something fails, stop at that step and report its number and what happened. Reply "1-5 pass" or e.g. "3 fails:
the arm leaves a trail".

## Recorded result

- Tested revision/build: none (the user did not run the steps)
- User reported at: 10 Nov 2026, 12:18 local, in the session chat: "i didnt check but just ship it"
- Passed / failed / untested step numbers: 1-5 untested by the user
- Explicitly waived checks, if any: 1-5, all waived by the message above
- Readiness: shipped on the waiver, after merging main and re-running the agent checks (see the README); real-device
  behaviour, phones included, is unverified by the user
- Merge authorization: the same message ("just ship it")
