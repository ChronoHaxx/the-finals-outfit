import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  notifyCamera, pendingView, roundView, setCameraHandle, takePendingView, type CameraView, type Vec3,
} from "../lib/camera-view";
import { anyPointerClaimed } from "../lib/pointer-claims";

/**
 * The viewer's camera for controls outside the canvas (21 Nov 2026): the camera panel reads and types its position,
 * target and roll, recalls saved views, and the share button records it (lib/camera-view.ts). Canvas child beside the
 * default OrbitControls (makeDefault), which it reaches through the r3f store.
 *
 * Roll. OrbitControls keep the camera upright: every frame their update() turns it to look at the target with the
 * world's up (y) at the top of the picture. Roll is a turn about the line of sight on top of that, applied after the
 * controls' update (useFrame priority -1) and before the still-view render (priority 1). It is set from scratch each
 * frame (look at the target, then turn), never added on, so it cannot build up. Orbiting is unchanged: a drag still
 * swings around the world's vertical and the horizon stays tilted. Panning follows the tilted picture, because the
 * controls pan along the camera's own axes. Roll 0 leaves the frame exactly as the controls made it.
 *
 * While OrbitControls are off (a scene backdrop that holds the camera still, PR #57) the camera is fixed and left
 * alone: nothing can be typed or recalled, a link's view waits, and no roll is applied, so the scene's fixed framing
 * stays exact. Dragging a light marker (PR #61) also switches the controls off, but only for the drag and while it holds
 * the pointer (lib/pointer-claims.ts): the camera keeps the state it had, so a rolled view stays rolled and a scene
 * stays level.
 */

interface Controls {
  enabled: boolean;
  enableDamping: boolean;
  target: THREE.Vector3;
  update(): boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

// Degrees. Module state, so a Canvas remount (Retry after a lost graphics context) keeps the tilt.
let roll = 0;
let fixed = false;

/** Whether the camera is held still (a scene). Re-read whenever no tool holds the pointer; during a marker drag the
 *  controls are off for the drag only, so the answer from before the drag stands. */
function cameraFixed(controls: Controls): boolean {
  if (!anyPointerClaimed()) fixed = !controls.enabled;
  return fixed;
}

// The camera as drawn. While it is fixed no roll is applied, so it reads 0 (the held roll returns afterwards).
const liveView = (camera: THREE.Camera, controls: Controls): CameraView => roundView({
  position: camera.position.toArray() as Vec3, target: controls.target.toArray() as Vec3,
  roll: cameraFixed(controls) ? 0 : roll,
});

/** Moves the camera to a view and holds it there. Its position and target go through the controls, so the orbit's
 *  limits still hold (the distance range, never straight over the top) and the controls' own state agrees with it. */
function place(camera: THREE.Camera, controls: Controls, wanted: CameraView) {
  const view = roundView(wanted);
  // A drag leaves inertia (damping) that would carry the camera on after the jump, or past a view just saved. One
  // update with damping off spends what is left of it; then the camera is placed. Both happen before the next frame.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.target.set(...view.target);
  camera.position.set(...view.position);
  controls.update();
  controls.enableDamping = damping;
  roll = view.roll;
  notifyCamera();
}

export function CameraBridge() {
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as unknown as Controls | null;
  const invalidate = useThree(s => s.invalidate);
  const wasFixed = useRef<boolean | null>(null);

  useEffect(() => {
    if (!controls) return;
    setCameraHandle({
      get: () => liveView(camera, controls),
      set: view => {
        if (cameraFixed(controls)) return false;
        place(camera, controls, view);
        invalidate();
        return true;
      },
      locked: () => cameraFixed(controls),
    });
    const changed = () => notifyCamera();
    controls.addEventListener("change", changed);
    return () => {
      controls.removeEventListener("change", changed);
      setCameraHandle(null);
    };
  }, [camera, controls, invalidate]);

  useFrame(() => {
    if (!controls) return;
    // The panel says when the camera is held still, so it hears when that changes.
    const isFixed = cameraFixed(controls);
    if (isFixed !== wasFixed.current) { wasFixed.current = isFixed; notifyCamera(); }
    if (isFixed) return;
    // A link's view (lib/camera-view.ts) waits for a camera that can move.
    if (pendingView()) place(camera, controls, takePendingView()!);
    if (!roll) return;
    camera.lookAt(controls.target);
    camera.rotateZ(-THREE.MathUtils.degToRad(roll)); // positive roll tilts the camera clockwise
  });

  return null;
}
