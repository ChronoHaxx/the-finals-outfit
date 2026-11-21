# Guided functional review: every emote in the picker

## What you are checking

The emote picker lists the 66 emotes it was missing (mostly Seasons 1 and 2), and in Chinals mode the five emotes
without an icon of their own sit under Uncategorised. This catches a missing season, a broken tile, prop or sound, or
an old link that no longer opens its emote.

- PR / originating issue: Shocka's feedback item 1 (`_docs/feedback-shocka-2026-11/README.md`); PR #62.
- Test this revision: branch `claude/all-emotes-2026-11-21`, the PR's head commit, as a production build pointed at
  the uploaded animations host `fd946744` (what the live site will use once the PR merges).
- Open: http://127.0.0.1:4355/the-finals-outfit/ (a local copy of the production build; the live site is unchanged
  until the merge).
- Prerequisites: none beyond this worktree. Models come from the live asset hosts, animations from `fd946744`.
- Approximate hands-on time: 5 minutes.
- Agent checks (21 Nov, details in README.md "Verification"): census PASS (229/229 old items read as on 5 Nov); clip,
  face-curve and sound pipelines PASS (byte-identical to the live files they overlap); upload PASS (2,586/2,586 files
  byte-identical on `fd946744`); production build PASS (`prod-check.json`: 295 emotes, old links, props, face curves,
  sound on a real click, Chinals Uncategorised · 5, no failed requests); `tsc -b` PASS; `npm test` 899 pass, 8 known
  failures (gitignored model files).
- User checks: **WAIVED by the owner on 21 Nov**; the agent ran steps 1-5 in their place, all PASS (Recorded result
  below). Agent results do not check the boxes below.

## Get it running

Skip this if the agent's server on port 4355 is still running (the page opens). Otherwise, in PowerShell, in
`E:\Coding\the-finals-outfit\.claude\worktrees\heuristic-darwin-d076c9`:

```powershell
npx vite preview --outDir scripts/generated/all-emotes-2026-11-21/prod/dist --base /the-finals-outfit/ --port 4355 --strictPort --host 127.0.0.1
```

Stop it with Ctrl+C. The build folder is made by `node _docs/all-emotes-2026-11-21/prod-check.mjs
--anim=https://fd946744.the-finals-outfit-assets.pages.dev/` (run it again if the folder is missing).

**Known issue, also on the live site:** an emote clicked in the first few seconds after the page loads can snap back
to the idle after about 2 s (README.md "Found in passing"). Wait about 20 s after the character appears before step 3,
or click the emote again. Note it if you see it, but it is not what this PR changes.

## Try it yourself

- [ ] **1. Start:** open http://127.0.0.1:4355/the-finals-outfit/ and close the welcome screen. Expected: the default
  outfit loads and plays its idle.
- [ ] **2. The new seasons:** click **Emotes**. Expected: the tab reads **Emotes 295**, and the note at the bottom says
  "with their props, sound and facial animation. Effects are not shown yet." Scroll to the end of the list:
  **Season 2 · 16** and **Season 1 · 41**, each tile with its game icon (Carrot Crusher, Make It Rain, Tama Kickoff...).
- [ ] **3. Play two of them** (speaker on): click **Coop Caper**, then **Gimme Five**. Expected: Coop Caper has a chicken
  plushie running around the feet, with its sound, and plays to its end; Gimme Five shows the translucent stand-in
  partner for the high five.
- [ ] **4. Renamed, not lost:** search `what's up` and play **What's Up?** (it was "Wave" under More). Then open **More**.
  Expected: it plays the wave; More's "Unlisted emote animations" now holds only **Tap Dance** (an animation no item plays).
- [ ] **5. Chinals Uncategorised:** switch to **Chinals**, open **Emotes**, scroll to the end. Expected:
  **Uncategorised · 5** ("No icon of their own in the game files"): Gacha_01 and four with Chinese names; clicking one plays it.

If something fails, stop at that step and report its number and what happened. Reply "1-5 pass", or e.g.
"3 fails: no chicken".

## Recorded result

- Owner's reply, verbatim (21 Nov 2026, about 22:00 UK): "do it for me, if u did, i  trust u, waive manual checks"
- Explicitly waived checks: steps 1-5 (the boxes above stay unticked: the owner did not run them).
- In their place the agent ran steps 1-5 as written ([user-steps.mjs](user-steps.mjs), result
  [user-steps.json](user-steps.json), `ok: true`, 22:07 UTC). Tested build: the production build of 5b5bf91 served on
  port 4355, animations from `fd946744`, headless Chrome as a visitor (automation flag masked, so idle autoplay, sound
  and the welcome screen behave as for a person), 1440×900, a 20 s wait after load (the known issue above).
  - 1 PASS: welcome screen shown and closed; the outfit idle plays (its clock advanced 0.01 → 1.12 s in 1 s).
  - 2 PASS: tab "Emotes 295"; the note reads "…with their props, sound and facial animation. Effects are not shown
    yet."; the list ends Season 3 · 19, Season 2 · 16, Season 1 · 41; all 57 Season 1-2 tiles show their game icon.
  - 3 PASS: Coop Caper played to its end (7.63 of 7.67 s) with its sound (`sounds-2/…FoxChicken_01.m4a`, audio
    running); the chicken plushie runs round the feet. Gimme Five played to its end (5.47 of 5.67 s) with its sound and
    prop file; its translucent partner stands at the right edge of the frame, behind the open picker at this window
    size (seen with the picker closed in `prod-check.mjs`'s hold).
  - 4 PASS: "what's up" finds only What's Up?, which plays to its end; More → Unlisted emote animations holds only
    "Tap dance".
  - 5 PASS: Chinals mode ends with Chinals emotes · 40 and Uncategorised · 5 ("No icon of their own in the game
    files": Gacha_01 and four Chinese names); Gacha_01 played to its end (13.23 of 13.33 s).
  - No failed request and no page error. Screenshots checked by eye.
  - Seen in an earlier, identical run (1 of 4): Gimme Five went back to the idle at 1.49 of 5.67 s, about 30 s after
    load. The known early-stop issue, which is therefore not limited to the first seconds; passed to the fix session.
- Readiness: ready to merge on the owner's waiver. The host `fd946744` is uploaded and `ANIMATIONS_BASE` points at it.
- Merge authorization: not yet given
