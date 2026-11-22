# Guided functional review — Chinals emote faces

## What you are checking

In Chinals mode the face now moves during the Chinals emotes and idle, as in global emotes, from the new Chinals host
7c9add72; this catches a face that stays still, a missing sound or prop, or wrong wording.

- PR: https://github.com/ChronoHaxx/the-finals-outfit/pull/71 (Shocka feedback item 8)
- Test this revision: branch `claude/chinals-faces-2026-11-21`, app code at 4c88f9d (the face contact, with main
  49b2cb6 merged in; later commits are docs only). The build below is that code with deploy.yml's production settings
  and the new Chinals host.
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

### First agent run (app code ee16736)

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

### Retest after the face contact (app code fdfc3dd)

The owner chose "Fix it first" (22 Nov). The fix is the face contact (README.md, "Balaclava lip clip"); main's 12 Nov
release (#67) had been merged in before it (6ff5372).
- Tested build: production build of app code fdfc3dd, built by `prod-check.mjs` with deploy.yml's hosts as they now are
  (assets 2cbead71, models a029b249, reconstruction a70ffa7f, animations fd946744, Chinals 7c9add72);
  [user-steps.mjs](user-steps.mjs) as a visitor (automation masked), 22 Nov ~12:35 UTC, one run. Steps 1-6 rerun, as
  the contact changes the face's motion code and #67 changed much of the app.
- `prod-check.mjs`: ok, no failed request, no page error. Its first run here logged "Skin pair requires its preserved
  fitted body": the script still built with the hosts from before #67 (reconstruction c062af24). It now reads them from
  deploy.yml.
- 1 PASS: Chinals banner and idle; upper eyelids reach 29° (a blink).
- 2 PASS: banner and footer wording exactly as above.
- 3 PASS: sound (WeaponMaster sound file loaded, audio running), props (3 files), surprise face (jaw 14.5°), played to
  5.84 of 6 s, then the Chinals idle.
- 4 PASS: face off = every face bone at rest (0°); on again restores the same pose (jaw 14.5°).
- 5 PASS: Full Beard follows the jaw (wrapped, jaw 14.5°). Balaclava Cotton Black at 3.2 s: the face mask halves the
  face (jaw 7.3°), and the full-size crop of the mouth shows closed knit, where the first run showed the lip.
- 6 PASS: global Fox Chicken to its end (7.6 of 7.67 s) with its sound and a moving face (eyelids 39°); back in
  Chinals the outfit is kept (beard and balaclava).
- Readiness: agent checks PASS on fdfc3dd under the relayed waiver. The boxes above stay unticked.
- Merge authorization: not given here.

### Repeated after merging main 49b2cb6 (app code 4c88f9d)

Main moved on while the fix was made (#43 mesh gate, #57 scene backdrops, #61 light markers, #72 patch notes, #73 site
health); merged in as 4c88f9d. The conflicts were deploy.yml (the Chinals host 7c9add72 kept beside main's new
SCENES_BASE), the patch notes (all three 22 Nov notes kept, this one on top) and the roadmap's review line.
- Tested build: production build of 4c88f9d by `prod-check.mjs`, now with `VITE_SCENES_BASE` too (1d367244);
  [user-steps.mjs](user-steps.mjs) as a visitor, 22 Nov ~12:47 UTC, one run. `prod-check.mjs` ok: no failed request, no
  page error; Unrivaled Master played to 5.94 s with audio, then the idle.
- 1 PASS (eyelids 36.9°). 2 PASS (wording exact). 3 PASS (played to 5.89 of 6 s with audio, 3 prop files, jaw 14.5°,
  then the idle). 4 PASS (off 0°, on again jaw 14.5°). 5 PASS (beard jaw 14.5°; balaclava masked, jaw 7.3°, and the
  full-size mouth crop shows closed knit). 6 PASS (Fox Chicken to 7.54 of 7.67 s with audio; outfit kept).
- `npm test` 1013 pass, the 8 known fixture failures (game files the worktree lacks), 6 skipped; `npx tsc --noEmit`
  clean; `npm run build` passes, its roadmap and public-text checks included.
- Readiness: agent checks PASS on 4c88f9d under the relayed waiver. The boxes above stay unticked.
- Merge authorization: not given here.

A later patch invalidates affected checks. Keep results for the previous
revision and record the retest; do not silently carry ticks to a new build.
