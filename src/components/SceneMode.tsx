import { Component, lazy, Suspense, useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { create } from "zustand";
import { backdropCss } from "../lib/stage-lighting";
import { SCENE_FOV_MIN, plateScale, sceneUrl, wrapAngle, type SceneDef } from "../lib/scenes";

/**
 * Turntable mode for in-game scene backdrops (scenes.ts; design in _docs/scene-backdrops-2026-11-12/README.md section 4).
 *
 * Why the camera may not move: a backdrop drawn from one camera position stays right only while the camera keeps that
 * position. Turning about the vertical axis is the same as the character turning on the spot, so instead of orbiting
 * the camera we turn the character (rig.root about Y), as the game's menu does. Zoom narrows the field of view, which
 * is a pure scale about the view's centre: a plate scaled by the same factor stays exact (a dolly would not).
 *
 * The lights stay fixed in the world, so as the character turns its lighting changes against the backdrop's, as in the
 * game. Leaving scene mode puts the turn back to exactly 0 and the camera back where it was, so the default view is
 * pixel for pixel what it was before.
 */

/** The turntable's live state, for the stage canvas and the plate (outside the main Canvas). */
export const useSceneView = create<{ fov: number | null }>(() => ({ fov: null }));

/** The character's current turn (radians); 0 outside scene mode. One owner: SceneTurntable. */
let turnedRoot: THREE.Object3D | null = null;

/**
 * Run `draw` with the character facing forward (turn 0): the share card's views and the 3D export are placed at world
 * angles. Synchronous draws only; the export holds it over its frames with `holdUpright`.
 */
export function withUpright<T>(draw: () => T): T {
  const root = turnedRoot, yaw = root?.rotation.y ?? 0;
  if (!root || yaw === 0) return draw();
  root.rotation.y = 0;
  root.updateMatrixWorld(true);
  try { return draw(); } finally { root.rotation.y = yaw; root.updateMatrixWorld(true); }
}

/** For a multi-frame job: face forward now; the returned function puts the turn back. */
export function holdUpright(): () => void {
  const root = turnedRoot, yaw = root?.rotation.y ?? 0;
  if (!root || yaw === 0) return () => {};
  root.rotation.y = 0;
  return () => { if (turnedRoot === root) root.rotation.y = yaw; };
}

interface ControlsLike { enabled: boolean; target: THREE.Vector3; update(): void }

const DRAG_RADIANS_PER_PIXEL = 0.01; // about the feel of OrbitControls' rotate at this distance
const KEY_STEP = THREE.MathUtils.degToRad(15);

/** Canvas child, mounted only while a scene is shown. Place it after OrbitControls (it needs the default controls). */
export function SceneTurntable({ scene, root }: { scene: SceneDef; root: THREE.Object3D }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree(s => s.controls) as unknown as ControlsLike | null;
  const element = useThree(s => s.gl.domElement);
  const invalidate = useThree(s => s.invalidate);

  useEffect(() => {
    const saved = { position: camera.position.clone(), fov: camera.fov, zoom: camera.zoom,
      target: controls?.target.clone() ?? null };
    const { position, target, fov: sceneFov } = scene.camera;
    const setFov = (fov: number) => {
      camera.fov = THREE.MathUtils.clamp(fov, SCENE_FOV_MIN, sceneFov);
      camera.updateProjectionMatrix();
      useSceneView.setState({ fov: camera.fov });
      invalidate();
    };
    camera.position.set(...position);
    camera.zoom = 1;
    if (controls) { controls.target.set(...target); controls.update(); controls.enabled = false; }
    camera.lookAt(...target);
    setFov(sceneFov);
    turnedRoot = root;
    // Dev builds: the viewer's camera and controls on window, to check the exact restore when the scene is left.
    if (import.meta.env.DEV) Object.assign(window, { __viewerCamera: camera, __viewerControls: controls });

    const turn = (radians: number) => { root.rotation.y = wrapAngle(root.rotation.y + radians); invalidate(); };
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: number | null = null;
    const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      element.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pinch = pointers.size === 2 ? spread() : null;
    };
    const move = (event: PointerEvent) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const dx = event.clientX - last.x;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) turn(dx * DRAG_RADIANS_PER_PIXEL);
      else if (pointers.size === 2 && pinch) {
        const now = spread();
        if (now > 0) setFov(camera.fov * pinch / now);
        pinch = now;
      }
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      pinch = pointers.size === 2 ? spread() : null;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setFov(camera.fov * Math.exp(event.deltaY * 0.0008)); // about 8% a wheel notch
    };
    // Arrow keys turn the character, unless a control has the focus (a slider, a field, a list).
    const key = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [role=slider], [role=listbox], [contenteditable=true]")) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      turn(event.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP);
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
      // Leaving the scene: the character faces forward exactly, the camera goes back where it was.
      if (turnedRoot === root) turnedRoot = null;
      root.rotation.y = 0;
      camera.position.copy(saved.position);
      camera.fov = saved.fov;
      camera.zoom = saved.zoom;
      camera.updateProjectionMatrix();
      if (controls) { if (saved.target) controls.target.copy(saved.target); controls.enabled = true; controls.update(); }
      useSceneView.setState({ fov: null });
      invalidate();
    };
  }, [scene, root, camera, controls, element, invalidate]);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// What is drawn behind the character.

const StageCanvas = lazy(() => import("./SceneStage"));

/** A scene that fails to load (offline, a missing file, no second graphics context) leaves the fallback colours. */
class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn("[scene] the scene could not be shown; its colours stay", error); }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * The layer behind the viewer's canvas for a scene: the plate as a CSS background (fitted by height, so its horizon and
 * floor stay where the camera put them on any window width; wider windows show the fallback at the sides), or the live
 * stage in its own canvas. The fallback gradient is underneath both, so a slow or failed load shows the scene's colours.
 */
export function SceneBackdrop({ scene }: { scene: SceneDef }) {
  const fov = useSceneView(s => s.fov) ?? scene.camera.fov;
  const style = useMemo<CSSProperties>(() => {
    const fallback = backdropCss(scene.fallback);
    if (scene.kind !== "plate" || !scene.plate) return { background: fallback };
    const scale = plateScale(fov, scene.camera.fov);
    return {
      backgroundImage: `url("${sceneUrl(scene.plate.file)}"), ${fallback}`,
      backgroundSize: `auto ${(scale * 100).toFixed(3)}%, cover`,
      backgroundPosition: "center, center",
      backgroundRepeat: "no-repeat, no-repeat",
    };
  }, [scene, fov]);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={style}>
      {scene.kind === "stage" && <SceneErrorBoundary key={scene.id}>
        <Suspense fallback={null}><StageCanvas scene={scene} /></Suspense>
      </SceneErrorBoundary>}
    </div>
  );
}
