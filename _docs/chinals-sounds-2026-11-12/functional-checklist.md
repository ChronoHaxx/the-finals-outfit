# Guided functional review: Chinals emote sounds

## What you are checking

The Chinals emotes play their own in-game sounds in time with the motion, and switching between Global and Chinals
never leaves a sound playing or doubles one.

- **PR / originating issue:** PR #51 on branch `claude/chinals-emote-sounds-2026-11-12`. Against main it changes only
  this record, the patch note and the roadmap (review line and the sound sentence): the sound code came to main with
  PR #47, and since PR #71 (22 Nov) main serves Chinals host 7c9add72, a superset of this PR's 59209741 (props-3,
  sounds-1, plus faces-1), so this PR no longer changes the host line.
- **Test this revision:** `67985ce` on `claude/chinals-emote-sounds-2026-11-12` (or any later docs-only commit), with
  both published hosts: Chinals `https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/` (live since PR #71) and
  global `https://fd946744.the-finals-outfit-assets.pages.dev/` (live since PR #62, all 295 emotes).
- **Open:** http://127.0.0.1:5192/#/chinals from the local preview below.
- **Prerequisites:** headphones or speakers; desktop Chrome, Edge or Firefox.
- **Approximate hands-on time:** 10 minutes.
- **Agent checks:**
  - Unit tests 25/25 for the sound code (10 resolver, 15 player).
  - `npm test` 992 pass, 8 fail, 6 skipped at c7956a2. The 8 are pre-existing and need game GLBs this worktree lacks.
  - `npm run build` passes, with its roadmap and public-text checks.
  - Chrome 12/12 in the scripted browser check, both on the local set ([check-chrome.json](check-chrome.json)) and with
    the app reading the published host ([check-chrome-hosted.json](check-chrome-hosted.json), last run at 1b5a50e):
    onsets within 26 ms, both TakeAway layers together, Floating Greeting stops at its window end, silent Gacha_01, one
    audio device after three mode round trips, no console errors. Details in [README.md](README.md#verification).
  - Not rerun since 1b5a50e: the run after merging PR #47 was stopped. The app's sound code is now main's, which is
    this branch's code plus #47's prop prewarm and PR #58's emote speed (sounds follow the scaled clock). On 17 Nov
    the preview below served both live sets and its intro showed the new patch note.
  - Not run: Firefox, Safari, phones, a listen against in-game footage.
- **User checks: PENDING.** Agent results do not check the boxes below.

## Get it running

The agent may have it running already: if http://127.0.0.1:5192/ opens, skip this. Otherwise, **Git Bash**, in the
worktree root `E:\Coding\the-finals-outfit\.claude\worktrees\quirky-boyd-472a78`:

```bash
mkdir -p scripts/generated/chinals-sounds-2026-11-12/empty-set
```

```bash
VITE_CHINALS_ANIMATIONS_BASE=https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/ node _docs/chinals-mode-2026-11-12/serve-preview.mjs --set=scripts/generated/chinals-sounds-2026-11-12/empty-set --proxy=https://fd946744.the-finals-outfit-assets.pages.dev/ --port=5192
```

The empty folder plus `--proxy` serves the live global set. The first load can take over 30 seconds. Stop it with
Ctrl+C in that terminal.

## Try it yourself

- [ ] **1. Start.** Open http://127.0.0.1:5192/#/chinals. Expected: the intro's newest patch note is "Chinals emote
  sounds". Click through it: the Chinals banner shows, the character idles, and nothing is heard.
- [ ] **2. A Chinals emote with sound.** Click **Emotes**, search "Ovation", click it. Expected: applause starts with
  the clapping and stays in time; a speaker button appears left of **Pause**.
- [ ] **3. Two sounds at once.** Search "Drink Up", click **Drink Up, Brother!**. Expected: you hear the foley (glass,
  pouring) and a background ambience together from the start, and the previous emote's sound stops at once.
- [ ] **4. The synced music, to the end.** Search "Floating Greeting", click **悬浮问候**, and let it play out (10 s).
  Expected: the music starts with the emote and fades out over about a second just before the motion ends.
- [ ] **5. A silent one.** Search "Gacha", click **Gacha_01**. Expected: no sound and no speaker button (the game has
  none for it).
- [ ] **6. Switch modes.** During **Ovation**, click **Global** at the top, play **Valkyria's Embrace**, then click
  **终极角逐 Chinals** and play **Ovation** again. Expected: each switch silences the old emote at once; each emote
  plays its own sound once, never doubled; no sound keeps going after a switch.
- [ ] **7. Mute survives a reload.** In Chinals mode, play **Ovation** and click the speaker button to mute; reload
  the page and play it again. Expected: still muted, silent; clicking the speaker again brings the sound back mid-clap.

If something fails, stop at that step and report its number and what happened. Reply "1-7 pass", or e.g. "4 fails:
the music cuts off without a fade".

## Recorded result

- Waiver: manual user checks waived on every PR, relayed by the coordinator session on 22 Nov (not seen first-hand
  here): the owner, 22 Nov 00:08, "i trust u as u can do the same checks better than me". The boxes stay unticked; the
  agent ran steps 1-7 in their place.
- Tested revision/build: production build of 67985ce (main abfa045, with PR #71, merged in) with deploy.yml's hosts
  (assets 2cbead71, models a029b249, reconstruction a70ffa7f, animations fd946744, Chinals 7c9add72, scenes 1d367244),
  built by `_docs/chinals-faces-2026-11-21/prod-check.mjs` (its Chinals smoke check: ok, no failed request, no page
  error) and served by `vite preview` at /the-finals-outfit/. [check-chinals-sounds.mjs](check-chinals-sounds.mjs)
  as a visitor (automation masked), headless Chrome, 22 Nov ~13:35 UTC: 14/14 PASS, [check-chrome-prod.json](check-chrome-prod.json).
  The script now also checks steps 1 and 7, and takes `--global=<host>` for a production build.
- 1 PASS: the intro's latest patch note is "Chinals emote sounds" (above "Faces in Chinals emotes").
- 2 PASS: Ovation, one voice within 0.7 ms of its cue.
- 3 PASS: Drink Up, Brother!, both TakeAway layers start together at the clip start (within 4 ms).
- 4 PASS: Floating Greeting, one voice at its cue, stopped near its window end (10.21 s); no restarts.
- 5 PASS: Gacha_01, no Sound button and no voice.
- 6 PASS: three Global <-> Chinals round trips (Valkyria's Embrace from fd946744 sounds-2, Ovation from 7c9add72
  sounds-1): each mode played its own sound; at most one audio device open (made - closed = 1).
- 7 PASS: muted during Ovation, still muted after a reload with no voice started; the speaker button unmuted it and
  Ovation's sound started mid-clap.
- Also: decoded AAC lengths within 2 ms of the source; no console errors or audio warnings. `npm test` 1031 pass, the
  8 known fixture failures (game files this worktree lacks), 6 skipped; tsc clean; `npm run build` passes.
- Not covered by the agent: hearing the sound (the script measures voice timing, not what a person hears); Firefox,
  Safari, phones.
- Readiness: agent checks PASS on 67985ce under the relayed waiver.
- Merge authorization: not given in this session; the coordinator merges on the owner's instruction to it.
