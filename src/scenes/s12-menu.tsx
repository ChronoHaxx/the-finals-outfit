import { useEffect, useMemo, type ReactNode } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { sceneUrl } from "../lib/scenes";

/**
 * THE FINALS' Season 12 main-menu stage (BP_BackgroundStage_S12 in MainMenu_S12_None), rebuilt from the level's own
 * placements and its materials' parameter values (_docs/scene-backdrops-2026-11-12/README.md section 7), and tuned
 * against the user's in-game screenshot by measuring colours. Every piece gives off its own light, so nothing is lit or
 * baked here.
 *
 * Where things are: the level's numbers in Blender's frame (metres; x away from the menu camera, y to its left, z up),
 * moved so the character's spot (FrontendCharacter_0 at x 4.21) is the viewer's origin and the stage lies behind it,
 * towards -Z (`at` below). The pieces, back to front:
 * - a 24 m plane carrying the THE FINALS "A" (MI_Frontend_TitleLED: the logo mask through LED dots, 360 across, cyan,
 *   scan bands, an occasional glitch with a colour split), 13.7 m behind the character, its base on the floor;
 * - a 22 m plane of soft white lights on a square grid (MI_Frontend_HomeScreenLights), just behind the A;
 * - an animated smoke plane (MI_FogPlane_Background) in front of both;
 * - the screen wall (MI_FrontendScreen_Main_S12): a half-cylinder of 16 m radius round the camera, a dark blue screen
 *   the A shows through. In the game the A's colour on screen already includes the wall's light, so the A adds only
 *   the difference (measured: the A alone and the wall alone each matched the screenshot, together they overshot);
 * - the LED floor half-circle (MI_Frontend_FloorLED; its bright rim is the thin line along the floor);
 * - low haze over the backdrop's base (MI_FakeFog_03; in the game a plane in front of the character that fades with the
 *   depth behind it, so it shows over the distant backdrop; here placed behind the character to do the same);
 * - a near-black glossy floor (MI_MainStageFloor). Its reflection is every glowing layer drawn again mirrored below the
 *   floor line, which is exactly what a mirror shows, softened (dots averaged, lights widened) and weighted like a
 *   glossy surface: faint looking down, strong at grazing angles near the horizon. No extra render pass.
 * Not drawn: the scaffold pillars (10 m to the sides, behind the wall) and the grid plane (behind the dark back panel).
 *
 * The approximations are deliberate: the game's materials were not decompiled (a scene is a backdrop, not an item), so
 * the patterns are written from the parameter names and values.
 */

const CHARACTER_X = 4.21; // the character's spot in the level (Blender x)
const at = (bx: number, by: number, bz: number): [number, number, number] => [-by, bz, -(bx - CHARACTER_X)];

const COMMON = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform float uTime;
  uniform float uMirror; // 1 for the floor-reflection copy of a layer
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
  // Round LED dots on a square grid, one per unit of p; anti-aliased, and faded to their average coverage once a dot
  // gets smaller than about a pixel (otherwise a far or oblique screen shimmers in moire), and always in a reflection.
  float ledDots(vec2 p, float radius) {
    vec2 f = fract(p) - 0.5;
    float d = length(f);
    float w = max(fwidth(d), 1e-4);
    float dot_ = 1.0 - smoothstep(radius - w, radius + w, d);
    float size = max(fwidth(p.x), fwidth(p.y));
    return mix(dot_, 3.14159 * radius * radius, max(smoothstep(0.35, 0.8, size), uMirror));
  }
  // The height above the floor (a reflection copy lies mirrored below it).
  float height() { return abs(vWorld.y); }
  // How much of this fragment shows: the upright layer only above the floor; the reflection only below it, weighted
  // like a glossy floor (Fresnel: weak looking down, strong at grazing angles), so it fades towards the camera.
  float showing() {
    if (uMirror < 0.5) return vWorld.y < -0.002 ? 0.0 : 1.0;
    if (vWorld.y > 0.002) return 0.0;
    vec3 dir = normalize(vWorld - cameraPosition);
    float grazing = 1.0 - abs(dir.y);
    return 0.015 + 0.12 * pow(grazing, 8.0);
  }
`;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const OUT = /* glsl */ `
    float show_ = showing();
    if (show_ <= 0.0) discard;
    gl_FragColor = vec4(color * show_, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
`;

/** One glowing layer: its upright material and its floor-reflection copy. */
function layer(fragment: string, uniforms: Record<string, THREE.IUniform> = {}) {
  const make = (mirror: number) => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMirror: { value: mirror }, ...uniforms },
    vertexShader: VERTEX,
    fragmentShader: COMMON + fragment,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  return { up: make(0), down: make(1) };
}

/** The "A": logo mask × LED dots × cyan, with scan bands, a vignette and the occasional glitch. */
const TITLE_LED = /* glsl */ `
  uniform sampler2D uMask;
  void main() {
    vec2 uv = vUv;
    // Glitch: now and then a few of the 150 bands slide sideways for a moment, the colour channels split.
    float band = floor(uv.y * 150.0), tick = floor(uTime * 12.0);
    float burst = step(0.93, hash(vec2(floor(uTime * 1.3), 7.0)));
    float slide = burst * step(0.8, hash(vec2(band, tick))) * (hash(vec2(tick, band)) - 0.5) * 0.03;
    float split = 0.0012 + burst * 0.004;
    // The mask is the logo's grey fill (0.56) with a brighter edge stroke and a baked glow halo; blurrier in a reflection.
    float blur = uMirror * 3.0;
    vec3 mask = vec3(texture2D(uMask, uv + vec2(slide + split, 0.0), blur).r,
                     texture2D(uMask, uv + vec2(slide, 0.0), blur).g,
                     texture2D(uMask, uv + vec2(slide - split, 0.0), blur).b) / 0.56;
    float dots = ledDots(uv * 360.0, 0.36);
    float bands = 0.9 + 0.1 * sin((uv.y * 150.0 + uTime * 0.6) * 6.2832);
    float vignette = 1.0 - 0.35 * smoothstep(0.15, 0.62, length(uv - vec2(0.5, 0.42)));
    vec3 gap = vec3(0.0, 0.15, 0.15), led = vec3(0.035, 0.69, 0.54);
    vec3 color = mask * mix(gap, led, dots) * bands * vignette;
    ${OUT}
  }
`;

/** Soft white lights on a square grid, 1.18 m apart (TileMultiplier 18.7 across 22 m); wide soft blobs when reflected. */
const LIGHT_GRID = /* glsl */ `
  void main() {
    vec2 cell = vUv * 18.7;
    vec2 f = fract(cell) - 0.5;
    float d = length(f) * 1.18; // metres from the light
    float px = max(fwidth(cell.x), 1e-4) * 1.18;
    float core = (1.0 - smoothstep(0.012, 0.012 + px * 1.5, d)) * (1.0 - uMirror);
    float glow = exp(-d * d / (0.0045 + uMirror * 0.02)) * (1.0 + uMirror);
    float flicker = 0.92 + 0.08 * sin(uTime * 1.7 + hash(floor(cell)) * 6.2832);
    vec3 color = vec3(0.646, 0.767, 1.0) * (core * 1.4 + glow * 0.35) * flicker;
    ${OUT}
  }
`;

/** Slow smoke drifting up, brightest low in the middle (MI_FogPlane_Background: fades from the bottom and the centre). */
const SMOKE = /* glsl */ `
  void main() {
    vec2 p = vUv * vec2(4.0, 2.0);
    float n = fbm(p + vec2(uTime * 0.02, -uTime * 0.05)) * fbm(p * 1.7 - vec2(uTime * 0.03, uTime * 0.02));
    float shape = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.35, 0.9, vUv.y))
      * (1.0 - 0.6 * smoothstep(0.2, 0.5, abs(vUv.x - 0.5)));
    vec3 color = vec3(0.179, 0.283, 0.596) * n * shape * 0.1;
    ${OUT}
  }
`;

/** The screen wall: dark blue, a little brighter low down, darkening towards the top and the far sides. */
const SCREEN_WALL = /* glsl */ `
  void main() {
    float side = abs(vUv.x - 0.5) * 2.0; // 0 straight ahead, 1 beside the camera
    vec3 color = mix(vec3(0.0, 0.085, 0.21), vec3(0.0, 0.035, 0.1), smoothstep(3.0, 11.0, height()));
    color *= 1.0 - 0.45 * smoothstep(0.35, 0.95, side);
    color *= smoothstep(0.0, 0.6, height()); // the horizon fade at the floor
    ${OUT}
  }
`;

/** The LED floor half-circle: faint LEDs inside, a bright rim (the vignette at 0.76 leaves the edge lit). */
const FLOOR_LED = /* glsl */ `
  void main() {
    float r = length(vUv - 0.5) * 2.0; // 0 centre .. 1 rim
    float rim = smoothstep(0.955, 0.985, r) * (1.0 - smoothstep(0.99, 1.0, r));
    float inner = smoothstep(0.76, 0.98, r) * 0.08;
    vec3 color = vec3(0.0, 0.452, 0.661) * (rim * 1.6 + inner);
    ${OUT}
  }
`;

/** Low haze over the backdrop's base. */
const HAZE = /* glsl */ `
  void main() {
    float n = 0.75 + 0.25 * fbm(vec2(vUv.x * 6.0 + uTime * 0.03, height() * 0.8 - uTime * 0.02));
    float shape = smoothstep(-0.1, 0.4, height()) * (1.0 - smoothstep(0.6, 2.4, height()))
      * (1.0 - smoothstep(0.3, 0.5, abs(vUv.x - 0.5)));
    vec3 color = vec3(0.1, 0.17, 0.2) * shape * n;
    ${OUT}
  }
`;

/** The floor's own colour under its reflection: near black, a little lighter towards the horizon. */
const FLOOR = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    float far = smoothstep(4.0, 26.0, length(vWorld.xz - cameraPosition.xz));
    vec3 color = mix(vec3(0.0008, 0.01, 0.018), vec3(0.0, 0.014, 0.024), far);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A glowing layer and its reflection, from one geometry. */
function Glowing({ position, material, order, children }: {
  position: [number, number, number]; material: { up: THREE.ShaderMaterial; down: THREE.ShaderMaterial }; order: number;
  children: ReactNode;
}) {
  const [x, y, z] = position;
  return (
    <>
      <mesh position={position} material={material.up} renderOrder={10 + order}>{children}</mesh>
      {/* Mirrored about the floor (y = 0): the reflection a mirror would show. */}
      <group scale={[1, -1, 1]}>
        <mesh position={[x, y, z]} material={material.down} renderOrder={order}>{children}</mesh>
      </group>
    </>
  );
}

export default function MenuStageS12() {
  const mask = useLoader(THREE.TextureLoader, sceneUrl("s12-menu/icon-stroke-a.webp"));
  const materials = useMemo(() => {
    mask.colorSpace = THREE.NoColorSpace; // a mask, read as data
    mask.anisotropy = 8;
    return {
      title: layer(TITLE_LED, { uMask: { value: mask } }),
      lights: layer(LIGHT_GRID),
      smoke: layer(SMOKE),
      wall: layer(SCREEN_WALL),
      floorLed: layer(FLOOR_LED),
      haze: layer(HAZE),
    };
  }, [mask]);
  const floor = useMemo(() => new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FLOOR, depthWrite: false }), []);
  const all = useMemo(() => Object.values(materials).flatMap(m => [m.up, m.down]), [materials]);
  useEffect(() => {
    // Dev builds: the materials on window for tuning against the screenshot (uniforms, visibility).
    if (import.meta.env.DEV) (window as unknown as { __stageMaterials?: unknown }).__stageMaterials = materials;
    return () => { all.forEach(m => m.dispose()); floor.dispose(); };
  }, [materials, all, floor]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (const m of all) m.uniforms.uTime.value = t;
  });
  const halfDisc = useMemo(() => new THREE.CircleGeometry(7.55, 96, 0, Math.PI).rotateX(-Math.PI / 2), []);
  useEffect(() => () => halfDisc.dispose(), [halfDisc]);
  const led = at(4.75, 0.25, 0);
  // Drawn in this order, nothing depth-tested: the floor (its own colour), the reflections, then the upright layers,
  // each of which shows only above the floor line.
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -8]} material={floor} renderOrder={-1}>
        <planeGeometry args={[80, 80]} />
      </mesh>
      <Glowing position={at(17.87, 0, 5.8)} material={materials.title} order={1}><planeGeometry args={[24, 24]} /></Glowing>
      <Glowing position={at(18.11, 0, 4.82)} material={materials.lights} order={2}><planeGeometry args={[22, 22]} /></Glowing>
      <Glowing position={at(16.33, 0, 2.96)} material={materials.smoke} order={3}><planeGeometry args={[20, 10]} /></Glowing>
      {/* The wall: an open half-cylinder round the camera, its axis at the level's x 1.38. */}
      <Glowing position={[0, 0.11 + 6, -(1.38 - CHARACTER_X)]} material={materials.wall} order={4}>
        <cylinderGeometry args={[15.96, 15.96, 12, 96, 1, true, Math.PI / 2, Math.PI]} />
      </Glowing>
      <Glowing position={[0, 3, -9]} material={materials.haze} order={5}><planeGeometry args={[24, 6]} /></Glowing>
      <mesh position={[led[0], 0.003, led[2]]} geometry={halfDisc} material={materials.floorLed.up} renderOrder={20} />
    </>
  );
}
