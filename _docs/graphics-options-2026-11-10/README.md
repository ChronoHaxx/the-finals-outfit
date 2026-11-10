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

[FILLED IN BELOW]
