# Guided functional review: Chinals emote sounds

## What you are checking

The Chinals emotes play their own in-game sounds in time with the motion, and switching between Global and Chinals
never leaves a sound playing or doubles one.

- **PR / originating issue:** the PR on branch `claude/chinals-emote-sounds-2026-11-12` (Chinals sounds, built on
  PR #44 Chinals mode and PR #47 emote sounds).
- **Test this revision:** code commit `d8f6f57432a433b45debb0edc3c6b8be4803d573` on `claude/chinals-emote-sounds-2026-11-12`, with the local staged set
  `scripts/generated/chinals-sounds-2026-11-12/upload/chinals-20261113-sounds` (not uploaded yet).
- **Open:** http://127.0.0.1:5190/#/chinals from the local preview below. The global set is PR #47's local staging, so
  global emotes have sound here too.
- **Prerequisites:** headphones or speakers; desktop Chrome, Edge or Firefox.
- **Approximate hands-on time:** 10 minutes.
- **Agent checks:**
  - Unit tests 25/25 for the sound code (10 resolver, 15 player).
  - `npm test` 838 pass, 8 fail. The 8 are pre-existing and need game GLBs this worktree lacks.
  - `npm run build` passes.
  - Chrome 12/12 in the scripted browser check ([check-chrome.json](check-chrome.json)): onsets within 26 ms, both
    TakeAway layers together, Floating Greeting stops at its window end, silent Gacha_01, one audio device after three
    mode round trips, no console errors. Details in [README.md](README.md#verification).
  - Not run: Firefox, Safari, phones, a listen against in-game footage.
- **User checks: PENDING.** Agent results do not check the boxes below.

## Get it running

The agent may have it running already: if http://127.0.0.1:5190/ opens, skip this. Otherwise, **Git Bash**, in the
worktree root `E:\Coding\the-finals-outfit\.claude\worktrees\quirky-boyd-472a78`:

```bash
MSYS_NO_PATHCONV=1 VITE_CHINALS_ANIMATIONS_BASE=/chinals-animations/ node _docs/chinals-mode-2026-11-12/serve-preview.mjs --set=../reverent-cannon-ce6e39/scripts/generated/emote-sfx-2026-11-12/upload/anim-20261112c --chinals=scripts/generated/chinals-sounds-2026-11-12/upload/chinals-20261113-sounds --port=5190
```

The first load can take over 30 seconds. Stop it with Ctrl+C in that terminal.

## Try it yourself

- [ ] **1. Start.** Open http://127.0.0.1:5190/#/chinals and click through the intro. Expected: the Chinals banner
  shows, the character idles, and nothing is heard.
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

- Tested revision/build: pending
- User reported at: pending
- Passed / failed / untested step numbers: pending
- Explicitly waived checks, if any: none
- Readiness: pending
- Merge authorization: not yet given
