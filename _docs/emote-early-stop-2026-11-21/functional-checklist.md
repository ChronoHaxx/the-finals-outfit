# Guided functional review: an emote picked while the outfit loads plays to its end

## What you are checking

An emote clicked in the first seconds after the page opens (the character is there, the outfit still loading) now
plays to its end and then eases into the idle, instead of snapping back to the idle after 1-2 s.

- PR / originating issue: found while verifying PR #62 (`_docs/all-emotes-2026-11-21/README.md`, "An emote can go
  back to the idle after about 2 s"); this PR: see the branch below.
- Test this revision: branch `claude/emote-early-stop-2026-11-21`, the PR's head commit, as a local production build
  (deploy.yml's asset hosts, animations `17ec92c3`, what the live site uses today).
- Open: http://127.0.0.1:4356/the-finals-outfit/ (local copy with the fix). Step 3 also uses the live site,
  https://chronohaxx.github.io/the-finals-outfit/ (without the fix), for comparison.
- Prerequisites: none beyond this worktree. Use a **private (InPrivate / Incognito) window** for each page load: it
  starts with no saved settings (a remembered "still" choice would hide the idle) and a cold cache, which leaves a
  longer gap between the character appearing and the outfit finishing.
- Approximate hands-on time: 5 minutes.
- Agent checks (21 Nov, details in README.md "Verification"): live-site trace shows the cause (`play(outfit-idle)`
  over the emote the moment the outfit pass ends); 3 new unit tests fail before and pass after; `tsc -b` PASS;
  `npm test` 928 pass, 8 known failures (gitignored model files); headless Chrome as a visitor on a local production
  build: main's source snaps back at 1.42/7.33 s, the fix plays to the end then returns to the idle; late click and
  automated paths unchanged.
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

Skip this if the agent's server on port 4356 is still running (the page opens). Otherwise, in PowerShell, in
`E:\Coding\the-finals-outfit\.claude\worktrees\frosty-kapitsa-9ef2dc`:

```powershell
npx vite preview --outDir scripts/generated/emote-early-stop-2026-11-21/prod/dist --base /the-finals-outfit/ --port 4356 --strictPort --host 127.0.0.1
```

Stop it with Ctrl+C. If the build folder is missing, make it first with
`node _docs/emote-early-stop-2026-11-21/prod-build.mjs` (same folder).

Headless timing differs from yours: on a fast machine the gap between the character appearing and the outfit loading
can be under a second. If you can never click in time, open DevTools (F12) > Network, set throttling to **Fast 4G**
before loading, and repeat; turn it back off afterwards.

## Try it yourself

- [ ] **1. Start:** in a new private window, open http://127.0.0.1:4356/the-finals-outfit/ and press **Esc** as soon
  as the welcome screen shows. Expected: the character appears and the **Emotes** button becomes clickable while the
  outfit is still loading (pieces still appearing, or **Loading outfit…** in the corner).
- [ ] **2. The fix:** as soon as **Emotes** is clickable, click it and pick **Valkyria** (about 7 s long), before the
  outfit has finished. Expected: Valkyria plays through to the end (the timeline along the bottom runs all the way),
  then the character eases into the outfit idle. No snap back after 1-2 s.
- [ ] **3. Before, on the live site:** in another new private window, do steps 1-2 on
  https://chronohaxx.github.io/the-finals-outfit/. Expected: Valkyria snaps back to the idle after 1-2 s (the bug,
  still live until this merges). If it plays to the end there too, the click came after the outfit had loaded: try
  again faster, or with Fast 4G throttling.
- [ ] **4. Ordinary use:** back on the local page, now fully loaded and idling, pick **Valkyria** again, and partway
  through pick another emote. Expected: each plays from the start, the second replaces the first, and at its end the
  idle returns. Then pick one more and close its timeline with **X**: back to the idle at once.
- [ ] **5. Remembered still choice:** click **Animated** (left of the Emotes button; tooltip "Return to the still
  pose") so it reads **Animate** and the character stands still, reload the page (same private window), and repeat
  step 2 quickly. Expected: Valkyria plays to its end, then the character goes back to standing still (your choice is
  kept: no idle starts on its own).

If something fails, stop at that step and report its number and what happened. Reply "1-5 pass", or e.g.
"2 fails: it went back to the idle after 2 s".

## Recorded result

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given
