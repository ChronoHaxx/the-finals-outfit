# Guided functional review — supersampled screenshots and emote video export

## What you are checking

Screenshots are drawn at 2× their size and scaled down (crisper than before). The Capture panel gains a Video tab
that renders the current emote frame by frame at 60 fps as an MP4, a transparent WebM or a transparent PNG sequence.
This catches a blurry or broken screenshot, a video that is wrong, out of sync or not transparent, and a viewer left
stuck after recording.

- PR / originating issue: the PR for branch `claude/capture-supersample-video-2026-11-21` (Shocka's list, item 5,
  `_docs/feedback-shocka-2026-11/README.md`)
- Test this revision: the PR's head commit (shown on the PR page)
- Open: the dev viewer, http://localhost:5190/?reconstructed=1, in **Chrome or Edge** on your PC
- Prerequisites: none beyond a browser; the dev server uses the live asset hosts
- Approximate hands-on time: 10 minutes
- Agent checks: see `README.md` here (unit tests, type check, build, headless-Chrome runs of every format)
- User checks: **PENDING**. Agent results do not check the boxes below.

## Get it running

Git Bash, in `E:\Coding\the-finals-outfit\.claude\worktrees\laughing-burnell-7a3aaf`:

```bash
bash _docs/capture-2026-11-21/dev.sh
```

Open http://localhost:5190/?reconstructed=1 and wait for the outfit to load (the idle animation plays). Stop the
server with Ctrl+C. Files download to your normal Downloads folder; delete them afterwards.

## Try it yourself

- [ ] **1. Screenshot:** click the camera button (top right) → **Image** tab → **Save PNG** at 2×. Open the PNG at 100%
  next to a Snipping Tool grab of the same view. Expected: the PNG is at least as crisp (laces, stitching, eyebrows),
  with no seams or lines across it. **Transparent** and **Copy** still work (paste into Discord or Paint).
- [ ] **2. MP4 with sound:** pick an emote with sound from the emote picker. Camera button → **Video** tab → **MP4**,
  1080p, Standard → **Record video**. Expected: a progress bar counts frames, the live view shows the frames going by,
  then an `.mp4` downloads. Play it: smooth 60 fps, the whole emote, the sound in time with the motion (a clap lands
  on the clap).
- [ ] **3. Transparent WebM:** same emote → **WebM, transparent** → Record. Drag the `.webm` into a new Chrome tab, or
  add it to OBS as a Media Source over something. Expected: no backdrop, the character over whatever is behind it,
  sound included.
- [ ] **4. PNG sequence:** **PNG sequence, transparent**, 720p → Record. Expected: a `.zip` with numbered PNGs, a WAV
  and a README. Import the folder as an image sequence at 60 fps in your editor (Premiere, Resolve, …), with the WAV.
  It lines up with the frames.
- [ ] **5. Cancel and close:** start a recording, close the panel (the camera button now shows a red dot and a %),
  reopen it and press **Cancel**. Expected: "Cancelled. Nothing was saved." and the emote carries on from where it was.
- [ ] **6. Afterwards, ordinary use:** after any recording, pause, scrub and play the emote, pick another, orbit the
  camera. Expected: all normal; nothing stays frozen.
- [ ] **7. Phone (optional):** on a phone on the same Wi-Fi, open `http://<your PC's IP>:5190/?reconstructed=1`, record
  an MP4 at 720p. Expected: it finishes or says plainly why it can't; the page does not crash.

If something fails, stop at that step and report its number and what happened. Reply "1-7 pass" (using the actual step
numbers), or e.g. "3 fails: the WebM has a grey background in OBS".

## Recorded result

The owner handed the steps to the agent on 22 Nov 2026: "do the checks for me, if pass, merge it". So the agent ran
them, and the boxes above stay unticked: they are the owner's. Script `user-steps.mjs`, analysis `analyse-steps.py`
(details in `README.md`, "22 Nov").

- Tested revision/build: the merge of main into this branch (057b959) plus the end-frame fix, committed as the
  commit after 057b959 on this branch. Dev viewer (`dev.sh`, production asset hosts), headless Chrome 158 on the
  RTX 3080.
- Agent run at: 22 Nov 2026, 00:34–00:38 (run `steps-0122c`, in the session scratchpad).
- Results:
  - Steps 1–6 pass.
  - Step 7 passes on an emulated phone (390×844, touch, DPR 3): a 720p MP4 of the idle, 1400 frames in 32 s.
  - The analysis passes 14 of 14 checks.
- What the agent could not do (substituted):
  - Step 2: sync was measured, not heard. The source whoosh starts 0 samples from where it should, and its
    cross-correlation lands 0.02 ms from the cue.
  - Step 3: Chrome's own `<video>` decode and ffmpeg stand in for OBS.
  - Step 4: an ffmpeg 60 fps image-sequence import stands in for Premiere/Resolve.
  - Step 7: a desktop GPU in phone emulation stands in for a real phone.
- Found and fixed during the run:
  - One-shot videos dropped their end pose (340 frames, not 341, for a 340/60 s clip). The float32 clip length fell
    under the frame rounding's 1e-6 tolerance; fixed in `framePlan`, with a unit test.
- Explicitly waived checks: none. The owner delegated the steps; see the substitutions above.
- Readiness: ready.
- Merge authorization: the owner, 22 Nov 2026, on the condition the checks pass ("if pass, merge it").
