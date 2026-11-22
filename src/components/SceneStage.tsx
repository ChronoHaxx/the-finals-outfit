import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { SceneDef } from "../lib/scenes";
import { useSceneView } from "./SceneMode";

/**
 * The live stage of a "stage" scene, in a canvas of its own BEHIND the viewer's transparent canvas (loaded only when a
 * stage scene is picked, as its own chunk). Why a second canvas instead of drawing the stage inside the viewer's:
 * - the viewer's still-view accumulator tone-maps and averages everything it draws, and restarts whenever anything in
 *   its scene changes; an animated stage would keep restarting it, so hair and lace would never settle;
 * - the browser already composites the viewer's canvas (premultiplied colour and alpha) over whatever is behind it,
 *   exactly as it does over the CSS gradient today, additive holograms included; the default path is untouched;
 * - the stage chooses its own tone curve for its self-lit planes.
 * The cost is a second WebGL context while a stage is shown. Its camera copies the viewer's turntable camera (fixed
 * position, the zoom's field of view).
 */

const STAGES: Record<string, ComponentType> = {
  "s12-menu": lazy(() => import("../scenes/s12-menu")),
};

function usePrefersReducedMotion(): boolean {
  const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [reduced, setReduced] = useState(() => !!query?.matches);
  useEffect(() => {
    if (!query) return;
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [query]);
  return reduced;
}

/** Keeps the stage camera on the scene camera, with the turntable's field of view. */
function StageCamera({ scene }: { scene: SceneDef }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree(s => s.invalidate);
  const fov = useSceneView(s => s.fov) ?? scene.camera.fov;
  useEffect(() => {
    camera.position.set(...scene.camera.position);
    camera.lookAt(...scene.camera.target);
    camera.fov = fov;
    camera.near = 0.1;
    camera.far = 200;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, scene, fov, invalidate]);
  return null;
}

/**
 * Light adds linearly, but three converts each material's colour to sRGB inside its own shader when it draws straight
 * to the screen, so overlapping glowing layers would be summed in sRGB and clip (measured 12-15 Nov: the A, the wall and
 * the haze, each right alone, summed to white). So the stage is drawn into a linear half-float target (4x MSAA) and
 * converted to the screen once, by the output pass.
 */
function StageComposer() {
  const gl = useThree(s => s.gl), scene = useThree(s => s.scene), camera = useThree(s => s.camera);
  const size = useThree(s => s.size), dpr = useThree(s => s.viewport.dpr);
  const composer = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const c = new EffectComposer(gl, target);
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new OutputPass());
    return c;
  }, [gl, scene, camera]);
  useEffect(() => { composer.setPixelRatio(dpr); composer.setSize(size.width, size.height); }, [composer, size, dpr]);
  useEffect(() => () => composer.dispose(), [composer]);
  useFrame((_, delta) => composer.render(delta), 1); // priority 1: this replaces r3f's own render
  return null;
}

export default function SceneStage({ scene }: { scene: SceneDef }) {
  const Stage = STAGES[scene.id];
  const reduced = usePrefersReducedMotion();
  if (!Stage) return null;
  return (
    <Canvas
      className="!absolute inset-0"
      // Animated (the game's glitch and smoke), unless the viewer asked for reduced motion: then one still frame.
      frameloop={reduced ? "demand" : "always"}
      // Self-lit, soft and mostly out of focus in the game: no need for the full device resolution.
      dpr={[1, 1.5]}
      camera={{ position: scene.camera.position, fov: scene.camera.fov, near: 0.1, far: 200 }}
      // No tone curve: the stage's colours are written to match the screenshot as it is on screen.
      gl={{ antialias: true, alpha: false, powerPreference: "low-power", toneMapping: THREE.NoToneMapping,
        outputColorSpace: THREE.SRGBColorSpace }}
      onCreated={({ gl }) => gl.setClearColor(0x010208, 1)}
    >
      <StageCamera scene={scene} />
      <StageComposer />
      <Suspense fallback={null}><Stage /></Suspense>
    </Canvas>
  );
}
