# Guided functional review: emote sound effects

## What you are checking

Emotes play the game's own sound effects and music, in time with the animation. Pausing, scrubbing, looping and
muting must behave like a video player: nothing doubled, nothing out of step, and nothing heard before you click.

- **PR / originating issue:** the PR on branch `claude/emote-sfx-2026-11-12` (your "sounds fx and everything for
  emotes" request).
- **Test this revision:** code commit `eac6bb0` on `claude/emote-sfx-2026-11-12`, with the local sound set
  `scripts/generated/emote-sfx-2026-11-12/anim-local/sounds-1` (not uploaded yet).
- **Open:** http://127.0.0.1:5192/ from the local preview server below. Clips and props come from the live host
  `cf84e9b6`; only the sounds are local.
- **Prerequisites:** headphones or speakers, and a desktop browser (Chrome, Edge or Firefox).
- **Approximate hands-on time:** 10 minutes.
- **Agent checks:**
  - Unit tests 20/20 for the new code.
  - `npm test` 827 pass, 8 fail. The 8 are pre-existing and need game GLBs this worktree lacks.
  - `npm run build` passes.
  - Chrome 17/17 and Firefox 16/17 in the scripted browser check. Firefox's one failure is timing in headless software
    rendering; details in [README.md](README.md#verification).
- **User checks: PENDING.** Agent results do not check the boxes below.

## Get it running

**Git Bash**, in the worktree root `E:\Coding\the-finals-outfit\.claude\worktrees\reverent-cannon-ce6e39`. The agent
may already have it running: if http://127.0.0.1:5192/ opens, skip this.

```bash
node _docs/emote-sfx-2026-11-12/serve-5192.mjs --set=scripts/generated/emote-sfx-2026-11-12/anim-local --proxy=https://cf84e9b6.the-finals-outfit-assets.pages.dev/
```

The first load after a start can take over 30 seconds (Vite builds its cache). Stop it with Ctrl+C in that terminal.

## Try it yourself

- [ ] **1. Start.** Open http://127.0.0.1:5192/. Expected: the character loads and the idle plays, with no sound.
- [ ] **2. An emote with sound.** Click **Emotes**, search "Valkyria", and click **Valkyria's Embrace**. Expected:
  - the emote's sound starts with the motion and is in time with it;
  - a speaker button and a small volume slider appear left of **Pause** and **Animated**.
- [ ] **3. Pause, scrub, resume.** While it plays:
  1. click the timeline's ❚❚ (bottom bar);
  2. drag the timeline thumb;
  3. click ▶.

  Expected: silence at once on pause and while dragging, then the sound resumes from the matching point (not from its
  start), heard once.
- [ ] **4. Loop music.** Pick **CPop 04** and turn on the timeline's **Loop** (↻). Let it loop three times. Expected:
  - the music keeps going across each loop, with no restart, stutter or doubled copy;
  - then **Jester Lute** with Loop on: its tune restarts from the top each pass, in step with the strumming (that
    emote is 19 s long).
- [ ] **5. A link opened cold.** In a new tab, open http://127.0.0.1:5192/?emote=finger-crack and don't click anything
  for a few seconds. Expected:
  - the emote plays silently (browsers keep sound locked until you click);
  - click anywhere in the page: if the emote is still playing, its current sound joins from that point.
- [ ] **6. Mute is remembered.** Play any emote with sound and click the speaker. Expected: silence, and the speaker
  shows a cross. Reload the page and play an emote again: still silent. Click the speaker: sound comes back mid-emote.
  Dragging the volume slider also unmutes.
- [ ] **7. Ordinary use around it.** Play a few emotes back to back (pick a new one while another plays), close one with
  ✕, then click **Animated** to go back to the still pose. Expected:
  - the previous emote's sound stops quickly whenever you pick, close or stop;
  - nothing keeps playing in the still pose;
  - CoconutRider and Tap dance are silent, as in the game.

If something fails, stop at that step and report its number and what happened. Reply "1-7 pass" (using the actual step
numbers), or for example: "4 fails: the CPop music restarts every loop."

**After merge (live site, once the new animations host is published):** the same step 2 on a phone. An iPhone's silent
switch mutes it, which is expected.

## Recorded result

- **Tested revision/build:** pending
- **User reported at:** pending
- **Passed / failed / untested step numbers:** pending
- **Explicitly waived checks, if any:** none
- **Readiness:** pending
- **Merge authorization:** not yet given. Publishing the sounds to a new animations deployment also needs your yes.
