# Guided functional review: takes (record what you do, then render it)

## What you are checking

Capture, then Video, then Take records what you do in the viewer and renders it later at 60 fps. This catches:
- a recording state that is unclear, or cannot be stopped;
- a take that loses what was done: the camera, emotes, the timeline, the lights, the sound;
- a slow machine's stutter reaching the video;
- a take lost to a closed tab, a reload, a render, the cap or a stray click;
- a viewer left changed after a render.

- PR / originating issue: the PR for branch `claude/video-takes-2026-11-22` (the owner's ask, relayed 22 Nov)
- Test this revision: the PR's head commit (shown on the PR page)
- Open: a production build at http://localhost:5196/the-finals-outfit/, in **Chrome or Edge** on a computer
- Prerequisites: ffmpeg on PATH for the analysis; Python with numpy and Pillow
- Approximate hands-on time: 15 minutes
- Agent checks: see "Recorded result" and `README.md`
- User checks: **waived** by the owner's standing instruction of 22 Nov 2026 (manual checks on all PRs). The agent ran
  every step below itself; the result is recorded as agent PASS, not user PASS.

## Get it running

PowerShell, in the worktree root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File _docs/mov-export-2026-11-22/build-preview.ps1
```

Open http://localhost:5196/the-finals-outfit/ and wait for the outfit to load. Stop the server with Ctrl+C. The
agent's own run uses Git Bash: `node _docs/video-takes-2026-11-22/takes-steps.mjs <url> <outDir>`, then
`python -I _docs/video-takes-2026-11-22/analyse-takes.py <outDir>`.

## Try it yourself

- [ ] **1. Record:** Capture → Video → **Take** → **Record a take**.
  - Expected: the panel closes; the Capture button shows a pulsing dot, REC and a running time, with a red **Stop**
    beside it.
  - Orbit the camera, play **Applause Pause**, pause it and step the timeline a few frames, press Play, pick the
    **Lobby** look in Lighting, orbit back. Press **Stop**.
  - Expected: the panel opens with "Take 1" and its length.
- [ ] **2. Render:** Take 1 → **Render** as a PNG sequence, then as MOV, at 480p Draft.
  - Expected: both download, and the status names the file.
  - The video shows the orbit, the clap (heard where it was played), the frames you stepped through, and the change to
    Lobby where you made it. The PNG and MOV frames are identical.
  - The take stays in the list, marked rendered.
  - The viewer is as you left it: your emote or idle, your own look.
- [ ] **3. A slow machine:** record a take while the computer is slow (in DevTools, Performance, CPU 20× slowdown) and
  orbit steadily; render it. Expected: the video moves evenly at 60 fps, with no repeated frames.
- [ ] **4. A closed tab:** start a take, orbit for 2–3 s, then close the tab (or end its process) without stopping.
  Open the site again. Expected: the take is listed as "interrupted, saved so far", about as long as you recorded,
  and it renders.
- [ ] **5. Discard:** **Discard…** on a take. Expected: it asks (Discard or Keep); Keep keeps it; Discard removes it,
  still gone after a reload.
- [ ] **6. Hidden tab:** start a take, switch to another browser tab, come back. Expected: the take stopped when you
  left ("Stopped: the tab was hidden"), saved.
- [ ] **7. The cap:** with 10 takes none of which has been rendered, **Record a take**. Expected: refused, "10 takes
  are waiting to be rendered…", all ten kept. Render one, then record: expected "Made room: Take N (already rendered)
  was removed", still ten takes.
- [ ] **8. Ordinary use:** **Emote** shows the emote export as before (range, Loops, Record video).
- [ ] **9. Phone:** on a phone (or emulated touch phone), record a short take. Expected: the Capture button gives way
  to a red Stop showing the time (■ 0:03); Full screen, Hide UI and Graphics stay on screen. Stop lists the take.

## Recorded result

- **Agent: PASS**, all nine steps, under the owner's standing waiver of manual checks (22 Nov 2026).
  - Run `takes-final5`, 23 Nov 2026 09:38–09:42, on source 71aa32d (main 8333137 merged in), a production build.
  - 16 of 16 step checks and 9 of 9 file checks pass. Numbers are in `README.md`, Agent evidence.
- The steps were driven in headless Chrome on the GPU (desktop 1280 × 800; phone 390 × 844 touch). The slowed machine
  is DevTools CPU throttling at 20×, and the crash is CDP's `Page.crash`.
- **User: not run** (waived). No user PASS is claimed.
