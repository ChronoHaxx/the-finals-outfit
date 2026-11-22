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
- **PNG-in-MOV**: about the PNG zip's size, so 3-4 times smaller than qtrle (numbers below). Resolve 20's codec list
  has PNG under QuickTime decode, but Adobe's native list does not name it. The PNG zip already covers "small and
  lossless", so it was not shipped.

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

## Agent evidence

(filled in from the runs below)
