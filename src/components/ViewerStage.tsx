// The lit stage a 3D view stands its characters on (moved verbatim from CharacterViewer.tsx on 22 Nov 2026, so the
// squad page (multi-character Phase 2) mounts the same lights, reflections and shadows as the builder).
import { useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { STAGE_FLOOR } from "../rig/ViewerScreenshot";
import {
  STUDIO_RIG, lightAngles, shadowFrustum, snapFollow, sunCasts, type EnvironmentKind, type Look, type StageLight,
  type ToneMappingChoice,
} from "../lib/stage-lighting";

// Coarse quality tier: phones get smaller shadow maps / cheaper grounding.
export const IS_TOUCH = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;

// The Studio rig's numbers (w157 lighting calibration; dev ?light= overrides) live in lib/stage-lighting.ts with the
// rest of the look: STUDIO_RIG. The softbox reflection scene below still reads its panel values from it.

// Procedural studio reflection environment. A neutral fill and broad panels keep
// recovered metal detail visible instead of leaving black interiors between bright
// streaks. Compared on source armour, leather, cloth and shoes plus legacy controls;
// this remains preview lighting, not a reproduction of the game's illumination.
function makeSoftboxScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const roomMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
  roomMaterial.color.setScalar(STUDIO_RIG.room); // linear radiance, not an sRGB colour swatch
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(14, 14, 14),
    roomMaterial,
  );
  scene.add(room);
  const panel = (w: number, h: number, intensity: number, pos: [number, number, number]) => {
    const mat = new THREE.MeshBasicMaterial();
    mat.color.setScalar(intensity); // >1 = HDR emitter for PMREM
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos);
    m.lookAt(0, 1, 0);
    scene.add(m);
  };
  panel(8, 6, STUDIO_RIG.keyPanel, [1.5, 6, 3]); // top-front key softbox
  panel(8, 6, STUDIO_RIG.fillPanel, [-4.5, 2.5, 2]); // camera-left fill
  panel(6, 6, STUDIO_RIG.accentPanel, [4.5, 2, -2.5]); // back-right accent
  return scene;
}

// Image-based lighting via PMREM (no network/asset dependency, unlike drei's <Environment> HDR presets): the reflections
// and soft ambient light every material picks up from its surroundings. PMREM ("prefiltered mipmapped radiance
// environment map") renders the little scene into a cube once and stores ever blurrier copies of it, one per roughness:
// a mirror reads the sharp copy, a rough surface a blurred one. Softbox: the studio scene above (the Studio look's main
// light source). Room: three's generic bright RoomEnvironment (the Lobby look keeps it dimmed, so its own lights define
// it). None: no reflections at all (every material recompiles once, as when a light is added).
function StudioEnvironment({ kind, intensity, rotation }: { kind: EnvironmentKind; intensity: number; rotation: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (kind === "none") { scene.environment = null; return; }
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = kind === "softbox" ? makeSoftboxScene() : new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    const envTex = target.texture;
    room.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) material.dispose();
    });
    scene.environment = envTex;
    return () => {
      if (scene.environment === envTex) scene.environment = null;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, kind]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
  }, [scene, intensity]);
  // Turning the reflections round the character. Changed in place: three hands materials a reference to this Euler, so
  // a new object could leave them reading the old one. 0 is the identity, as before.
  useEffect(() => {
    scene.environmentRotation.set(0, THREE.MathUtils.degToRad(rotation), 0);
  }, [scene, rotation]);
  return null;
}

const isInside = (object: THREE.Object3D, root: THREE.Object3D) => {
  for (let at: THREE.Object3D | null = object; at; at = at.parent) if (at === root) return true;
  return false;
};

// The sun: the one light that may cast shadows (each shadow-casting light renders the whole scene once more per frame,
// into its shadow map). Its place, colour and strength are the look's (stage-lighting.ts). Its shadow camera is an
// orthographic box along the light: the reviewed ±1.4 × ±1.6 m round the character (three's default ±5 m box would waste
// most of the shadow map) while the sun stands at the reviewed height, fitted for any other height or the floor shadow
// (shadowFrustum explains the geometry). It is centred on the light's target, so it stays on the character whichever way
// the sun turns. With the floor shadow on, light and target also follow the body on a 0.25 m grid, so an emote that
// travels keeps its whole shadow (a grid, not every frame: each step restarts the still view).
// Off or not casting: no shadow at all. A sun at intensity 0 would still shade the floor and pay for its shadow pass
// (the shadow test ignores intensity), so switching it off also switches castShadow off (a recompile, as for a toggle).
function SunLight({ light: sun, follow, root }: { light: StageLight; follow: boolean; root: THREE.Object3D }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const mapSize = IS_TOUCH ? 1024 : 2048;
  const casts = sun.enabled && sun.castShadow;
  const { height: elevation, distance } = lightAngles(sun.position);
  useEffect(() => {
    const light = ref.current;
    if (!light) return;
    const frustum = shadowFrustum(elevation, distance, follow);
    const cam = light.shadow.camera;
    cam.left = frustum.left;
    cam.right = frustum.right;
    cam.top = frustum.top;
    cam.bottom = frustum.bottom;
    cam.near = frustum.near;
    cam.far = frustum.far;
    cam.updateProjectionMatrix();
    // Depth in an orthographic shadow map is a fraction of far - near: the bias is rescaled to the same distance.
    light.shadow.bias = frustum.bias;
  }, [elevation, distance, follow, casts]);
  const pelvis = useRef<THREE.Object3D | null>(null);
  const [at, setAt] = useState<[number, number]>([0, 0]);
  useFrame(() => {
    if (!follow) return;
    if (!pelvis.current || !isInside(pelvis.current, root)) pelvis.current = root.getObjectByName("pelvis") ?? null;
    if (!pelvis.current) return;
    const world = pelvis.current.getWorldPosition(new THREE.Vector3());
    const [x, z] = snapFollow(world.x, world.z);
    if (x !== at[0] || z !== at[1]) setAt([x, z]);
  });
  const [x, z] = follow ? at : [0, 0];
  useEffect(() => {
    const light = ref.current;
    if (!light) return;
    // The target is not in the scene graph, so its matrix is updated by hand (three reads target.matrixWorld).
    light.target.position.set(x, 0, z);
    light.target.updateMatrixWorld();
  }, [x, z]);
  const [px, py, pz] = sun.position;
  return (
    <directionalLight
      ref={ref}
      position={[px + x, py, pz + z]}
      intensity={sun.enabled ? sun.intensity : 0}
      color={sun.color}
      castShadow={casts}
      shadow-mapSize-width={mapSize}
      shadow-mapSize-height={mapSize}
      shadow-normalBias={0.02}
    />
  );
}

// The floor shadow (opt-in): a plane that draws nothing but the sun's shadow (ShadowMaterial: black, alpha = how much
// of the sun is blocked), over the CSS backdrop. Details that matter:
// - 2 mm below the floor: drei's ContactShadows renders the scene from y = 0 looking up, and this plane would otherwise
//   land in its depth picture and darken the whole contact shadow;
// - no normals: three moves each shadow lookup normalBias (2 cm) along the surface normal to stop acne; on a floor
//   that slides the shadow 2 cm / tan(sun height) away from the feet (11 cm at 10°). The floor casts nothing, so it
//   cannot acne, and without a normal attribute three skips that offset for it alone;
// - no depth write and drawn first: it must never hide a transparent or additive part that dips below the floor.
function FloorShadow({ opacity }: { opacity: number }) {
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(40, 40);
    plane.deleteAttribute("normal");
    plane.deleteAttribute("uv");
    plane.rotateX(-Math.PI / 2);
    return plane;
  }, []);
  const material = useMemo(() => new THREE.ShadowMaterial({ depthWrite: false }), []);
  useEffect(() => { material.opacity = opacity; }, [material, opacity]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  return <mesh geometry={geometry} material={material} position={[0, -0.002, 0]} receiveShadow renderOrder={-1}
    userData={STAGE_FLOOR} />;
}

// The whole lit scene for a look (stage-lighting.ts). The Studio look mounts exactly what the reviewed rig always did, in
// the same order (reflections, sky/ground fill, sun, rim, contact shadow): the order lights are added is the order the
// shaders sum them, so the default renders the same pixels.
// Lights are keyed by id. Switching one off keeps it mounted at intensity 0: the number of lights is compiled into every
// material's shader (three's NUM_DIR_LIGHTS), so adding or removing one recompiles every material once, a deliberate
// action in the panel; dragging a colour or switching a light off and on does not.
// The sky/ground fill takes colour, groundColor and intensity as props, not constructor args: r3f rebuilds an object
// whose args change, which a colour-picker drag would do on every move.
export function StageLights({ look, root }: { look: Look; root: THREE.Object3D }) {
  const casting = sunCasts(look);
  const floor = look.floorShadow && casting;
  return (
    <>
      <StudioEnvironment kind={look.environment.kind} intensity={look.environment.intensity} rotation={look.environment.rotation} />
      <hemisphereLight color={look.hemisphere.sky} groundColor={look.hemisphere.ground} intensity={look.hemisphere.intensity} />
      {look.lights.map(light => light.role === "sun"
        ? <SunLight key={light.id} light={light} follow={floor} root={root} />
        : <directionalLight key={light.id} position={light.position} color={light.color}
            intensity={light.enabled ? light.intensity : 0} />)}
      {look.contactShadow && <ContactShadows
        userData={STAGE_FLOOR}
        position={[0, 0, 0]}
        opacity={0.35}
        scale={3}
        blur={2.5}
        far={1.6}
        resolution={IS_TOUCH ? 128 : 256}
      />}
      {floor && <FloorShadow opacity={look.floorShadowOpacity} />}
    </>
  );
}

export const TONE_MAPPING: Record<ToneMappingChoice, THREE.ToneMapping> = {
  neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping,
};
// Shadows always on, with the PCF filter three actually uses: r3f's "soft" asks for PCFSoftShadowMap, which three r184
// replaces with PCFShadowMap (warning each time r3f re-applies it on a re-render). A look whose sun casts nothing compiles
// the same shaders as a canvas without shadows (three enables shadow code only when a light casts).
export const SHADOWS = { type: THREE.PCFShadowMap };
