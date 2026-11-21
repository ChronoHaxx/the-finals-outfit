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
