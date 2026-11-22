# Guided functional review: video range (part of an emote, looped, at the emote speed)

## What you are checking

A video can record part of an emote. Set the part with markers on the timeline, the I and O keys, or typed times in
the Video tab. It can repeat the part, and it plays at the emote speed. This catches:
- a range that records the wrong frames or the wrong number of them
- sound that drifts from the picture
- a looped or slowed pass that starts on the wrong pose
- a range that is lost on reload or leaks to another emote
- markers that get in the way of scrubbing
- a phone timeline left without room to scrub

- PR / originating issue: the PR for branch `claude/video-range-export-2026-11-22` (the owner's ask, relayed 22 Nov)
- Test this revision: the PR's head commit (shown on the PR page)
- Open: a production build at http://localhost:5196/the-finals-outfit/, in **Chrome or Edge** on a computer
- Prerequisites: ffmpeg on PATH for the analysis; Python with numpy and Pillow
- Approximate hands-on time: 10 minutes
- Agent checks: see "Recorded result" and `README.md`
- User checks: **waived** by the owner's standing instruction of 22 Nov 2026 (manual checks on all PRs). The agent ran
  every step below itself; the result is recorded as agent PASS, not user PASS.

## Get it running

PowerShell, in the worktree root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File _docs/mov-export-2026-11-22/build-preview.ps1
```

Open http://localhost:5196/the-finals-outfit/ and wait for the outfit to load. Stop the server with Ctrl+C. The
agent's own run uses Git Bash: `node _docs/video-range-2026-11-22/range-steps.mjs <url> <outDir>`, then
`python -I _docs/video-range-2026-11-22/analyse-range.py <outDir>`.

## Try it yourself

Use an emote with sound, such as **Applause Pause**.

- [ ] **1. Markers and keys:** play the emote and press the timeline's **Video range** button (the bracket icon).
  Expected: two red markers above the track, the button lit. Pause at 0.40 s, press **I**; at 2.00 s, press **O**.
  Expected: the markers move there and Capture → Video shows 0.40 and 2.00.
- [ ] **2. Drag, type, Whole:** drag the end marker right. Expected: the end follows, snapped to frames, and the Video
  tab's end changes. Type 2 in "Video end" and press Enter. Expected: the marker goes back. Press **Whole**.
  Expected: 0.00 to the emote's length, the markers gone, the summary back to the whole emote's frames.
- [ ] **3. Record:** as a **PNG sequence**, 480p Draft:
  - [ ] the whole emote. Expected: 261 frames.
  - [ ] the range 0.40–2.00 s. Expected: 97 frames, the sound 0.40 s earlier than in the whole emote's.
  - [ ] the range with Loops 2 and the emote speed at 0.5x. Expected: 385 frames. The summary says "2 times, at 0.5x
    speed". The second pass starts on the range's first pose, and its sound lands at the same point in each pass.
  - [ ] the range as a **MOV**. Expected: the same frames and sound as the PNG sequence.
  - [ ] Afterwards: the emote plays normally.
- [ ] **4. Kept per emote:** reload. Expected: the emote's range is still set. Play another emote. Expected: it is
  whole. Go back. Expected: the first emote's range is back.
- [ ] **5. Ordinary use:** with the markers on, click the track under the range. Expected: the playhead moves. Type
  "I" into a text field. Expected: it types; the range doesn't move. Pause and Play work.
- [ ] **6. Phone:** on a phone (or emulated touch phone), play the emote.
  - Expected: the timeline has main's controls and no Video range button or markers, and the track fills the row.
  - In Capture → Video, type 1 and 2.5. Expected: the summary says "Clip 1.00–2.50 s".

## Recorded result

- Tested revision/build: commit 91dd26d, a production build with deploy.yml's hosts (`build-preview.ps1`), headless
  Chrome on the RTX 3080, run `range-final3`, 22 Nov 2026 about 23:22–23:25 (local time).
- **Agent PASS under the owner's standing waiver** (22 Nov 2026: "for all sessions and subsession ... where possible
  please waive manual checks, i trust u as u can do the same checks better than me"). This is not a user PASS.
  - UI checks: 17 of 17 across steps 1-6, no page errors. File checks: 10 of 10.
  - The numbers are in `README.md`, "Agent evidence".
- Not covered by the agent: real phones (step 6 uses Chrome's touch-phone emulation), Firefox, Safari.
- Merge authorization: merge on pass, under the coordinator's standing rule (CI green, merge state CLEAN).
