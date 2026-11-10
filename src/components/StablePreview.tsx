import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { StableFrameAccumulator, type AccumulatorQuality } from '../rig/StableFrameAccumulator';

// isMoving (showcase animation): while an animation moves the pose every frame, the accumulator switches to its
// motion mode (a clamped running average, see StableFrameAccumulator) instead of resetting to one grainy sample per
// frame; a paused or still pose converges as before.
// quality (6 Nov): 'high' reprojects the moving average with motion vectors (StableFrameAccumulator, VelocityPass);
// 'balanced' is the screen-locked average. ?quality=high|balanced overrides it, for test rigs and comparisons.
const QUALITY_OVERRIDE = (() => {
  const value = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('quality');
  return value === 'high' || value === 'balanced' ? value : null;
})();

const TUNING = (() => {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return null;
  const p = new URLSearchParams(window.location.search), blend = Number(p.get('rpBlend'));
  return { blend: Number.isFinite(blend) && blend > 0 && blend <= 1 ? blend : null, cubic: p.get('rpCubic') !== '0' };
})();

export function StablePreview({ isMoving, quality = 'balanced', statusRef }: {
  isMoving?: () => boolean; quality?: AccumulatorQuality;
  /** Shares the accumulator's status (the Auto graphics measurer reads whether the view is moving). */
  statusRef?: { current: { motion: boolean } | null };
} = {}) {
  const accumulator = useMemo(() => {
    const made = new StableFrameAccumulator();
    if (TUNING) { if (TUNING.blend) made.reprojection.blend = TUNING.blend; made.reprojection.cubic = TUNING.cubic; }
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
  // canvas draw; the accumulator also renders directly when no masked item exists.
  useFrame(({ gl, scene, camera }) => {
    accumulator.quality = QUALITY_OVERRIDE ?? quality;
    accumulator.render(gl, scene, camera, true, isMoving?.() ?? false);
  }, 1);
  return null;
}
