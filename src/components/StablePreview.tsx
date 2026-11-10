import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { StableFrameAccumulator, type AccumulatorQuality } from '../rig/StableFrameAccumulator';
import type { AntiAliasing } from '../lib/graphics-quality';
import type { TemporalStatusRef } from './GraphicsSetting';

// isMoving (showcase animation): while an animation moves the pose every frame, the accumulator switches to its
// motion mode (a running average, see StableFrameAccumulator) instead of resetting to one grainy sample per frame; a
// paused or still pose converges as before.
// Anti-aliasing (10 Nov): TAA reprojects the moving average with motion vectors on every graphics preset (the
// screen-locked average smeared garment print on Balanced and Low). MSAA and Off draw unjittered samples, MSAA with 4
// samples per pixel, and never take the motion path: a moving frame is drawn fresh; a still one still averages its
// alpha-hash coverage. ?quality=high|balanced overrides TAA's accumulator path, for test rigs and comparisons
// (balanced = the old screen-locked average).
const QUALITY_OVERRIDE = (() => {
  const value = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('quality');
  return value === 'high' || value === 'balanced' ? value : null;
})();

// Dev-only tuning of the reprojected average: ?rpBlend= (alpha-hashed history weight), ?rpCubic=0, ?rpOpaque= and
// ?rpOpaqueFast= (opaque history weight, still and at 4 px/frame), ?rpReset=0 (keep opaque history across depth changes).
const TUNING = (() => {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return null;
  const p = new URLSearchParams(window.location.search);
  const weight = (name: string) => { const value = Number(p.get(name)); return p.has(name) && Number.isFinite(value) && value > 0 && value <= 1 ? value : null; };
  return { blend: weight('rpBlend'), cubic: p.get('rpCubic') !== '0', opaque: weight('rpOpaque'), opaqueFast: weight('rpOpaqueFast'), reset: p.get('rpReset') !== '0' };
})();

export function StablePreview({ isMoving, aa = 'taa', statusRef }: {
  isMoving?: () => boolean; aa?: AntiAliasing;
  /** Shares the accumulator's status (the Auto graphics measurer and the FPS counter read it). */
  statusRef?: TemporalStatusRef;
} = {}) {
  const accumulator = useMemo(() => {
    const made = new StableFrameAccumulator();
    // Every outfit goes through the accumulator, so the canvas needs no multisampled back buffer (CharacterViewer).
    made.alwaysOn = true;
    if (TUNING) {
      if (TUNING.blend) made.reprojection.blend = TUNING.blend;
      if (TUNING.opaque) made.reprojection.opaqueBlend = TUNING.opaque;
      if (TUNING.opaqueFast) made.reprojection.opaqueFastBlend = TUNING.opaqueFast;
      made.reprojection.cubic = TUNING.cubic; made.reprojection.opaqueReset = TUNING.reset;
    }
    return made;
  }, []);
  useEffect(() => {
    if (statusRef) statusRef.current = accumulator.status;
    const host = window as unknown as { __temporalPreview?: typeof accumulator.status };
    if (import.meta.env.DEV) host.__temporalPreview = accumulator.status;
    return () => {
      if (host.__temporalPreview === accumulator.status) delete host.__temporalPreview;
      if (statusRef?.current === accumulator.status) statusRef.current = null;
      accumulator.dispose();
    };
  }, [accumulator, statusRef]);
  // Run after controls, skinning and ContactShadows. Positive priority owns the
  // canvas draw; the accumulator also renders directly when it cannot run (no float targets).
  useFrame(({ gl, scene, camera }) => {
    const taa = aa === 'taa', moving = isMoving?.() ?? false;
    const quality: AccumulatorQuality = taa ? QUALITY_OVERRIDE ?? 'high' : 'balanced';
    accumulator.quality = quality;
    accumulator.jitter = taa;
    accumulator.msaaSamples = aa === 'msaa' ? 4 : 0;
    accumulator.render(gl, scene, camera, true, taa && moving, moving);
  }, 1);
  return null;
}
