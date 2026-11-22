# Guided functional review: transparent MOV (QuickTime Animation) in the Video tab

## What you are checking

The Capture panel's Video tab gains "MOV, transparent (lossless)": the emote as QuickTime Animation with alpha and PCM
sound, for editors. This catches a MOV that won't open, has the wrong frames, loses its transparency, or has sound out
of sync; a phone offered a file too big for it; and a viewer left stuck after recording.

- PR / originating issue: the PR for branch `claude/mov-qtrle-export-2026-11-22` (Shocka's request for a transparent MOV)
- Test this revision: the PR's head commit (shown on the PR page)
- Open: a production build at http://localhost:5196/the-finals-outfit/, in **Chrome or Edge** on a computer
- Prerequisites: ffmpeg/ffprobe on PATH for the analysis; Python with numpy and Pillow
- Approximate hands-on time: 10 minutes
- Agent checks: see "Recorded result" and `README.md`
- User checks: **waived** by the owner's standing instruction of 22 Nov 2026 (manual checks on all PRs). The agent ran
  every step below itself; the result is recorded as agent PASS, not user PASS.

## Get it running

PowerShell, in the worktree root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File _docs/mov-export-2026-11-22/build-preview.ps1
```

Open http://localhost:5196/the-finals-outfit/ and wait for the outfit to load. Stop with Ctrl+C. The agent's own run:
`node _docs/mov-export-2026-11-22/mov-steps.mjs <url> <outDir>` (Git Bash), then
`python -I _docs/mov-export-2026-11-22/analyse-mov.py <outDir>`.

## Try it yourself

- [ ] **1. Offered:** Capture → **Video**. Expected: four formats, the second "MOV, transparent (lossless)", enabled,
  with its description (QuickTime Animation, PCM sound, the editors, its size per second).
- [ ] **2. Record a MOV with sound:** play an emote with sound → **MOV**, 720p, Standard → **Record video**. Expected:
  the progress counts frames and megabytes; a `.mov` downloads; the status says "with sound". ffprobe shows qtrle
  `rle ` argb at 60 fps and PCM 16-bit 48 kHz. Record the same emote as a **PNG sequence**: every MOV frame decodes
  to exactly that PNG (alpha included), and the MOV's sound equals the zip's WAV from frame 0.
- [ ] **3. 1080p:** the same emote as MOV at 1080p. Expected: it decodes; its size per second matches the figure in
  the panel.
- [ ] **4. Remembered, and ordinary use:** reload the page, open Capture → Video. Expected: MOV is still picked. An
  emote then plays normally.
- [ ] **5. Cancel:** start a 1080p MOV, press **Cancel**. Expected: "Cancelled. Nothing was saved.", no download, and
  the viewer is not left recording.
- [ ] **6. Phone:** on a phone (or emulated touch phone), Capture → Video. Expected: MOV is shown disabled with "On a
  computer only…"; the PNG sequence is available.

## Recorded result

- Tested revision/build: commit 8e42568, a production build with deploy.yml's hosts (`build-preview.ps1`), headless
  Chrome on the RTX 3080, run `run-final`, 22 Nov 2026 about 22:50–22:53 (local time).
- **Agent PASS under the owner's standing waiver** (22 Nov 2026: "for all sessions and subsession ... where possible
  please waive manual checks, i trust u as u can do the same checks better than me"). This is not a user PASS.
  - Steps 1-6 pass: 13 of 13 UI checks and 10 of 10 file checks.
  - Every MOV frame equals its PNG, and the sound equals the WAV.
  - The numbers are in `README.md`, "Agent evidence".
- Not covered by the agent: opening the file in Premiere Pro, After Effects or Resolve. Their support rests on their
  documentation; the owner's optional check is at the end of `README.md`. Real phones, Firefox and Safari were not
  run either.
- Changes after 8e42568 are comments and docs only; no step needs repeating.
- Merge authorization: merge on pass, under the coordinator's standing rule (CI green, merge state CLEAN).
