# Guided functional review: emote sound effects

## What you are checking

Emotes play the game's own sound effects and music, in time with the animation. Pausing, scrubbing, looping and
muting must behave like a video player: nothing doubled, nothing out of step, and nothing heard before you click.

- **PR / originating issue:** the PR on branch `claude/emote-sfx-2026-11-12` (your "sounds fx and everything for
  emotes" request).
- **Test this revision:** the head of `claude/emote-sfx-2026-11-12`, rebased onto main `76d4e9e`. It includes the
  prop prewarm and PR #51's global sound fixes (15 Nov), with the host `17ec92c3`.
- **Open:** http://127.0.0.1:5197/the-finals-outfit/, the production build of this branch. It loads clips, props,
  faces and sounds from the published host `17ec92c3`, as the live site will after merge.
  - The earlier `ab913ac8` host lacks the faces and is retired: don't test against it.
- **Prerequisites:** headphones or speakers, and a desktop browser (Chrome, Edge or Firefox).
- **Approximate hands-on time:** 10 minutes.
- **Agent checks (15 Nov 2026, the merge candidate: production build against `17ec92c3`):**
  - Chrome 17/17 ([check-chrome-prod-17ec92c3.json](check-chrome-prod-17ec92c3.json)).
  - Faces 2/2 posed and wrapped ([check-faces-prod-17ec92c3.json](check-faces-prod-17ec92c3.json)).
  - Global ↔ Chinals switches: 1 open audio context after 3 round trips
    ([check-mode-switch.json](check-mode-switch.json)).
  - The type check and the production build (with its public-text checks) pass.
  - 65/65 focused tests pass: props, sounds, cues, animator, transport and faces.
  - `npm test` 896 pass, 8 fail. The 8 are pre-existing and need game GLBs this worktree lacks.
- **12 Nov, dev preview of the staged set:** Chrome 17/17 and faces 2/2.
- **Before the rebase:** production build against `ab913ac8` Chrome 17/17; Firefox 16/17 (timing in headless software
  rendering). Details are in [README.md](README.md#verification).
- **User checks: PENDING.** Agent results do not check the boxes below.

## Get it running

**Git Bash**, in the worktree root `E:\Coding\the-finals-outfit\.claude\worktrees\reverent-cannon-ce6e39`. The agent
may already have it running: if http://127.0.0.1:5197/the-finals-outfit/ opens, skip this.

```bash
MSYS_NO_PATHCONV=1 npx vite preview --outDir "$(pwd -W)/scripts/generated/emote-sfx-2026-11-12/prod-dist" --base /the-finals-outfit/ --port 5197 --strictPort --host 127.0.0.1
```

That serves the production build the agent made (deploy.yml's hosts). If `prod-dist` is missing, the dev preview
serves the same files from the staged set at http://127.0.0.1:5192/:

```bash
node _docs/emote-sfx-2026-11-12/serve-5192.mjs --set=scripts/generated/emote-sfx-2026-11-12/upload/anim-20261112d
```

The first load after a start can take over 30 seconds (Vite builds its cache). Stop it with Ctrl+C in that terminal.

## Try it yourself

- [ ] **1. Start.** Open http://127.0.0.1:5197/the-finals-outfit/. Expected: the character loads and the idle plays, with no sound.
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
- [ ] **5. A link opened cold.** In a new tab, open http://127.0.0.1:5197/the-finals-outfit/?emote=finger-crack and don't click anything
  for a few seconds. Expected:
  - the emote plays silently (browsers keep sound locked until you click);
  - click anywhere in the page: if the emote is still playing, its current sound joins from that point.
- [ ] **6. Mute is remembered.** Play any emote with sound and click the speaker. Expected: silence, and the speaker
  shows a cross. Reload the page and play an emote again: still silent. Click the speaker: sound comes back mid-emote.
  Dragging the volume slider also unmutes.
- [ ] **7. Ordinary use around it.** Play a few emotes back to back (pick a new one while another plays), close one with
  ✕, then click **Animated** to go back to the still pose. Then, while an emote with sound plays, switch to
  **Chinals** (the Global | Chinals switch) and back to **Global**, and play an emote again. Expected:
  - the previous emote's sound stops quickly whenever you pick, close, stop or switch;
  - nothing keeps playing in the still pose;
  - CoconutRider and Tap dance are silent, as in the game;
  - after switching back, emotes have sound again.
- [ ] **8. Props appear smoothly (the 15 Nov prewarm).** Open http://127.0.0.1:5197/the-finals-outfit/ in a new tab and
  click anywhere once. As the first emote of that tab, play **BlackSmith**. Expected:
  - the anvil and the log appear without a hitch or freeze in the motion;
  - the first clang lands with the hammer, not before it.

If something fails, stop at that step and report its number and what happened. Reply "1-8 pass" (using the actual step
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
  - "Yes, upload it" (13 Nov 2026) covered the faces + sounds host `e4608dac`, since superseded.
  - "Yes, upload it" (15 Nov 2026) covered `17ec92c3` (the corrected gains), which this PR ships.
