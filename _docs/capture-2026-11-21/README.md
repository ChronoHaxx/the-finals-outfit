# Capture: supersampled screenshots and emote video (21 Nov 2026)

Shocka's list, item 5 (`_docs/feedback-shocka-2026-11/README.md`). Branch `claude/capture-supersample-video-2026-11-21`
off main 0951e1b. User checks: `functional-checklist.md`.

## What changed

- **Screenshots supersample.** `ViewCapture` (src/rig/ViewerScreenshot.ts) renders 2× the chosen size in tiles
  (`PerspectiveCamera.setViewOffset`, at most 2048 px a side, 1024 on phones), so GPU memory is bounded by the tile.
  Each tile accumulates 16 jittered samples per fine pixel (64 per output pixel). A resolve pass then composites each
  fine pixel over the backdrop exactly as the browser does, decodes to linear light, averages and re-encodes.
  Transparent mode averages colour weighted by coverage and keeps straight alpha. Rows come out top-down, so there
  is no CPU flip and no CPU backdrop composite. Copy to clipboard (#54) is unchanged.
- **Hologram screen position across tiles.** The recovered hologram's view rectangle uses the whole image when the
  camera draws a tile (`updateHologramView`).
- **Video tab** (src/components/VideoCapture.tsx, src/rig/VideoExport.ts). It records the clip in front (an emote, or
  one loop of the idle) at 60 fps:
  - **Deterministic frames.** `RigAnimator.beginRecording/recordFrame/endRecording` take over the clock. Each frame is
    posed at frame/60 s and the sway springs step exactly 1/60 s, after a 1.5 s settle from rest on frame 0. The
    viewer's own clock, transport and camera turns are ignored meanwhile. Afterwards the clip goes back to the time it
    was at, paused or playing as before.
  - **Frame loop.** One frame per animation frame (`CaptureDriver`, CharacterViewer.tsx). It is drawn after the contact
    shadow follows the new pose and before the live view draws; the next pose is set after. At most 3 frames are in
    flight.
  - **MP4:** H.264 (WebCodecs) on the backdrop, plus AAC sound (Opus where AAC can't be encoded). Own muxer
    (src/lib/mp4-mux.ts): fast start, colr from the encoder's colour space, edit lists for reordering and audio delay.
  - **WebM, transparent:** WebCodecs' `alpha: "keep"` is **not implemented in Chrome** (158: unsupported for VP8, VP9
    and AV1, headed and headless). So it uses two VP9 encoders, colour and an alpha stream whose luma is the alpha,
    muxed as Matroska BlockAdditions (src/lib/webm-mux.ts), as libvpx does. Colour is bled under transparent pixels
    first, against dark fringes. Opus sound.
  - **PNG sequence:** a stored zip (src/lib/zip-store.ts) of straight-alpha PNGs, a 16-bit WAV and a README.
  - **Sound:** `EmoteSounds.renderOffline` renders the cues offline by the playback rules, at game gains, with seeded
    picks. The whole track is scaled down only if it would clip.
  - **Guards:** progress, Cancel, and the panel can close while it records (the button shows %). Phones are capped at
    1080p, smaller tiles and a 400 MB file (2 GB on desktop). The emote changing mid-recording stops it with a message.
  - **No MOV/ProRes:** no browser encodes it. The UI says so and points editors at the PNG sequence.
- Not touched: `src/data/changelog.ts` and `ROADMAP.md` (catch-up PR #53 owns them; a suggested note is in the PR).

## Agent evidence (21 Nov 2026)

Renders of game assets stay out of git (session scratchpad). Dev server: `dev.sh` (production asset hosts).
Harness: `capture-test.mjs` (headless Chrome 158 with the RTX 3080, webdriver flag hidden so sounds load).

- Unit tests `tests/video-export.test.ts` (13): frame plan, sizes, tiles, the MP4/WebM/zip read back by parsers
  written from the specs, CRC against zlib, WAV, recording clock, offline sound schedule, WebM helpers.
- Screenshot at 2× a 736×744 stage (1472×1488): old settings (1×, 32 samples) 408 ms, new 2×16 563 ms, 4×8 592 ms.
  Looked at full size: 2× is clearly crisper (sole stitching, laces, eyebrows, skin), with no seams. UI Save, Transparent
  and Copy all PASS (Copy: a 606 KB PNG read back from the clipboard).
- "Wave" (4.667 s, one sound cue), 280 frames each:
  - MP4 Draft 720p (712×720): 22 s, 3.3 MB, H.264 High, 280 frames, AAC 48 kHz. Frames 0/140/279 looked at; the
    contact shadow follows the feet. Sound: the source's first sound at sample 44,959; ffmpeg decodes the MP4's at
    44,956. Chrome's AAC encoder adds no priming offset, so no edit list was written. Backdrop colour within about 1
    level of the PNG in Chrome and ffmpeg.
  - WebM Draft 720p: 25.5 s, 2 MB, VP9 + Opus, alpha_mode 1. ffmpeg (libvpx) and Chrome's own `<video>` both decode
    the alpha, with the same histogram at frame 140 (429,697 transparent, 64,200 opaque, 18,743 soft). Over magenta,
    zoomed edges show no dark fringe.
  - PNG sequence Draft 480p, exported twice: 20–22 s, 18 MB each. Python's `zipfile.testzip` finds no errors. **0 of
    280 frames differ** between the two exports (deterministic). WAV 224,000 samples = the frames' length. Frame 140
    over a checkerboard looked at.
  - MP4 Standard 1080p (1068×1080): 34.6 s, 6 MB, H.264 level 4.2.
  - The viewer gets its clock back after every run.
- Phone (390×844, touch): the Video tab first ran past the stage under the items sheet, so Record was out of reach.
  Fixed: the panel is capped at the viewer's height and scrolls inside it (as the Lighting panel does). Phone sizes
  offered: 480p, 720p, 1080p.
- `npm test`: 923 tests, 910 pass, 8 fail, 5 skipped. The 8 are the usual worktree fixture failures (no
  `public/models/*.glb`). `tsc -b` clean; `npm run build` passes.
- Not run: real phones, Firefox and Safari (WebCodecs support differs; the UI disables what a browser can't encode);
  importing the PNG sequence into an editor; OBS.
- Dev setup note: the root checkout's `node_modules` lacks `@fontsource-variable/saira`, so this worktree's
  `node_modules` junction points at `scripts/generated/release-2026-11-12/node_modules`, as other worktrees do.

## 22 Nov 2026: merge of main, the checklist run by the agent

The owner asked the agent to run the checklist and merge if it passed. Main had moved six PRs. Two of them touch the
same code as this branch:
- #58 keeps the emote speed as the emote action's own time scale.
- #69 adds `playUnder`.

**Merge (057b959).**
- No textual conflicts.
- Recording only switches the mixer's pause and never sets the action's own time scale. `endRecording()` seeks back,
  and `seek()` restores that scale, so a 2× emote stays at 2× afterwards. Step 6 checks this.
- Videos always record at normal speed (clip time = frame/60), whatever the speed control says.
- `dev.sh` now uses the current animations host (fd946744).
- `tsc -b` is clean and `npm run build` passes.
- `npm test`: 972 tests, 959 pass, 8 fail (the usual worktree GLB fixtures), 5 skipped.

**Fix found by the run.** A one-shot video dropped its end pose. The clip length is float32 in three: 340/60 s reads
5.6666665 s, which is 339.99999 frames, and the 1e-6 tolerance floored that to 340 frames instead of 341.
`framePlan` now allows 1e-3 frames, and a unit test covers it.

**Run `steps-0122c`** (`user-steps.mjs`, then `analyse-steps.py`). Emote: "Bring The Action", 5.667 s, one whoosh
cue at 1.304 s.
1. Screenshot.
   - 1× and 2× PNGs save in 427 and 552 ms. Transparent and Copy work (1.9 MB PNG read back from the clipboard).
   - The 1× PNG beside a screen grab of the same paused view, both at 3×: the same detail, with smoother edges on
     the head outline, soles and laces. The 2× PNG is clearly crisper.
   - A 1:1 crop where the 2×'s tiles meet shows no seam.
2. MP4, 1080p Standard.
   - 1068×1080 H.264 High, 60 fps, 341 frames, AAC. 9.7 s to make, 8.7 MB.
   - The progress counted frames, and the live view moved.
   - Sync: the source whoosh (fetched from the live sound host) starts 98.23 ms into its file at the same gain and
     threshold. In the MP4 it starts at exactly the predicted sample (0 off). Cross-correlation puts it at 1.30398 s
     for a 1.304 s cue.
3. WebM, transparent, 1080p.
   - VP9 alpha_mode 1, Opus, 341 frames, 6.6 MB.
   - Chrome's `<video>` and ffmpeg both decode the transparency: 82% of frame 170 is fully clear.
   - VP9's alpha is lossy: 3,545 background pixels have alpha 1–7, and 2,901 of those are 1/255. Over magenta,
     looked at full size, there is no haze and no fringe.
4. PNG sequence, 720p.
   - 341 numbered RGBA PNGs, a WAV and a README; `testzip` clean; 43.5 MB.
   - The WAV is 272,800 samples, exactly 341/60 s.
   - ffmpeg imports the frames as a 60 fps image sequence with the WAV: both 5.683 s.
   - The WAV's sound sits 1 sample (0.02 ms) from the MP4's.
5. Cancel.
   - With the panel closed, the button read "Capture: recording video, 15%".
   - Cancel → "Cancelled. Nothing was saved.", with no download.
   - The emote went back to 1.571 s and played on.
6. Ordinary use.
   - Pause holds, scrub and Next frame move, and Play runs.
   - 2× plays 1.63 s of clip in 0.8 s.
   - A recording at 2× is 341 frames (normal speed), the same emote comes back paused at scale 2, and Play then runs
     it at 2×.
   - Another emote plays, the camera orbits, and the view keeps moving.
7. Phone (emulated: 390×844, touch, DPR 3).
   - Record sits on screen (y 618–654).
   - Sizes offered: 480p, 720p and 1080p.
   - A 720p MP4 of the idle (23.33 s, 1400 frames) took 31.6 s.

Page errors: one 403 per page load, the same request as in the 21 Nov runs before the merge. The dev-only
"Recovered shader" box covers the panel's Image tab on a phone in the dev viewer; production doesn't show it.

**Second merge of main (0f4bb31).** It brings in #65 (the guide), #66 (multi-character Phase 1, which moves the
animation binding into `useAnimationBinding.ts` and outfit passes into `OutfitPass.ts`), #68 and #70.
- One conflict: `Icons.tsx`, where both sides added an icon; both are kept.
- `CaptureDriver`, the screenshot context, the recording guard on camera turns and the dev hooks all survive.
- `tsc -b` is clean and `npm run build` passes.
- `npm test`: 988 tests, 975 pass, the same 8 fixture failures, 5 skipped.
- Run `steps-0122d`: every check passes again, and the analysis passes 14 of 14. The numbers match `steps-0122c`
  (MP4 341 frames, onset 98.2 ms with the wave's lead, WAV 1 sample from the MP4, phone 1400 frames in 31.5 s).
  The frames were looked at again.
