# Video range: record part of an emote, looped, at the emote speed (22 Nov 2026)

The coordinator relayed the owner's ask (22 Nov): "in/out markers on the emote timeline (drag handles plus typed
times), export only that range, an optional loop count, honour the speed setting; the default stays the whole emote."
Branch `claude/video-range-export-2026-11-22` off main 8a03d0e (the MOV export, #81). Checklist: `functional-checklist.md`.

## What a person sees

- **Timeline (computer):** a **Video range** button (a bracket icon) beside Loop.
  - Turning it on puts two red markers above the track, at the emote's start and end. The parts outside are shaded.
  - Drag a marker, or focus it and use the arrow keys, Home and End.
  - **I** and **O** set the start and the end at the frame on screen, as in an editor. They work with the range off too:
    pressing one turns it on.
  - Clicks on the track under the range still move the playhead. The markers sit above the track, not on it.
- **Video tab (every device):** "Video start" and "Video end" in seconds, a **Whole** button, and **Loops** (1–20).
  - A typed time commits on Enter or when the field loses focus. Escape puts the old value back.
  - The summary says what will be recorded, for example "Clip 0.40–2.00 s, 2 times, at 0.5x speed (the emote speed)".
- **Phone:** the timeline keeps main's layout: no Range button, no markers. A 390 px phone leaves the track only
  84 px, and markers would cover most of it. A phone types its range in the Video tab instead.
- **Speed** is the emote speed slider's value (#58). The recording plays the range at that speed, sound included.
  A video of a slowed emote comes out longer: twice the frames at 0.5x.

## How it works

- `framePlan(clip, fps, range)` (`src/rig/VideoExport.ts`) is the one place that maps an output frame to a clip time.
  - The output has `loops × (to − from) × fps / speed` frames. A one-shot range adds one frame for its end pose, as the
    whole emote did.
  - A pass's first frame is the range's start, its last frame the one before the next pass starts.
  - `RigAnimator.beginRecording(start)` settles the sway at the range's start, so a range's first frame is the whole
    emote's frame at that time. The analysis checks this: a mean difference of 0.000.
- **Sound** (`EmoteSounds.renderOffline`) is scheduled per pass on the same OfflineAudioContext.
  - A cue that started before the range joins mid-sound, from the right offset, with a short fade-in.
  - A cue still sounding at the range's end stops there with a fade. Speed scales the playback rate and the fades, like
    tape.
  - A sound that covers the whole emote when the whole emote loops (a music bed) plays once, uncut, across the passes.
- **Saved per emote, per browser** (`src/lib/video-range.ts`): localStorage `finals-outfit.video-range`, keyed by clip.
  - Every change is written at once (read, change, write back), keeping fields this version doesn't know.
  - Up to 60 emotes keep a range; past that, the one set longest ago goes. **Whole** clears only that emote's range.
  - When storage refuses (private mode, quota), the range lives in a page copy for the session and the export still
    uses it.

## Traps found on the way

- **Float32 frame times.** Clip files store the frame time as a float32, 0.033333335 s, not 1/60 s. Ranges snap to
  those frames, so a range of 48 frames is 1.6000001 s long. At half speed the second pass's first frame computed
  `floor(1.6 / 1.6000001) = 0` passes and showed the range's end pose instead of its start.
  - The fix: a pass boundary is judged with a slack of a thousandth of an output frame.
  - A unit test covers it across speeds, and the analysis checks the seam frame by picture.
- **Sound rounding.** Starting the sound 0.4 s later moves a cue that starts between samples to a different
  sub-sample position, so Web Audio's resampler rounds a few samples differently.
  - Aligned, the range's sound differs from the whole emote's by at most 12 in 32,767, below −68 dB.
  - Shifted one sample either way, it differs by about 14,800.
  - So the alignment is exact, and the difference is rounding, not timing.

## Agent evidence

Production build of 91dd26d (`../mov-export-2026-11-22/build-preview.ps1`), headless Chrome on the RTX 3080,
"Applause Pause" (4.333 s, a clap cue at 0.5286 s).

- **UI:** `range-steps.mjs`, run `range-final3`, 22 Nov 2026 about 23:22–23:25: 17 of 17 checks across steps 1-6,
  with no page errors. On the emulated 390 px phone the timeline has main's 7 controls, and its track (84 px) fills
  what they leave of the 356 px row.
- **Files** (`analyse-range.py`, Pillow, Python's wave module and ffmpeg; no app code):
  - Frame counts: whole 261, range 0.40–2.00 s 97, the range twice at 0.5x 385. These are 96 + 1 and 384 + 1.
  - Sound: the range's onset is 13,945 samples against the whole emote's 33,145, exactly 0.40 s (19,200) earlier.
    At 0.5x the onsets are 27,889 and 181,489, expected 27,890 and 181,490.
  - The half-speed recording's frame 192, its second pass's first, matches the range's frame 0. Frames 190 and 191
    match its frame 95, and 193 and 194 its frame 1.
  - The MOV of the range decodes to its PNGs byte for byte, and its sound equals the WAV.
- **Unit tests:** 39 pass in `tests/video-export.test.ts` and `tests/video-range.test.ts`.
  - Frame plans with ranges, loops and speeds, including the float32 seams.
  - Range sound scheduling.
  - Marker moves.
  - Storage keeping unknown fields, the cap, and a refusing storage.
- **Not covered:** real phones (the phone step runs Chrome's touch emulation), Firefox, Safari.
