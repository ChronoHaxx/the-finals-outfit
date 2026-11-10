# Hair motion vectors and the Graphics setting (6 Nov 2026)

Branch `claude/hair-motion-vectors-2026-11-06`, based on main `0e272b0`. The user waived the functional checks on
10 Nov ("i didnt check but just ship it"); see `functional-checklist.md`.

## The problem

The user: "the hair grain happens on any movement even on emote movement, not just when camera settling".

Alpha-hashed surfaces draw each frame as a dither and need averaging. The moving view's average (motion mode, 5 Nov)
was screen-locked: each pixel averaged whatever passed through it. Moving hair therefore smudged, or the clamp threw
the history away and the raw dots showed. The still view restarted from one sample on every camera step while a drag
eased out. Evidence before any fix: `../showcase-animation-2026-11-05/hair-grain-2026-11-06/`.

## What changed

1. **Motion vectors** (`src/rig/VelocityPass.ts`). One extra geometry render per moving frame, into a half-float
   target. Each mesh is drawn by a small velocity material:
   - screen motion since last frame (r, g);
   - view depth (b; negative for alpha-hashed materials);
   - the same point's view depth last frame (a).

   Details:
   - Skinning is evaluated with this frame's and last frame's bones, including the 8-influence extension. Morph
     targets are applied first.
   - Skinned meshes pair last frame's `matrixWorld x bindMatrixInverse`, because three's attached bind mode
     recomputes the inverse from the world matrix.
   - Cards are drawn whole (no alpha test), so faint strands carry the hair's motion.
   - Invisible sections and additive holograms are skipped. Render callbacks are suspended so the gems' extra passes
     do not land in the target.
   - The two targets are made on the first moving frame and released once the still view converges.
2. **Reprojected average** (`StableFrameAccumulator`, quality `high`):
   - Each pixel's history is read from where its surface was, with a Catmull-Rom read. The motion is taken from the
     nearest surface in the 3x3 neighbourhood.
   - The clamp is trusted away only where three things hold:
     - the neighbourhood moves together (within a quarter pixel);
     - last frame's depth at the reprojected spot matches;
     - a surface is drawn somewhere in the 3x3.
   - Trusted dithered pixels keep only the clamp's upper bound. Everything else, and every opaque surface, keeps the
     full clamp. The blend is 1/16.
3. **Drags and seeks in a still pose** take the same path:
   - `StableFrameState` reports `reprojectable` when only camera, object or bone matrices changed, bind matrices
     included.
   - The motion path runs on for 4 quiet frames after the last change.
   - The still view then takes over as a crossfade from the moving average (still weight = samples / 32), so the end
     of a drag or a clip has no pop. The converged frame is exactly the still path's.
   - Entering motion from a still frame seeds the average with it.
4. **Dither for stacked layers** (`AlphaHashSampling`, motion frames, both qualities). Each layer now walks the nine
   bands in its own affine order, re-drawn every 9-frame cycle. Before, layers stepped together a fixed number of
   bands apart. The wrap is now 576 frames (whole cycles).
5. **Graphics setting** (`src/lib/graphics-quality.ts`, `src/components/GraphicsSetting.tsx`): a dropdown beside the
   Studio/Lobby button.

   | Tier | What it is |
   | --- | --- |
   | High | Motion vectors, up to 2x pixel density |
   | Balanced | Exactly the view as shipped before this change |
   | Low | Balanced at 1x |
   | Auto (default) | Measured on the device, as below |

   How Auto works:
   - It starts at High, or Balanced on a coarse-pointer device (phones, tablets).
   - It judges the 95th-percentile frame time while the view moves, after the outfit has loaded and a 60-frame warm-up.
   - It steps down when that frame time is over 1.5 x 1/60 s in two windows in a row. One window alone can be a
     passing spike of background load, and a step down is remembered. It never steps up.
   - It undoes a step that did not make frames at least 10% faster, because that means the processor is the limit.
   - The result is remembered per device. A hand-picked tier always wins.
   - `?quality=high|balanced` overrides the accumulator for test rigs.
6. **Test clock** (`AnimationControls` `frameClock`, `window.__rigAnim.clock`): a fixed 1/60 s step per frame,
   freeze at a step, and `frozenMoving`. Its defaults leave the app unchanged.

## How it was found (each step measured)

All error figures are luma levels (/255) of the frame over white, measured against ground truth.

- **The pause-and-compare probe overstated the error.** Its numbers mixed in the pause's own pose shift. A
  deterministic rig (`scripts/anim-export/probe-truth.mjs`, `probe-truth-drag.mjs`) replays a clip with fixed steps.
  For the reference it freezes at each scored step and lets the still path converge. Idle hair error read 9 levels, not
  23.
- **First reprojection version (clamp everywhere): idle hair 9.2 → 6.3.** Changing the blend weight or the history
  filter moved nothing. A held pose drawn on the moving path converged 6.8 levels off and 2-3 levels too dark.
- **The cause was the clamp.** Stacked dithered layers often cover a whole 3x3 window in one frame, so the clamp's
  lower bound ratcheted coverage up. Two 50% planes came out at 0.86-0.90 combined instead of 0.75
  (`probe-stack-union.mjs`). The fixed band offsets between layers added a smaller fixed pattern.
- **Three traps on the way, each fixed and measured:**
  - Trusting agreeing motion alone left ghost trails of a dancing character on the background: Disco whole-character
    error 19.75. The fix was the previous-depth check plus the surface-in-3x3 rule.
  - Dilated motion painted ghosts just outside silhouettes.
  - A swinging ponytail dragged the shirt seen through its gaps. The fix was the upper bound for trusted dithered
    pixels, with the full clamp for opaque surfaces.
- **A turning character never reprojected:** `bindMatrixInverse` changes with the world matrix in attached bind mode.
  The same fact meant the shader needed last frame's pair.
- **Fable review** (plan, before building; $0.82; `evidence/fable-*.md`). It shaped:
  - the velocity-pass depth for the uncovering check;
  - no alpha test in the velocity pass;
  - per-material velocity materials;
  - the crossfade into the still view;
  - routing drags through the same path;
  - the ground-truth rig;
  - the Auto rules.

## Results (final code; `evidence/truth-*.json`)

| Case | Balanced (as shipped): hair / whole character | High: hair / whole character |
| --- | --- | --- |
| Idle, ponytail close-up | 9.05 / 3.31 | 6.63 / 2.31 |
| Disco (emote "C'est la vie") | 13.75 / 7.06 | 11.12 / 5.69 |
| Drag, all steps | 16.34 / 3.00 | 12.96 / 3.45 |
| Drag settling (steps 45, 70) | 17.0, 17.2 / 2.8 | 8.2, 5.3 / 1.9, 1.1 |
| Held pose on the moving path (hair core) | 6.8 | 4.7-5.2 |

- **Seen at full size** (`scripts/generated/anim-export/hair-mv-captures/`):
  - On the idle, High shows the ponytail's strands and a clean fringe edge; Balanced is dotted and smudged.
  - On drags, Balanced's hair is salt-and-pepper while High's is smooth.
  - On Disco's fastest swing, High still shows a faint pale band along the ponytail. Balanced shows the same: one
    motion per pixel cannot follow both a strand and what shows through its gaps.
- **Drag cost:** during the fastest part of a drag, High is slightly softer than one raw frame (whole-character error
  4.4-4.8 against 3.0).
- **Frame cost** (`evidence/frame-cost.mjs`, output in `evidence/frame-cost.out.txt`; headless Chrome on this
  RTX 3080, idle playing, 608 px canvas). High costs about 1 ms more per frame:

  | Run | Balanced median / p95 (ms) | High median / p95 (ms) | Low median / p95 (ms) |
  | --- | --- | --- | --- |
  | Quiet machine | 10.6-10.7 / 12.0-12.7 | 11.7-12.5 / 13.0-14.8 | 10.6 / 11.7 |
  | Busy machine (other sessions) | 14.2-14.9 / 16.0-16.7 | 14.6-15.9 / 16.4-32.6 | 14.4 / 16.6 |

  The busy run's one 32.6 ms High window sat between smooth ones. Auto would have stepped a fast PC down for good on
  it, so Auto now needs two slow windows in a row from the start (it needed only one at first before).

## Checks

| Check | Result |
| --- | --- |
| GPU: `check-temporal-preview.mjs` (still path) | 102 pass, unchanged |
| GPU: `check-motion-resolve.mjs` (Balanced motion) | 38 pass |
| GPU: `scripts/anim-export/check-reprojection.mjs` (new) | 19 pass, three runs in a row |
| Unit tests | 690 pass; 8 known model-fixture failures; 5 skipped |
| Typecheck | clean |
| Production build | builds |

- The new reprojection checks (`evidence/reprojection-gpu.json`) cover:
  - stacked coverage;
  - a moving checker card: 0.0057 against Balanced's 0.0231;
  - no ghost behind a crossing card;
  - a skinned card turned by its parent: 0.0144 against 0.0419;
  - the hand-over jump: 0.0076 against 0.239, converging to exactly the still frame;
  - which changes reproject and which reset;
  - no target leaks.
- One earlier run of the reprojection checks failed without its error being kept, most likely a page-load timeout
  straight after the heavy truth runs.
- New unit tests: `tests/rig/stable-frame-reprojectable.test.ts` and `tests/graphics-quality.test.ts`. Two existing
  tests were updated for the new contracts: the 576-frame wrap, and the extra `reprojectable` field.
- Graphics UI, headless (`evidence/check-graphics-ui.mjs`; rerun after the two-window change, `check-graphics-ui.out.json`):
  - Auto · High on this desktop, kept after measuring;
  - each tier switches the accumulator;
  - the choice is remembered;
  - no page errors.

### After merging main (10 Nov, merge `be75f9b`, main `cd14c85`)

Main had gained full-screen mode (PR #27) and saved outfits (PR #29). The one conflict was the viewer's top-right
button row. Resolution: main's layout, with the Graphics dropdown first. It is left out in full screen, where the wider
"Exit full screen" button needs the room. Re-run on the merged code:

| Check | Result |
| --- | --- |
| Typecheck | clean |
| Unit tests | 743 pass; the same 8 model-fixture failures; 5 skipped |
| Production build | builds |
| `check-reprojection.mjs` | 19 pass, same numbers |
| `check-graphics-ui.mjs` | Auto · High kept, tiers switch, choice saved, no page errors |

The browser pane, without `?reconstructed=1`:
- At desktop width the button row takes 288 of the viewer's 410 px.
- At 375 px phone width (coarse pointer) it reads "Auto · Balanced" and fits within the viewer.
- Full screen hides the dropdown, and leaving brings it back.

## Known limits

- Fast swings of semi-transparent hair keep a faint trailing band.
- Faint strands below 1/9 opacity thin out while moving (as before).
- Balanced keeps its screen-locked clamp, and with it the stacked-layer ratchet (unchanged from what shipped).
- The velocity pass skips the recovered garments' static vertex offset (at most about a centimetre along the normal).
