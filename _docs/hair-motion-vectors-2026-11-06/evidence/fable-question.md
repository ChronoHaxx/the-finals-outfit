Plan review request: adding motion vectors (TAA-style history reprojection) to a three.js character viewer whose hair cards are alpha-hashed, plus an "Auto" graphics-quality tier. I want to know what will fail, what I have missed, and whether there is a simpler route.

## Goal
A web outfit builder for a game shows one animated character (3D, three.js). Hair, lace and sheer fabric are alpha-HASHED (dithered discard), so they need temporal averaging. The user reports grain on hair during ANY movement: the outfit-screen idle, emotes, and camera drags. They want it fixed, and they asked for a Graphics dropdown (High / Balanced / Low / Auto) whose Auto default picks a tier from a quick on-device performance test, as games do.

## Context
- three.js r184, WebGL2, React Three Fiber, `dpr={[1,2]}`. Desktop and phones. Transparent canvas (premultiplied), composited over the page.
- One character: ~10-20 skinned meshes (body, head, garments, hair cards), all MeshStandard/MeshPhysical materials patched with onBeforeCompile:
  - 8-influence skinning: an extra `skinIndex1`/`skinWeight1` pair added inside `skinbase_vertex`/`skinning_vertex`/`skinnormal_vertex`.
  - Some garments add a STATIC vertex offset after skinning: `transformed += normalize(objectNormal) * (f(vertex colour)) * 0.01` (no time input).
  - Morph targets are set once per outfit (body-type and face fitting), not animated. Some head-wrapped parts are deformed on the CPU once per outfit, not per frame.
  - Some materials have time-animated FRAGMENT effects (scrolling patterns, LED screens), but no time-varying vertex motion.
- Everything that moves per frame lives in bone matrices: AnimationMixer clips, a verlet "SpringBones" chain solver (ponytails, tails), and a port of the game's deformation control rig (twist/corrective bones). Plus the camera (OrbitControls with damping, which keeps creeping for 3+ s after a drag).
- Emote props: static meshes parented to bones, skinned props with their own skeletons, and a hologram partner drawn with additive blending (handled by an alpha-0 "additive pass-through" in the output shader).
- Alpha hash: our own stratified thresholds (AlphaHashSampling.ts, attached). The still path uses per-pixel permuted strata across 32 samples. The motion path uses a 3-periodic screen-space ranking: every 3x3 window holds each of nine threshold bands once, the bands rotate per frame, and there is a per-triangle/material/side offset so stacked cards stay independent.

## Current accumulator (StableFrameAccumulator.ts, attached)
- Still path: when nothing changes, it adds one Halton-jittered sample per frame into an RGBA16F history (sum with weight 1/32) and presents history*32/samples. Any input change (camera beyond 1/8 px, pose, material) resets to a fresh unjittered first frame. A GPU check enforces "history after a change equals a brand-new first render".
- Motion path (while an animation plays): an exponential running average, `mix(clamp(prev, min3x3(now), max3x3(now)), now, 0.1)`, in linear premultiplied space. Nearest-filtered targets, no reprojection, so the history is screen-locked.

## Measurements (ponytail, idle clip, close-up; luma levels /255, composited over white, hair mask from the converged frame)
- Per-pixel shimmer over 9 frames: raw single sample 12.4; motion mode 3.6; Disco emote in motion mode 6.7.
- Moving frame vs the converged paused frame: idle 22.9 mean, 29% of hair pixels off by more than 16; Disco 46.7, 56%. (A small pose shift from the Pause timing is included.)
- MOTION_BLEND 0.04 instead of 0.1 (idle): shimmer 3.6 -> 2.0, but error vs paused 22.9 -> 28.5 (more smudge).
- By eye (attached grid; rows: raw x2, motion mode x2, converged still | Disco motion): motion mode smudges the strand detail, gives the outline a chunky dotted/stair-stepped look, and loses the faint flyaway strands. The code comments note that below 1/9 opacity a 3x3 window can come up empty, so the min/max clamp erases faint strands.

## Plan
1. Velocity pass: a second scene render per moving frame into an RG16F target, using one override material that replicates the vertex patches (8-influence skinning, static offset, morphs). It takes previous-frame bone matrices from a per-skeleton copy of `skeleton.boneMatrices`, uploaded as a second bone DataTexture, plus each object's previous modelMatrix and the previous unjittered viewProjection. Output: currentNDC - previousNDC, both unjittered. Alpha-hashed materials draw into it with alpha test at 0.5 on their opacity map (a separate depth-tested pass, so it writes the velocity of the front-most mostly-opaque surface).
2. Resolve: sample history at uv - velocity with bilinear (maybe Catmull-Rom) filtering; switch the history targets to linear filtering. Neighbourhood clamp in YCoCg with variance clipping (mean ± gamma*sigma over 3x3). Blend 1/16 to 1/32 where reprojection is valid, back to 0.1-1.0 on disocclusion, detected by off-screen reprojection plus a previous-depth comparison.
3. Use the same reprojection for camera-only motion in the still path, so a drag's damping tail stops restarting from one sample per frame. Converge to the existing 32-sample still result once fully still.
4. Keep the dither as it is (3-periodic screen bands rotating per frame), with the history now reprojected.
5. Quality tiers. High = steps 1-4 at dpr up to 2. Balanced = today's motion mode, dpr 1.5. Low = no averaging while moving, dpr 1, smaller shadows. Auto measures real frame times over ~1.5 s after the outfit loads (rAF deltas) and steps down when it can't hold the display refresh. It watches for sustained drops later, caches the result in localStorage, and never overrides a manual pick.

## Questions
1. What in this plan will fail or look wrong for alpha-hashed hair cards in particular? (Velocity of the front-most card versus the face behind sparse strands; screen-space dither bands combined with reprojection, where the history at a pixel now comes from other band ranks so the per-pixel stratification across frames breaks; thin strands and disocclusion; bilinear history resampling blurring dither-scale detail.) Should the dither become surface-anchored (object/UV-space stratified across frames) once history follows the surface?
2. Is a separate override-material velocity pass the right call here, versus MRT in the main pass (adding a second output to every patched material) or a "previous position" computed in the main vertex shader? Consider the custom skinning and the cost on phones.
3. Is there a simpler route that gets most of the way without motion vectors? For example, more spatial samples per motion frame, alpha-to-coverage with MSAA in motion frames, or a better clamp. Given the characteristics above, which would you pick?
4. For Auto: pitfalls in timing WebGL with rAF (vsync quantisation, 120 Hz displays, background-tab throttling, phone thermal throttling, Firefox/Safari lacking GPU timer queries). What would you measure instead?

Please be concrete and rank the risks.
