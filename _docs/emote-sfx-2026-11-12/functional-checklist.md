# Guided functional review: emote sound effects

## What you are checking

Emotes play the game's own sound effects and music, in time with the animation. Pausing, scrubbing, looping and
muting must behave like a video player: nothing doubled, nothing out of step, and nothing heard before you click.

- **PR / originating issue:** the PR on branch `claude/emote-sfx-2026-11-12` (your "sounds fx and everything for
  emotes" request).
- **Test this revision:** the head of `claude/emote-sfx-2026-11-12`, rebased onto main `64f68d3` (facial animation,
  PR #48). The sound code is `43470ec`.
- **Open:** http://127.0.0.1:5192/, the dev preview of this branch. It serves the staged faces + sounds set
  (`upload/anim-20261112d`), the exact files the next upload would publish.
  - Once that set is published and the host bumped, the production build will serve at
    http://127.0.0.1:5197/the-finals-outfit/.
  - The earlier `ab913ac8` host lacks the faces and is retired: don't test against it.
- **Prerequisites:** headphones or speakers, and a desktop browser (Chrome, Edge or Firefox).
- **Approximate hands-on time:** 10 minutes.
- **Agent checks after the rebase (12 Nov 2026, staged superset on 5192):**
  - Chrome 17/17 ([check-chrome-superset-local.json](check-chrome-superset-local.json)).
  - Faces 2/2 posed and wrapped ([check-faces-superset-local.json](check-faces-superset-local.json)).
  - The type check passes.
  - 47/47 focused tests pass: sounds, cues, animator, transport and faces.
  - `npm test` 835 pass, 8 fail. The 8 are pre-existing and need game GLBs this worktree lacks.
- **Before the rebase:** production build against `ab913ac8` Chrome 17/17; Firefox 16/17 (timing in headless software
  rendering). Details are in [README.md](README.md#verification).
- **User checks: PENDING.** Agent results do not check the boxes below.

## Get it running

**Git Bash**, in the worktree root `E:\Coding\the-finals-outfit\.claude\worktrees\reverent-cannon-ce6e39`. The agent
may already have it running: if http://127.0.0.1:5192/ opens, skip this.

```bash
node _docs/emote-sfx-2026-11-12/serve-5192.mjs --set=scripts/generated/emote-sfx-2026-11-12/upload/anim-20261112d
```

The first load after a start can take over 30 seconds (Vite builds its cache). Stop it with Ctrl+C in that terminal.

## Try it yourself

- [ ] **1. Start.** Open http://127.0.0.1:5192/. Expected: the character loads and the idle plays, with no sound.
- [ ] **2. An emote with sound.** Click **Emotes**, search "Valkyria", and click **Valkyria's Embrace**. Expected:
  - the emote's sound starts with the motion and is in time with it;
  - a speaker button and a small volume slider appear left of **Pause** and **Animated**;
  - the face still moves with the emote (facial animation from PR #48).
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

**After merge (live site):** the same step 2 on a phone. An iPhone's silent
switch mutes it, which is expected.

## Recorded result

- **Tested revision/build:** pending
- **User reported at:** pending
- **Passed / failed / untested step numbers:** pending
- **Explicitly waived checks, if any:** none
- **Readiness:** pending
- **Merge authorization:** not yet given.
- **Publishing:**
  - "Yes, upload it" (12 Nov 2026) covered `ab913ac8`, which is now retired because it lacks the faces.
  - The faces + sounds superset needs its own yes.
