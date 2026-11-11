# Graphics options, sharp print on every setting, WebGL and Edge fixes (10 Nov 2026)

Branch `claude/graphics-options-2026-11-10`, based on main `cef0dbf`. Feedback from the FModel Discord, relayed by the
user on 10 Nov, all about the live site:

1. "Seems blurry at times" (a tester blamed TAA).
2. On **Low**, garment print (the "EE" in "MEETS" on a red jacket) ghosts while the idle plays; stable when paused.
3. Microsoft Edge: "so broken", "horrid" performance.
4. LibreWolf does not load the site.
5. Requests: anti-aliasing on/off, a render-resolution option, an FPS counter.

## How the view draws, in one paragraph

Each frame renders one sample, nudged by a fraction of a pixel (jitter), into a floating-point target. A still view sums
32 such samples: edges get anti-aliased, and see-through hair and lace (drawn as a random dither, "alpha hash") average
to their real opacity. A moving view cannot wait for 32 samples, so it keeps a running average instead: each frame
mixes a little of the new sample into the history. That is temporal anti-aliasing (TAA). Its whole difficulty is the
history: on a moving surface, the history at a pixel belongs to whatever passed through that pixel earlier. Two
defences exist. **Motion vectors** say where each pixel's surface was last frame, so the history is read from there
(reprojection). **Neighbourhood clamping** limits the history to the colour range of the current 3x3 pixels, which
drops colours that cannot be there now.

## 2. Print ghosting on Low: the cause

Low and Balanced had **no motion vectors**: only High did (hair motion vectors, PR #30). Their history was
screen-locked, and the 3x3 clamp was the only defence. Inside printed text, every 3x3 window contains both the ink and
the fabric colour, so the clamp's range spans both and a stale letter colour passes straight through. At 1x pixel
density (Low everywhere, and Balanced on any 1x monitor) letter strokes are one or two pixels wide, so nearly every
window near text spans both colours.

Measured with a deterministic rig (`probe-decal-ghost.mjs`): the idle replays at a fixed 1/60 s per frame; the truth
is the same pose frozen and converged to 32 still samples; error is the mean luma difference (levels of 255) over
"detail" pixels (where the truth's 3x3 contrast exceeds 40 levels: print edges, seams, logos); sharpness is the
frame's gradient energy over the truth's (1 = as sharp as the still frame). Printed **Punktuator Jacket** (red, chest
print, pocket patch, sleeve text; no catalog item is named "Atlas jacket"), close chest camera, 1x.

| Before (main) | Detail error | Off by >24 levels | Sharpness |
| --- | --- | --- | --- |
| Balanced / Low (screen-locked) | 13.9 | 15.2% | 0.85 |
| High (motion vectors) | 6.6 | 4.4% | 0.92 |

Difference maps (`scripts/generated/decal-ghost/chest/diffs-180.png`, local): Balanced outlines every edge (print,
seams, silhouette); High is faint. At 4x, Balanced's patch stripes and small text are doubled.

## 1. Blur: what it was

Three separate causes, all addressed:

- **The screen-locked average** (Balanced, Low): anything moving was smeared over ~10 frames. Gone with point 2.
- **High's long history on opaque surfaces.** High averaged every pixel with weight 1/16 per frame, which the hair
  needs (it averages the dither) but opaque surfaces do not: for them it only lags and softens. A sweep on the same
  rig (idle, before any change): history 1/16 detail error 6.6, sharpness 0.92; 1/8 4.8, 0.96; 1/4 4.0, 0.98; no
  history 9.9, 1.06 (raw jitter, aliased); a bilinear instead of Catmull-Rom history read 10.4, 0.77 (so the cubic read
  matters a lot). Fable's suggestion: a per-pixel weight, shorter for opaque pixels and shorter still the faster they
  move. Chosen: **1/8 at rest, rising to 1/2 at 4 px/frame**; hair keeps 1/16. 1/4 at rest was a little sharper in
  motion but flickered twice as much on a held pose (fine print shimmering); see "Results".
- **Pixel density below the screen's.** Low (1x) on a high-DPI screen is upscaled by the browser. Now visible and
  controllable: the Resolution option shows the pixel size, and the FPS counter shows the canvas size.

## The changes

1. **Motion vectors on every preset** (`StableFrameAccumulator`, `StablePreview`). TAA always takes the reprojected
   path; the screen-locked one is only reachable with `?quality=balanced` (test rigs, its GPU check). The presets now
   differ only in pixel density: High up to 2x, Balanced up to 1.5x, Low 1x (`graphics-quality.ts`).
2. **Opaque history** (reprojection shader): weight `max(warm-up, mix(1/8, 1/2, smoothstep(0, 4 px, speed)))`, and no
   history at all where last frame's depth at the reprojected spot belongs to another surface (the velocity pass
   already provides both depths; before, that check only steered alpha-hashed pixels). Alpha-hashed pixels unchanged.
3. **Anti-aliasing setting: TAA / MSAA / Off** (the user chose all three). MSAA and Off use the still path with the
   jitter switched off (Fable's simpler route): a changed frame is drawn fresh, a still one keeps averaging only its
   alpha-hash coverage, so see-through hair is dotted while moving and smooths within ~half a second of stopping.
   MSAA draws the sample target with 4 samples (capped by what the GPU supports for RGBA16F). The accumulator now
   runs for every outfit (`alwaysOn`), so the canvas's own 4x MSAA buffer is gone (`antialias: false`; it was up to
   ~190 MB at 3000x2000 and only ever received one full-screen copy). Without float render targets the view still
   draws directly, now without anti-aliasing.
4. **Resolution override** (the user chose "presets + override"): Auto (from the preset) or 100 / 85 / 75 / 67 / 50 %
   of the screen's own pixels, with the pixel size shown. A hand-picked resolution stops Auto measuring.
5. **FPS counter**: fps, median and 95th-percentile frame time, per-frame script time, canvas size, mode and state
   (moving with motion vectors, fresh frames, settling n/32, still), and **Copy diagnostics** (browser, GPU string,
   screen, settings, frame times, a script-speed test, WebAssembly) for bug reports.
6. **Auto** (Fable review): a step goes to the next preset that draws fewer pixels on this screen. Before, on a
   125-150% Windows screen High and Balanced drew the same pixels, the "step" changed nothing, was judged "did not
   help" and marked the PC processor-bound for good. On a 1x screen there is nothing to step to; Auto settles without
   that verdict. Auto's saved result now carries a version, so results measured under the old preset meanings are
   not reused.
7. **The Graphics button opens a panel** (Quality, Anti-aliasing, Resolution, Show FPS counter). Escape or a click
   outside closes it; it is capped to the viewer's height and scrolls on a phone. All settings are saved in the same
   localStorage object, read-modify-write, so fields another version wrote are kept (checked with a seeded unknown
   field).

## 4. LibreWolf

LibreWolf sets `webgl.disabled` ([LibreWolf docs](https://librewolf.net/docs/settings/)). Reproduced with Playwright's
Firefox and LibreWolf's prefs (`webgl.disabled`, `privacy.resistFingerprinting`; `librewolf-check.mjs`): the page and
picker loaded but the viewer stayed blank, with an unhandled rejection from three's renderer. Chrome with
`--disable-3d-apis`: the same blank viewer and about 50 repeated "Error creating WebGL context" errors.

Now `Builder` probes WebGL 2 once (`webgl-support.ts`, the probe context released at once) and, without it, shows "3D
preview unavailable" with the LibreWolf fix and the browser's own reason, instead of mounting the viewer (which then
downloads nothing). Both emulations: the message, no page errors, the picker working. A lost graphics context (driver
reset, out of memory) shows "3D view stopped" with a **Restart 3D view** button that remounts the canvas.

## 3. Edge

Normal Edge ran like Chrome here (headless, same machine). The lead is Edge's **enhanced security**, which runs sites
the visitor rarely opens without the JavaScript JIT, WebAssembly interpreted
([Microsoft Learn](https://learn.microsoft.com/en-us/DeployEdge/microsoft-edge-security-browse-safer),
[support](https://support.microsoft.com/en-US/edge/enhance-your-security-on-the-web-with-microsoft-edge)); Microsoft
notes some installs have it on without the user choosing it. This page's frame is mostly JavaScript (~14 ms on this
desktop), so without the JIT it crawls. A frame-shaped loop (`browser-env-check.mjs bench`): Chrome 1.4 ms, Edge 2.5,
with V8's optimising tiers off 23.3 and 25.1 (10-17x). `--jitless` is not a fair stand-in (it can remove WebAssembly
entirely); the emulation keeps only the interpreter tier for JavaScript.

`SlowScriptNotice` runs that loop (three times, fastest kept) 4 s after load, in Edge only, and above 12 ms shows how
to turn enhanced security off for the site ("Added security" in the address bar); dismissable, remembered. Real Edge:
normal 2.2 ms, no notice; JIT off 18.6 ms, notice shown (`edge-check.mjs`).

Unverified for the tester's machine: other Edge-only causes (efficiency mode, hardware acceleration off, a per-app GPU
preference, Tracking prevention blocking an asset host). The FPS counter's **Copy diagnostics** is the way to find out.

## Results (shipped defaults; `scripts/generated/decal-ghost/`, local)

Print rig at 1x, Punktuator Jacket, close chest camera. "Old High" is reproduced on the new code with
`rpOpaque=0.0625&rpOpaqueFast=0.0625&rpReset=0`, so every row ran on the same build. Detail error (luma levels) /
sharpness (1 = the converged still frame).

| Clip | Old Low / Balanced (screen-locked) | Old High | Now (every preset) |
| --- | --- | --- | --- |
| Idle | 13.9 / 0.85 | 6.6 / 0.92 | 4.95 / 0.975 |
| Clap | 27.1 / 0.65 | 13.5 / 0.81 | CLAP_NEW |
| Shadow-boxing | 29.0 / 0.59 | 17.2 / 0.73 | BOXING_NEW |

- Held pose on the moving path (frame-to-frame change on print pixels, levels): old High HOLD_OLD, now HOLD_NEW.
- Hair ground truth (`scripts/anim-export/probe-truth.mjs`, 1x, old High vs now): idle ponytail hair 6.64 vs 6.65, whole
  character 2.31 vs 2.25; Disco hair 11.05 vs 10.74, whole character 5.68 vs 4.91. Hair is unchanged, as intended
  (alpha-hashed pixels keep 1/16).
- Seen at full size: the clap at step 80, old High drags ghost fingers across the zip and a halo along the print line;
  now the hand and print are clean (`decal-ghost/clap-compare-80.png`). The per-mode captures
  (`decal-ghost/modes-grid.png`): moving TAA smooth; MSAA and Off dotted hair while moving, Off jagged; all three
  converge to smooth hair once still. MSAA confirmed at 4 samples on this GPU.
- Caveat: moving frames are compared with a truth frozen at the same clock step; in the fast clap the hand sits a few
  pixels from the truth's in every variant alike, which raises all clap numbers equally.

## Checks

| Check | Result |
| --- | --- |
| Typecheck | clean |
| Unit tests | 769 pass, 8 known model-fixture failures (same as main), 5 skipped |
| `tests/graphics-quality.test.ts` | 9 pass (4 new: densities, resolution override, Auto at 1x/1.5x screens, versioned Auto result) |
| Production build | builds |
| GPU: `check-temporal-preview.mjs` | 102 pass |
| GPU: `check-motion-resolve.mjs` | 38 pass |
| GPU: `check-reprojection.mjs` | 19 pass; the moving checker card is 0.0094 (was 0.0057; Balanced 0.023): the shorter opaque history averages less jitter on a pure checkerboard |
| UI: `check-graphics-ui.mjs` (desktop 2x, phone 3x) | 12/12: TAA default with motion vectors; MSAA 4 samples; Off; 50% halves the canvas; FPS reads; settings saved with an unknown field kept; survive reload; Escape closes; panel fits a 375 px phone; no page errors |
| No WebGL (Chrome `--disable-3d-apis`, Firefox with LibreWolf prefs) | message shown, no page errors, picker works |
| Real Edge, normal / JIT off | ready 9.1 / 11.7 s; notice no / yes; speed test 2.2 / 18.6 ms |

Looked at full size: the Graphics panel at desktop and phone width (`scripts/generated/graphics-ui/`), the FPS box,
the LibreWolf message, the Edge notice, the print and clap comparisons, the per-mode grid.

## Known limits and follow-ups

- **Faces are treated as dithered.** The recovered face material is alpha-hashed (its neck/rim fade), so the whole face
  takes hair's 1/16 history while moving: 0.96 of the still frame's sharpness on the face against 0.975 on print. The
  velocity pass cannot know which pixels the recovered shader actually dithers. Pre-existing on High.
- **Fine print shimmer**: the shorter history roughly doubles frame-to-frame change on a held pose (see Results).
- **No real phone or integrated-GPU laptop measured** (Fable's first next step): the velocity pass's cost there is
  unknown. On this RTX 3080 it is within run-to-run noise; the frame is processor-bound (~14 ms of JavaScript).
- MSAA and Off on a GPU without float render targets: the view draws directly, without anti-aliasing.
- The tester's Edge: enhanced security is the likely cause, not confirmed; ask for the Copy diagnostics text.
