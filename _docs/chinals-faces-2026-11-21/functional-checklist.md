# Guided functional review — Chinals emote faces

## What you are checking

In Chinals mode the face now moves during the Chinals emotes and idle, as in global emotes, from the new Chinals host
7c9add72; this catches a face that stays still, a missing sound or prop, or wrong wording.

- PR: https://github.com/ChronoHaxx/the-finals-outfit/pull/71 (Shocka feedback item 8)
- Test this revision: branch `claude/chinals-faces-2026-11-21`, app code at ee16736 (later commits are docs only). The
  build below is that code with deploy.yml's production settings and the new Chinals host.
- Open: http://127.0.0.1:4357/the-finals-outfit/#/chinals in Chrome or Edge
- Prerequisites: none beyond the build folder the agent made (`scripts/generated/chinals-faces-2026-11-21/prod/dist`)
- Approximate hands-on time: 8 minutes
- Agent checks: PASS (README.md "Verification (agent)", `prod-check.json`)
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

In PowerShell, in `E:\Coding\the-finals-outfit\.claude\worktrees\adoring-mclean-e8c1c8`:

```powershell
npx vite preview --outDir scripts/generated/chinals-faces-2026-11-21/prod/dist --base /the-finals-outfit/ --port 4357 --strictPort --host 127.0.0.1
```

Stop it with Ctrl+C. If the folder is missing, rebuild it with
`node _docs/chinals-faces-2026-11-21/prod-check.mjs` (same folder; it also reruns the agent check).
Nothing here saves to the live site; outfits you build are kept only in this local page's browser storage.

## Try it yourself

Turn the sound on. To see the face, zoom in on it with the mouse wheel.

- [ ] **1. Start:** open the link. Expected: the Chinals mode banner under the header, and the character plays the
  Chinals idle. Within about 10 seconds of watching the face, it blinks or glances.
- [ ] **2. Wording:** click **More** on the banner. Expected: "Props, sound and facial expressions are shown; effects
  are not." Then click **Play an emote** (the emote button). Expected: the footer of the picker reads "...with their
  props, sound and facial expressions. Effects are not shown yet."
- [ ] **3. Changed behaviour:** in the picker click **Unrivaled Master**. Expected: its sound plays, the guns appear,
  and around 3 seconds in the face shows surprise: mouth wide open in an "O", brows raised. It then returns to the idle.
- [ ] **4. Face switch:** play Unrivaled Master again, pause it on the timeline at about 3.2 s, then click **Facial
  animation** off and on. Expected: off gives a neutral, closed mouth; on brings the surprised face back.
- [ ] **5. Worn items:** in the item list pick Facial Hair → **Beard Full Black**, and play Unrivaled Master. Expected:
  the beard opens with the jaw, without a gap or the chin poking through. Then pick Facewear → **Balaclava Cotton
  Black** and play it again. Expected: the mask stays closed over the mouth; no lips show through it.
- [ ] **6. Nearby use:** click **Global** at the top left and play any global emote. Expected: global emotes behave as
  before (face moving, sound), and switching back to **Chinals** keeps the same outfit.

If something fails, stop at that step and report its number and what happened.
Reply "1-6 pass", or e.g. "3 fails: no sound."

## Recorded result

- Tested revision/build: PENDING
- User reported at: PENDING
- Passed / failed / untested step numbers: PENDING
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given

A later patch invalidates affected checks. Keep results for the previous
revision and record the retest; do not silently carry ticks to a new build.
