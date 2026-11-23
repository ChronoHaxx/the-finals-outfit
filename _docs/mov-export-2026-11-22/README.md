# Transparent MOV for video editors (22 Nov 2026)

Shocka, the main user, asked for a transparent MOV to edit with. Branch `claude/mov-qtrle-export-2026-11-22` off main
1691441. Checklist: `functional-checklist.md`. Optional editor check for the owner: the end of this file.

## The route

A 22 Nov review set the route:
- Chrome encodes no codec with alpha through WebCodecs (recorded in `src/rig/VideoExport.ts`).
- But MOV is only a container. A lossless intra codec with alpha can be written in plain JavaScript from the
  straight-alpha RGBA frames the export already renders.

**QuickTime Animation (qtrle), 32-bit ARGB, every frame a keyframe, with PCM sound.**

Not taken:
- **ProRes 4444**, the codec editors name first: no browser encodes it, and a JavaScript encoder is a project of its
  own (DCT coding, Apple's bitstream).
- **ffmpeg.wasm**: a 30 MB download and slow single-threaded encoding. Its threads need COOP/COEP headers, which
  GitHub Pages can't send, and the default core is GPL.
- **PNG-in-MOV**: about the PNG zip's size. For the test emote at 720p that is 29 MB against qtrle's 68 MB, 2.3 times
  smaller. Resolve 20's codec list has PNG under QuickTime decode, but Adobe's native list does not name it. The PNG
  zip already covers "small and lossless", so it was not shipped.

## How QuickTime Animation works

It is run-length coding, line by line. `src/lib/qtrle-encode.ts` has the byte layout. In short:
- Each line is a series of codes. A code is either "n literal pixels follow" (1..127) or "this one pixel, n times"
  (-2..-127). `0xFF` (-1) ends the line, which is why a repeat must cover at least 2 pixels.
- A pixel is 4 bytes, A R G B. The sample entry's depth of 32 ("Millions of Colors+") is what tells a reader there is
  alpha.
- A delta frame may skip unchanged pixels and lines. **Every frame here is a keyframe.** Adobe's native .mov reader
  takes Animation only "without delta frames", and a keyframe-only file can be cut and scrubbed anywhere.

What that costs in size: the transparent background is long runs of one pixel and costs almost nothing. The
character's shading almost never repeats exactly, so it is literal pixels at 4 bytes each, uncompressed. The file
size therefore follows how much of the frame the character covers.

The frames are the export's straight-alpha pixels unchanged (no colour bleed, unlike the WebM), so the MOV is
bit-exact against the PNG sequence.

## The container

`src/lib/mov-mux.ts` reuses mp4-mux's box writer. QuickTime is the format ISO BMFF grew from. The layout copies what
local ffmpeg (2023-11-02 build) writes for `-c:v qtrle -pix_fmt argb -c:a pcm_s16le`, compared box by box with a
reference file:
- the `qt  ` brand;
- `mhlr`/`dhlr` handler boxes with Pascal-string names;
- language 0x7FFF;
- an edit list from 0 on each track;
- an `rle ` entry of depth 32 with `fiel` and `pasp`;
- `sowt` sound, version 0, with a `chan` stereo layout, one PCM frame per sample.
The `sowt` entry is byte-identical to ffmpeg's.

Deliberate differences from ffmpeg's file:
- The movie box comes first ("fast start").
- There is no `wide` or `udta` box.
- Spatial quality is "lossless" (0x400), as ffmpeg writes for raw video.
- The compressor name is "Animation".
- There is no sync-sample table, because every frame is a keyframe.
- Each frame is its own chunk, preceded by its 800 PCM frames (1/60 s at 48 kHz), so sound and picture interleave.

The sound is the same offline render as the PNG zip's WAV (`EmoteSounds.renderOffline`). It starts at frame 0 with no
encoder delay, so it needs no edit-list offset.

## Where it is offered

On a computer only. The panel shows MOV on a phone (`pointer: coarse`) but disables it, with the reason, and points at
the PNG sequence. Desktops keep the 2 GB file cap; low-memory desktops keep 400 MB. Passing the cap stops the export
with a message that suggests a smaller size or the PNG sequence.

## Which editors read it

**Proven by test**
- ffmpeg/ffprobe, a decoder that shares no code with this one, reads the app's MOV:
  - It reports `qtrle`, `rle `, `argb`, 60/1 fps and PCM s16le at 48 kHz.
  - Every decoded frame equals the PNG sequence's frame, byte for byte, alpha included.
  - The sound equals the WAV, sample for sample, from 0.
  - Numbers are in "Agent evidence" below.
- OBS and VLC play through ffmpeg's decoders, so they should behave the same. They were not opened.

**By documentation only (not opened here)**
- **Premiere Pro and After Effects.** A 2017 Adobe community post lists natively imported .mov codecs, including
  "Animation (without delta frames)". Community answers since then agree that keyframe-only Animation imports.
  Forum reports about alpha interpretation (straight or premultiplied) are mixed. These frames are straight alpha.
- **DaVinci Resolve 20.** Blackmagic's "Supported Codec List" PDF (text extracted 22 Nov) lists "Animation QuickTime"
  among the QuickTime .mov decode codecs for macOS (p. 4), Windows (p. 8) and Rocky Linux (pp. 12-13). The Alpha
  column's marks didn't survive text extraction, so alpha in Resolve rests on the codec's own alpha and the owner's
  check below.

Premiere Pro 2023 and DaVinci Resolve are installed on the owner's PC, so the check takes a couple of minutes.

## Agent evidence (22 Nov 2026)

Renders of game assets stay out of git (session scratchpad).

**Unit tests** (`tests/video-export.test.ts`, 4 new):
- qtrle round trips through a decoder written from the format, decoding over garbage to prove each frame is a true
  keyframe. Widths 1, 2, 127, 128, 255, 300 and 33 are covered, and the exact bytes of runs, lone pixels and line ends
  are checked.
- The MOV's boxes are read back with the spec parser: brand, handlers, sample entries, tables, the interleave and
  odd sound lengths.
- Where ffmpeg is installed, it decodes the frames and PCM exactly.

**Suites and build**
- `npm test`: 1106 tests, 1092 pass, 6 skipped. 8 fail: the usual worktree fixtures (the ski-blade GLB and the
  `public/models` body and socket GLBs this checkout does not have).
- `tsc -b` is clean, and `npm run build` passes with deploy.yml's hosts.

**The run.** Production build of 8e42568, `vite preview`, headless Chrome on the GPU (`mov-steps.mjs`, then
`analyse-mov.py`), run `run-final`:
- **UI: 13/13 PASS.** The emote is "Applause Pause", 4.333 s (261 frames), with one cue at 0.529 s.
  1. MOV sits second of four, with its text, and the Video tab is a guide control.
  2. **720p** Standard (712×720) MOV: 7.5 s to make, 68 MB, "with sound". Progress counted frames and MB. The emote
     came back playing. The PNG sequence of the same emote: 29 MB.
  3. **1080p** Draft (1068×1080): 6.1 s, 148 MB.
  4. After a reload, MOV is still picked, and an emote plays.
  5. Cancel says "Cancelled. Nothing was saved.", with no download.
  6. On a phone (390×844, touch, DPR 3), MOV is disabled with "On a computer only…", and the PNG sequence stays
     available.
  No page errors.
- **Files: 10/10 PASS.**
  - Layout: `qt  `, ftyp/moov/mdat.
  - Video: qtrle `rle ` argb 60/1, 261 frames.
  - **0 of 261 frames differ from the PNG sequence (largest difference 0)**, alpha included.
  - Middle frame: 454,711 clear, 56,163 solid and 1,766 soft pixels.
  - Sound: PCM s16le 48 kHz stereo, **208,800 frames, equal to the WAV sample for sample** (4.3500 s each).
  - The 1080p file decodes in full.
- **Size:** 15.7 MB/s at 720p and **33.9 MB/s at 1080p** for this framing. The panel and the patch note say "about
  35 MB a second at 1080p". The review had estimated ~50 MB/s. The size follows how much of the frame the character
  covers, so zooming in costs more.
- **Speed:** the qtrle coding is cheaper than the PNG zip's deflate. An earlier pass made the 720p MOV in 12.2 s and
  the zip in 21.2 s.
- **Looked at:**
  - First, middle and last frames over magenta, and the middle one over a checkerboard: a clean cut-out.
  - A 4× crop of the collar and shoulder over magenta: soft edges blend, with no dark fringe.
- An earlier pass (`run-a`, same code before the size figure was filled in) gave identical numbers.

Changes after the tested revision are comments and these docs only.

## For the owner: drop the file into your editors (optional, not blocking)

Premiere Pro 2023 and DaVinci Resolve are on this PC. Make a MOV with Capture → Video → MOV (any emote with sound),
then:

- [ ] **Premiere Pro:** import the .mov and put it on V2 over any clip. Expected: the character over the clip, no
  black box; the sound on A1 lines up with the motion.
- [ ] **After Effects** (if installed): import. Expected: Interpret Footage shows Alpha as **Straight**. If edges show
  a dark or light halo, set it to Straight.
- [ ] **DaVinci Resolve:** import into the media pool and put it on V2 over a clip. Expected: the transparency is
  shown. If it shows black, right-click the clip → Clip Attributes → Alpha mode: Straight.
