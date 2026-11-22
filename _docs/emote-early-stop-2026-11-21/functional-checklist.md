# Guided functional review: an emote picked while the outfit loads plays to its end

## What you are checking

An emote clicked in the first seconds after the page opens (the character is there, the outfit still loading) now
plays to its end and then eases into the idle, instead of snapping back to the idle after 1-2 s.

- PR / originating issue: PR #69 (https://github.com/ChronoHaxx/the-finals-outfit/pull/69); found while verifying PR #62 (`_docs/all-emotes-2026-11-21/README.md`, "An emote can go
  back to the idle after about 2 s").
- Test this revision: branch `claude/emote-early-stop-2026-11-21`; code as of `e885cf1` (the head commit adds this record only), as a local production build
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
- User checks: **waived by the user** on 22 Nov 2026 ("waive and merge 69" before the merge; "do the checks for me, i
  trust u, waive manual checks" after it). The agent ran steps 1-5 instead ("Recorded result" below); the boxes stay
  unticked because no user ran them.

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

- Tested revision/build: agent run of steps 1-5, 22 Nov 2026 00:15 UTC, after the merge. Steps 1, 2, 4 and 5 on the
  live site (the GitHub Pages deploy of main `96bf586`, which contains the merge `1081108`; its bundle
  `index-HMAlJ4F6.js` has `playUnder`). Step 3 on main just before the merge (`4848a7f`, same animations host
  `fd946744`), built locally. Script `agent-hand-checks.mjs`: headed Chrome (GPU rendering, real frame timing), a
  fresh profile per window as a private window has, visitor mode, sound muted, real clicks on the visitor's buttons.
  Results and screenshots in `scripts/generated/emote-early-stop-2026-11-21/hand-checks/` (not kept in git).
- Agent results (page seconds; not user results):
  - 1 PASS: Emotes clickable at 2.23 s, "Loading outfit…" shown from 2.41 s, the outfit finished at 10.20 s.
  - 2 PASS: Valkyria clicked at 3.51 s with the outfit still loading; it played to 7.30/7.33 s, then the outfit idle.
  - 3 PASS (the bug shows before the fix): Valkyria clicked at 1.48 s while loading; the outfit finished at 5.22 s and
    the idle replaced Valkyria at 5.37 s, with Valkyria at 3.14/7.33 s.
  - 4 PASS: Valkyria, replaced 2.08 s in by Gimme Five, which started from 0.03 s, played to 5.59/5.67 s, then the
    idle. Coop Caper closed with X: the idle 67 ms after the click.
  - 5 PASS: Animated turned to Animate and the still pose. After the reload the button still read Animate; Valkyria
    clicked while loading played to 7.24/7.33 s, then the still pose, unchanged 5 s later with the outfit loaded.
  - Each quick click landed while the outfit was loading on the first window; no throttling was needed.
- User reported at: no user run (waived, above).
- Passed / failed / untested step numbers: user: none run, 1-5 waived; agent: 1-5 pass.
- Explicitly waived checks, if any: 1-5, by the user on 22 Nov 2026.
- Readiness: merged as PR #69 (`1081108`, 22 Nov 2026 00:02 UTC), live since the deploy of `96bf586` (00:07 UTC).
- Merge authorization: the user, 22 Nov 2026, "waive and merge 69" (recorded on PR #69).
