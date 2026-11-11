/**
 * Is JavaScript running without the JIT? (10 Nov 2026, feedback: Microsoft Edge "so broken", "horrid performance".)
 *
 * Edge's "Enhance your security on the web" runs sites the visitor rarely opens without the JavaScript JIT compiler (and
 * with WebAssembly interpreted). This page spends most of each frame in JavaScript (animation, skinning matrices, the
 * accumulator's bookkeeping: about 14 ms on a fast desktop), so without the JIT it crawls. Measured on one desktop
 * (headless, a frame-shaped loop of Float32Array maths and small objects): Chrome 1.4 ms, Edge 2.5 ms; with V8's
 * optimising tiers switched off, as that mode does, 23.3 and 25.1 ms.
 *
 * `scriptSpeedMs` runs that loop three times and keeps the fastest run (the first can include warm-up). Cached.
 */
let cached: number | null = null;

function loop(): number {
  const t0 = performance.now();
  const m = new Float32Array(16 * 400);
  let acc = 0;
  for (let frame = 0; frame < 60; frame++) {
    for (let b = 0; b < 400; b++) {
      const o = { x: Math.sin(b + frame), y: Math.cos(b * 0.5), z: b * 0.001 };
      for (let k = 0; k < 16; k++) m[b * 16 + k] = o.x * k + o.y * (16 - k) + o.z;
      acc += m[b * 16 + (frame & 15)];
    }
  }
  // Keep the result observable so the loop cannot be optimised away.
  if (acc === Number.MIN_VALUE) console.debug(acc);
  return performance.now() - t0;
}

export function scriptSpeedMs(): number {
  if (cached === null) cached = Math.min(loop(), loop(), loop());
  return cached;
}

/** The loop takes this long or more only without a JIT (a JIT-compiled run on a slow phone stays well under it). */
export const NO_JIT_MS = 12;

export const isEdge = () => typeof navigator !== "undefined" && /\bEdg(A|iOS)?\//.test(navigator.userAgent);
