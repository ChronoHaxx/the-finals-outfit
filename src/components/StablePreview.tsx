import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { StableFrameAccumulator } from '../rig/StableFrameAccumulator';

// isMoving (showcase animation): while an animation moves the pose every frame, the accumulator switches to its
// motion mode (a clamped running average, see StableFrameAccumulator) instead of resetting to one grainy sample per
// frame; a paused or still pose converges as before.
export function StablePreview({ isMoving }: { isMoving?: () => boolean } = {}) {
  const accumulator = useMemo(() => new StableFrameAccumulator(), []);
  useEffect(() => {
    const host = window as unknown as { __temporalPreview?: typeof accumulator.status };
    if (import.meta.env.DEV) host.__temporalPreview = accumulator.status;
    return () => {
      if (host.__temporalPreview === accumulator.status) delete host.__temporalPreview;
      accumulator.dispose();
    };
  }, [accumulator]);
  // Run after controls, skinning and ContactShadows. Positive priority owns the
  // canvas draw; the accumulator also renders directly when no masked item exists.
  useFrame(({ gl, scene, camera }) => accumulator.render(gl, scene, camera, true, isMoving?.() ?? false), 1);
  return null;
}
