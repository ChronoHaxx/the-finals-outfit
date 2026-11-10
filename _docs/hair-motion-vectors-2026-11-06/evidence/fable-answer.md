**Recommendation: keep the velocity pass, but fix three things in the plan before writing it: the disocclusion test, the velocity-pass alpha threshold, and the "one override material" assumption. Those are where it will fail for hashed hair specifically.** The rest is standard TAA and will behave as standard TAA does. Ranked risks first, then your four questions.

## Ranked risks

**1. Depth-based disocclusion against the main pass will reject history on exactly the hair you are fixing.** The main pass depth at a hair pixel is stochastic: the surviving fragment is a different strand, or the face, each frame, so a previous-depth comparison fires constantly and drops the blend back to 0.1–1.0. Grain returns. Take the previous depth from the velocity pass (deterministic, low-threshold alpha test, see risk 2), never from the hashed main pass. Same for any "history is valid" logic in step 3.

**2. Alpha test at 0.5 in the velocity pass gives faint strands, lace and sheer fabric the velocity of what is behind them.** For flyaways over the transparent page that is velocity zero: screen-locked history, same smear and erasure you have now, on the pixels the user is complaining about. Use a low threshold (0.05 or so; anything the dither can actually show), and add the usual closest-depth velocity dilation in the resolve (pick the velocity of the nearest-depth texel in the 3x3). Over-covering is fine: a shoulder behind a ponytail being reprojected with the ponytail's velocity is a few pixels off and the clamp catches it; that is every TAA's silhouette behaviour.

**3. "One override material" won't work.** The static vertex-colour offset applies only to some garments, hashed materials need their own opacity map and UV transform in the velocity pass, props have their own skeletons, and `scene.overrideMaterial` can't vary per object. Build a cache of velocity materials keyed by source material (clone the vertex patches via the same `onBeforeCompile` function, swap in `object.onBeforeRender` or iterate meshes manually). Previous bone matrices: snapshot `skeleton.boneMatrices` after each render (three updates them inside `renderObject`), and on a reset set previous = current. Also decide what the hologram (additive) writes: probably nothing.

**4. The still/motion seam.** Two problems. (a) Your GPU check "history after a change equals a fresh first render" is incompatible with step 3 by construction; limit it to the non-reprojected reset path or drop it. (b) When motion stops, the reprojected EMA has an effective ~20–30 samples and the still path restarts at one: a noise/brightness pop at the end of every drag and every clip, which is the flash you just fixed in a new form. Seed the still history from the EMA (`sum = mean * maxSamples`, `samples = maxSamples / 2` or whatever confidence you assign) rather than resetting. And simplify step 3: camera drag is just motion where only the viewProjection changed, so run the same velocity path during drags instead of inventing a camera-only reprojection that also needs a readable, deterministic depth.

**5. Dither stratification under reprojection.** Your analysis is right but the magnitude is motion-dependent. Under 1 px/frame (the idle sway, most of the user's time) a surface point stays on the same pixel for several frames and sees the stratified rotation. Fast motion (Disco) degrades to random thresholds, where the clamp and the larger blend weight dominate anyway and the eye tolerates more. Do not redesign the dither until you have measured after reprojection. If you do need surface anchoring, you cannot keep the exact 3x3 property; the compromise is screen-space ranks for the spatial guarantee and a surface-hashed (not pixel-hashed) `inside` offset so the temporal sequence a surface point sees is at least decorrelated from its screen path.

**6. Clamp choice.** Hashed samples are bimodal (covered or empty), not Gaussian, so variance clipping with gamma near 1 can reject valid history near band edges. Keep min/max (it is what your 3-periodic design was built for) and try variance clipping only at gamma ≥ 1.5 as an experiment. Clamp all four premultiplied channels; alpha is the coverage estimate and matters more here than YCoCg chroma bounds. Skip YCoCg initially.

**7. Bilinear blur.** Dither-scale detail is noise, not signal; the history is supposed to be the smooth coverage-weighted mean, and bilinear on a smooth image loses little. The real casualty is 1-px flyaways losing contrast over many reprojections. Catmull-Rom plus the clamp's "sharpening" is the usual mitigation; at dpr 2 it should be acceptable. Measure contrast of a known strand over 60 frames.

**8. Phone cost.** A second geometry pass with 8-influence skinning on 20 meshes plus RG16F + depth is vertex-bound; gating it to High is correct. MRT in the main pass is cheaper but cannot write velocity for discarded fragments, so faint strands would get background velocity again (risk 2). A "previous position in the main vertex shader" has the same problem. So the separate pass is the right structure for hashed geometry, and you only need it for the moving tier.

## Q3: simpler routes

Nothing without velocity fixes Disco, but two things are worth doing anyway and may be enough for idle:

- **Dithered alpha-to-coverage, MSAA 4x in the motion frames** (sample target `samples: 4`, `material.alphaToCoverage`, output `alpha + (hash - 0.5)/4` instead of discard). Four coverage sub-samples per pixel cut single-frame variance 4x and also fix the chunky stair-stepped outline, which is an edge-aliasing artefact, not a dither one. Stacking stays independent because the alpha is dithered per fragment. Costs: your patch must defeat three's `OPAQUE` alpha=1 in `opaque_fragment`, check `renderer.capabilities.maxSamples` for RGBA16F, and measure on a phone at dpr 1.5; the blit resolve is not free on tilers.
- **A better test harness.** Your "moving vs paused" metric mixes smear with a pose shift. Build ground truth per frame: step the clip deterministically (fixed-dt SpringBones, snapshot), converge the still accumulator at each pose, then score the motion path frame by frame. Every tuning decision above becomes a number.

If you had to pick one: velocity pass. The idle sway is slow enough that screen-locked EMA almost works, which is why MSAA plus a slightly higher blend might get idle to acceptable; but drags and emotes stay broken, and the user listed all three.

## Q4: Auto tier

Pitfalls, concretely:
- rAF deltas are vsync-quantised, so measure p95 delta against an estimated refresh period, not an average. Estimate the period as the minimum stable delta over the first 30 frames; on ProMotion phones Safari runs rAF at 60 by default, Chrome at 120, and a 120 Hz display that holds 60 is fine. Define "holds" as p95 < 1.5 period at the target rate you actually want, which is 60, not the display rate.
- Warm up first: `renderer.compileAsync` and a few throwaway frames, or you measure shader compilation. Discard frames when `document.hidden` or after a visibility change.
- Step down from High and re-measure; if Low is no faster than High you are CPU-bound (rig, springs, skinning upload) and should not degrade visuals.
- GPU timer queries: Chrome WebGL2 only; do not depend on them.
- Thermal: only ever step down automatically during a session, after a sustained window (say p95 > 1.5 period over 5 s, twice), never up; cache keyed by unmasked renderer string (often generic now, still useful), `devicePixelRatio` and screen size, and let a manual pick win permanently.

Decisions on default tier and whether MSAA's phone cost is acceptable belong to the user; the above is what to measure before asking.

[fable-advisor] thread 2660d499 | answered by claude-fable-5-1 | effort high | 4 in, 12,367 out | about $0.816 this call, $0.83 of $95 so far | credit expires 2026-11-14
