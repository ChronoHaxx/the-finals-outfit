// The animation frame clock for test rigs (moved out of components/AnimationControls.tsx, 21 Nov 2026, so the
// per-character animation binding and the frame driver share it without an import cycle).

/**
 * Capture clock for test rigs (6 Nov 2026), reached through window.__rigAnim.clock. `fixed` replaces each frame's
 * real time step with a fixed one, so a run plays the same poses on every machine and at any frame rate. `steps` counts
 * the animator updates. Once `steps` reaches `freezeAt` the animation holds (no further updates) and the view counts as
 * still, so the still path converges on exactly that pose: a ground-truth frame to score the moving frames against.
 * The defaults (real time, never frozen) leave the app unchanged.
 */
export const frameClock = { fixed: null as number | null, freezeAt: Infinity, steps: 0, frozenMoving: false };
export const clockFrozen = () => frameClock.steps >= frameClock.freezeAt;
/** Frozen but still drawn as moving (`frozenMoving`): what the moving view converges to on a pose that holds. */
export const clockHeldStill = () => clockFrozen() && !frameClock.frozenMoving;
