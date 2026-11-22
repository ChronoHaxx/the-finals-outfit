# Integrated-GPU performance (Shocka's list, item 7), 21 Nov 2026

Shocka, 12 Nov, laptop with an integrated GPU: the default outfit ran at about 20 fps on Low at 50% resolution in
Firefox (better in Edge); TAA ran faster than MSAA and Off; the iGPU peaked at about 33% utilisation; with the face
left blank, utilisation rose to 50% and the frame rate to 60.

## What was wrong

The viewer was **processor-bound**, and the cost was the still-view accumulator's per-frame change check,
`StableFrameState.capture` (src/rig/StableFrameState.ts). Every frame it records every render input (camera,
lights, materials, every object's matrix, every bone's matrix and bind inverse) and compares it with the last frame,
so it knows whether to keep averaging, reproject or restart. Three things made it expensive, all tied to the head:

1. **A shared skeleton was recorded once per mesh.** The default head (Face 01) is seven skinned sections bound to
   one 323-bone skeleton. The capture walked the skeleton for each section: 7 x 323 = 2,261 bone records per capture,
   against 160 for the whole body, shirt, jeans and shoes without a face.
2. **Every bone's parent chain was recomputed.** For each bone record it called `bone.updateWorldMatrix(true, false)`,
   which recomposes the bone's matrix and every ancestor's (mean depth 13) — right after `scene.updateMatrixWorld(true)`
   had already brought every in-scene matrix up to date with the same arithmetic. About 30,000 matrix products a
   capture, for numbers that were already current.
3. **MSAA and Off captured twice per frame.** With the idle playing, MSAA and Off take the still path (fresh frame
   per change); every frame is a change there, and the still path re-captured the whole scene a second time only to
   record the sampling camera it had just reset. TAA takes the motion path, which captures once.

That is the "Off slower than TAA" anomaly: Off and MSAA paid for two captures, TAA for one plus a velocity pass, and
with the head the capture outweighed everything else. Without a face the capture is small and the three settings
were within a millisecond of each other.

A fourth, smaller cause affects other heads: the generic equip path (`CharacterRig.equip`) gave each skinned
section of a legacy GLB its own copy of the skeleton. Face 11 has twelve sections, so twelve copies of the same 323
bones: twelve skeleton updates and bone-texture uploads per render pass, and twelve skeleton records per capture.

Not a cause: no per-frame `readPixels`, `getError`, fences or `getParameter` (counted on the context prototypes:
~600-700 GL calls a frame, none synchronous); `getContextAttributes` once a frame, which browsers answer locally.

## What changed

Two commits. The first is the `src/` and `tests/` part of `f6ffa83` from the unpushed multi-character branch
(`claude/multi-character-2026-11-21`, Phase 1.4), taken unchanged: it had already fixed causes 1 and 2 for its own
reason (four characters' skeletons), and landing one implementation avoids two that collide.

- (f6ffa83) `StableFrameState.capture` records each bone once per capture, at the first mesh that uses it, and
  refreshes only bones outside the scene.
- (f6ffa83) `SkeletonUpdateMemo`: three's `Skeleton.update` skips when every bone matrix and inverse bind is exactly as
  at that skeleton's last update. three updates every skeleton once per `render()` call, and a frame has several
  (the main pass, the contact shadow, TAA's velocity pass).
- `StableFrameState.recordSamplingCamera` rewrites only the camera section of the record; the accumulator's still
  path uses it instead of a second full capture (cause 3).
- A shared skeleton's inverse binds are recorded once per capture; matrices are recorded without the generic type
  dispatch.
- `CharacterRig.equip` shares one rebound skeleton between sections that shared one in the file (cause 4).

Change detection is unchanged: tests/rig/stable-frame-capture-cost.test.ts pins that bone turns, bind-pose edits,
skeleton swaps, removed sections and bones outside the scene are still seen, and that the camera re-record leaves
exactly the record a full second capture would.

## Numbers

Production builds of main (0951e1b) and this branch, headless Chrome with vsync off, DevTools CPU throttling 4x (the
graphics card is not throttled: this measures the processor side, where the report pointed), Low preset at 50%
resolution (a 1536x864 window at 125%: a 576x505 canvas), idle playing. Frame time = rAF interval; builds interleaved
run by run on a shared machine, median of the repeats. Absolute numbers moved with background load between batches;
compare within a row.

| outfit, 4x throttle | TAA before | TAA after | MSAA before | MSAA after | Off before | Off after |
|---|---|---|---|---|---|---|
| default (Face 01) | 35.6 ms | 16.6 ms | 51.5 ms | 13.2 ms | 50.0 ms | 13.5 ms |
| no face | 6.7 ms | 5.8 ms | | | 11.6 ms | 5.7 ms |
| Face 11 | 34.0 ms | 13.6 ms | | | 55.2 ms | 11.5 ms |

Main-thread JavaScript per frame from the CPU profile (default face, 4x): TAA 42.4 -> 17.5 ms, Off 55.2 -> 15.2 ms,
MSAA -> 15.0 ms; of it the change check went 23.8 -> 4.4 ms (TAA) and 41.5 -> 4.4 ms (Off). What is left: three's
rendering (~6-8 ms at 4x), the animator (~2.4 ms, of which the face pose ~1.7 ms), the change check's material walk.

Firefox (Playwright's Firefox 139 build, unthrottled on the desktop, default face): TAA 7.9 -> 3.2 ms, Off 13.4 ->
3.2 ms. Before, Off was the slowest there too.

An earlier, quieter batch with only the capture changes (no skeleton-update memo yet) gave default face TAA 47 -> 72
fps, MSAA 21 -> 65, Off 16 -> 47 at 4x: the capture alone was most of the gain.

Same look: `capture-compare.mjs` drew one held pose at desktop settings (High, full resolution) from both builds.
Face 11 (TAA still, Off moving): identical, 0 pixels differ. Default face (TAA/MSAA/Off still, MSAA/Off moving):
69-142 of 745k pixels differ by at most 5/255, all on the eyelids and the T-shirt neckline; main against itself
differs the same way in the same places (138 px, 5/255), so that is the face's existing run-to-run variation, not this
change. Judged at full size by eye: no visible difference.

Not measured: an actual integrated GPU (none on this machine) and GPU time. Shocka's figures (33% utilisation at
20 fps, 50% at 60 fps with no face) suggest the face also costs his GPU a few milliseconds a frame, which this change
does not touch; with the processor side fixed, the GPU becomes his limit.

## Tools (this folder)

- `frame-profile.mjs` — frame time (rAF interval, vsync off), WebGL calls per frame, sampled CPU profile; DevTools CPU
  throttling; the Low preset at 50% resolution; interleaves builds (`--bases=before=url,after=url`) and reports the
  median and best of the repeats (this machine is shared: background load only ever adds time).
- `scene-stats.mjs` — meshes, skeletons, bones and bone records per capture, per face (works on production builds
  through three's `__THREE_DEVTOOLS__` hook).
- `capture-compare.mjs` — the same held pose from two builds, pixel comparison.
- `serve-like-deploy.mjs` — build this checkout with the deploy workflow's asset hosts and serve it (user checks).

Builds were production bundles (`vite build`, the deploy workflow's asset hosts, base `/`) served by `vite preview`.
Build them from PowerShell: Git Bash rewrites `VITE_BASE=/` into the Git install path (MSYS path conversion), which
yields a bundle that asks for its catalog under `/Program Files/Git/`.
