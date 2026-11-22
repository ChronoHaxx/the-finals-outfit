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
- [ ] **5. Worn items:** in the item list pick Facial Hair, search **Full Beard** and pick the first (black) one, and
  play Unrivaled Master. Expected:
  the beard opens with the jaw, without a gap or the chin poking through. Then pick Facewear → **Balaclava Cotton
  Black** and play it again. Expected: the mask stays closed over the mouth; no lips show through it.
- [ ] **6. Nearby use:** click **Global** at the top left and play any global emote. Expected: global emotes behave as
  before (face moving, sound), and switching back to **Chinals** keeps the same outfit.

If something fails, stop at that step and report its number and what happened.
Reply "1-6 pass", or e.g. "3 fails: no sound."

## Recorded result

- Waiver: relayed by the coordinator session on 22 Nov (not seen first-hand here): the owner, 22 Nov 00:08, "i trust u
  as u can do the same checks better than me". The boxes stay unticked; the agent ran steps 1-6 in their place.
- Tested build: production build of app code ee16736 (head 2614475; later commits docs only), Chinals host 7c9add72,
  global fd946744; [user-steps.mjs](user-steps.mjs) as a visitor (automation masked), 22 Nov ~00:35-01:00 UTC, five runs.
- 1 PASS: Chinals banner and idle; upper eyelids reach 20° (a blink); face files from 7c9add72, all 200.
- 2 PASS: banner and footer wording exactly as above.
- 3 PASS in 4 of 5 runs: sound, props, surprise face at 3.2 s, played to its end (5.8-5.9 of 6 s), then the idle. Run 1
  went back to the idle at 3.22 s, right at a screenshot; not reproduced in 4 traced runs. Same signature as PR #69's
  unreproduced global stop (before this PR); `TRACE=1` logs the cause if it recurs.
- 4 PASS: face off = every face bone at rest (0°), neutral mouth; on again restores the same pose (jaw 14.5°).
- 5 **FAIL (balaclava part)**: Full Beard follows the jaw (PASS). Balaclava Cotton Black: at Unrivaled Master 3.2 s the
  lower lip shows through the knit (full-size capture). Only where Face_Surprise and Face_BlueSteel peak together (2 of
  46 Chinals clips: Unrivaled Master, World Cup backheel at 0.6); global pouts at 1.0 do not clip ([balaclava-pout.mjs](balaclava-pout.mjs)).
  The face mask holds the lips at 0.5 as the game's asset says; cause in the cage wrap or mask not investigated.
- 6 PASS: Global Coop Caper to its end with sound and face; back in Chinals the outfit is kept.
- Readiness: **not ready** (step 5) unless the owner accepts the balaclava clip as a known issue or a fix lands.
- Merge authorization: not given here.

A later patch invalidates affected checks. Keep results for the previous
revision and record the retest; do not silently carry ticks to a new build.
