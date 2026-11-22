import * as THREE from "three";

/**
 * On-screen-only helpers in the 3D view (21 Nov 2026: the light markers, LightMarkers.tsx).
 *
 * They are kept out of every picture the site makes by three's layers, not by remembering to hide them: each helper is
 * on OVERLAY_LAYER only, and an object is drawn only by a camera that has its layer switched on. The live view's camera
 * switches it on while the helpers are shown; every other camera starts with layer 0 alone:
 * - the share card draws from new cameras of its own (SharePreviewRender);
 * - the contact shadow and the sun's shadow map use their own cameras, and the helpers cast nothing;
 * - the 3D export writes the character's own objects, never the scene round it;
 * - the screenshot copies the live camera (copying its layers), so it switches the layer off on its copy:
 *   withoutOverlays below.
 * The still view's motion pass (VelocityPass) skips their materials (userData.viewerOverlay true, a fresh object per
 * material), so a marker never stands in for the surface behind it when the view reprojects.
 */
export const OVERLAY_LAYER = 30;

/** A capture camera that cannot see the on-screen helpers (changes and returns it). */
export function withoutOverlays<T extends THREE.Camera>(camera: T): T {
  camera.layers.disable(OVERLAY_LAYER);
  return camera;
}
