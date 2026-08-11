import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CharacterRig, type RigMaterial, type RigDecal } from "../rig/CharacterRig";
import MaterialTuner from "./MaterialTuner";
import { createGltfLoader } from "../rig/loaders";
import { useBuildStore, effectiveBuild } from "../store/useBuildStore";
import { getItemById } from "../lib/catalog";
import { modelUrl } from "../lib/assets";
import { SLOTS, type Slot } from "../lib/slots";
import type { Item } from "../lib/item";

const BODY_URL = modelUrl("models/body/SK_Body_M.glb");
const NAIL_MASK_URL = modelUrl("models/decals/_shared/nailmask.webp");

// Coarse quality tier: phones get smaller shadow maps / cheaper grounding.
const IS_TOUCH = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;

// Dev-only harness hooks (scripts/visual-diff): pin the camera (?cam=x,y,z,tx,ty,tz&fov=N)
// and render unlit albedo for color calibration (?debugAlbedo=1 — region-tinted materials
// output their albedo directly; tone mapping is switched off so the PNG is sRGB(albedo)).
interface DevParams {
  cam?: number[];
  fov?: number;
  debugAlbedo: boolean;
  pose?: "a" | "idle";
  noBaked: boolean;
  tune: boolean;
}
function readDevParams(): DevParams {
  if (!import.meta.env.DEV || typeof window === "undefined")
    return { debugAlbedo: false, noBaked: false, tune: false };
  const p = new URLSearchParams(window.location.search);
  const cam = p.get("cam")?.split(",").map(Number);
  const fov = Number(p.get("fov"));
  return {
    cam: cam && cam.length === 6 && cam.every(Number.isFinite) ? cam : undefined,
    fov: Number.isFinite(fov) && fov > 0 ? fov : undefined,
    debugAlbedo: p.get("debugAlbedo") === "1",
    pose: p.get("pose") === "a" ? "a" : undefined, // harness pins A-pose for calibration
    // ?nobaked=1 forces the legacy region-tint path even when a baked composite exists —
    // for flat-vs-faithful before/after comparison of the layered-material reconstruction.
    noBaked: p.get("nobaked") === "1",
    // ?tune=1 mounts the DEV MaterialTuner (icon-vs-render slider panel).
    tune: p.get("tune") === "1",
  };
}
const DEV = readDevParams();

// Two scene themes. "studio" reproduces the bright neutral wardrobe render the official
// item icons were captured in — it's the calibration target, so its lighting must stay
// neutral (any tint here shows up as a color error against the icons). "lobby" is the
// dark main-menu inspect mood (warm key + signature blue rims), kept as a purely
// cosmetic alternate view — no color-accuracy promises.
type SceneTheme = "studio" | "lobby";

const THEME_BACKGROUND: Record<SceneTheme, string> = {
  // Sampled from the icon corners (light grey-blue studio backdrop).
  studio: "radial-gradient(ellipse 75% 65% at 50% 35%, #f0f3f7 0%, #dee4eb 55%, #c5cdd7 100%)",
  lobby: "radial-gradient(ellipse 70% 60% at 50% 38%, #1b2740 0%, #0a0e17 58%, #05060a 100%)",
};

// Resolve a catalog item's decal (2D body cosmetic) into rig form (paths -> URLs).
function toRigDecal(decal: NonNullable<Item["decal"]>): RigDecal {
  return {
    layers: decal.layers.map((l) => ({
      target: l.target,
      colorUrl: l.colorPath ? modelUrl(l.colorPath) : undefined,
      maskUrl: l.maskPath ? modelUrl(l.maskPath) : undefined,
      uv: l.uv,
      tint: l.tint,
      emissive: l.emissive,
    })),
  };
}

// Per-skin maps (region map, decals, baked composite) are re-generated in place by the asset
// pipeline (same filename, changed bytes), so a long-lived dev browser caches the stale texture
// and re-bakes never appear. In DEV append a cache-buster so equips always fetch the current
// map; prod keeps clean URLs (content is versioned by the off-repo publish).
const bust = (u: string): string =>
  import.meta.env.DEV ? u + (u.includes("?") ? "&" : "?") + "v=" + Date.now() : u;

// Resolve a catalog item's material into rig form (ColorMask path -> resolved URL).
function toRigMaterial(model: NonNullable<Item["model"]>): RigMaterial | undefined {
  const m = model.material;
  if (!m) return undefined;
  return {
    regionMapUrl: m.regionMapPath ? bust(modelUrl(m.regionMapPath)) : undefined,
    regionColors: m.regionColors,
    regionRoughness: m.regionRoughness,
    regionMetalness: m.regionMetalness,
    regionSheen: m.regionSheen,
    regionMeanLuma: m.regionMeanLuma,
    garmentDecals: m.garmentDecals?.map((d) => ({
      region: d.region,
      url: bust(modelUrl(d.path)),
      place: d.place,
      colorA: d.colorA,
      colorB: d.colorB,
    })),
    bakedSet:
      m.bakedSet && !DEV.noBaked
        ? {
            albedo: bust(modelUrl(m.bakedSet.albedo)),
            normal: bust(modelUrl(m.bakedSet.normal)),
            orm: bust(modelUrl(m.bakedSet.orm)),
          }
        : undefined,
    roughness: m.roughness,
    metalness: m.metalness,
    emissiveMapUrl: m.emissiveMap ? bust(modelUrl(m.emissiveMap)) : undefined,
    emissiveIntensity: m.emissiveIntensity,
  };
}

// Procedural photo-studio environment for PMREM: a DARK room with a few large bright
// softbox panels. The panels carry the diffuse light (high irradiance, no files needed),
// while the dark walls keep the AVERAGE radiance low — that's what makes metals read as
// dark gunmetal with bright streaks (like the official icons) instead of washed-out
// chrome, which is what a uniformly bright env (RoomEnvironment) produces.
function makeSoftboxScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(14, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0x1c1d20, side: THREE.BackSide }),
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
  panel(5, 5, 16, [1.5, 6, 3]); // top-front key softbox
  panel(4, 5, 7, [-4.5, 2.5, 2]); // camera-left fill
  panel(3, 4, 5, [4.5, 2, -2.5]); // back-right accent
  return scene;
}

// Image-based lighting via PMREM (no network/asset dependency, unlike drei's
// <Environment> HDR presets). The studio theme uses the dark softbox scene above as the
// primary light source; the lobby theme keeps the generic bright RoomEnvironment, dimmed,
// so its key + rim lights define the look.
function StudioEnvironment({ intensity, softbox }: { intensity: number; softbox?: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTex = pmrem.fromScene(softbox ? makeSoftboxScene() : new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    return () => {
      if (scene.environment === envTex) scene.environment = null;
      envTex.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, softbox]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
  }, [scene, intensity]);
  return null;
}

// White key light with a shadow frustum tightened around the character (the default
// ±5m ortho frustum wastes most of the shadow map's resolution).
function KeyLight() {
  const ref = useRef<THREE.DirectionalLight>(null);
  const mapSize = IS_TOUCH ? 1024 : 2048;
  useEffect(() => {
    const light = ref.current;
    if (!light) return;
    const cam = light.shadow.camera;
    cam.left = -1.4;
    cam.right = 1.4;
    cam.top = 1.6;
    cam.bottom = -1.6;
    cam.near = 0.5;
    cam.far = 20;
    cam.updateProjectionMatrix();
  }, []);
  return (
    <directionalLight
      ref={ref}
      position={[2.5, 6, 4]}
      intensity={1.2}
      color="#ffffff"
      castShadow
      shadow-mapSize-width={mapSize}
      shadow-mapSize-height={mapSize}
      shadow-bias={-0.0002}
      shadow-normalBias={0.02}
    />
  );
}

// Bright neutral high-key studio — the environment the official icons were rendered in.
// Intensities are anchor-calibrated: near-neutral items (grey boots, white sneakers) are
// rendered and probed against their icons (scripts/visual-diff), and the rig is tuned so
// their ΔL ≈ 0 at BOTH chest and ground level — the game's studio has no vertical falloff,
// so the hemisphere/env carry more of the light than the key.
function StudioLights() {
  return (
    <>
      <StudioEnvironment intensity={1.5} softbox />
      <hemisphereLight args={["#e8edf4", "#c4c8ce", 0.5]} />
      <KeyLight />
      {/* neutral back-top rim for silhouette separation */}
      <directionalLight position={[-3, 4.5, -4]} intensity={0.5} color="#ffffff" />
      <ContactShadows
        position={[0, 0, 0]}
        opacity={0.35}
        scale={3}
        blur={2.5}
        far={1.6}
        resolution={IS_TOUCH ? 128 : 256}
      />
    </>
  );
}

// THE FINALS main-menu inspect look: dark studio, warm key, signature blue rim.
function LobbyLights() {
  return (
    <>
      <StudioEnvironment intensity={0.4} />
      <hemisphereLight args={["#bcd2ff", "#161018", 0.35]} />
      <directionalLight position={[3.5, 5, 5]} intensity={2.4} color="#fff3e2" />
      <directionalLight position={[-5, 3.5, -4]} intensity={2.8} color="#3f6dff" />
      <directionalLight position={[5, 2, -4]} intensity={1.3} color="#2f56ff" />
      <directionalLight position={[-3, 2, 3]} intensity={0.35} color="#cfe0ff" />
    </>
  );
}

export default function CharacterViewer() {
  const rig = useMemo(
    () =>
      new CharacterRig(createGltfLoader(), undefined, NAIL_MASK_URL, {
        sheen: !IS_TOUCH,
        albedoDebug: DEV.debugAlbedo,
        faceBodyHideUrl: modelUrl("models/decals/_shared/bodyhide-face.webp"),
      }),
    [],
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<SceneTheme>("studio");
  const build = useBuildStore((s) => s.build);
  const prev = useRef<Partial<Record<Slot, string | null>>>({});

  // Dev-only: expose the rig root + THREE so the visual-diff harness can bisect rendering
  // issues (toggle maps/meshes, inject test textures) in the live scene without guessing.
  useEffect(() => {
    if (import.meta.env.DEV) {
      const w = window as unknown as { __rigRoot?: THREE.Object3D; __THREE?: typeof THREE };
      w.__rigRoot = rig.root;
      w.__THREE = THREE;
    }
  }, [rig]);

  // Load the base body once (StrictMode-safe: rig.dispose on cleanup, loadBody replaces).
  useEffect(() => {
    let cancelled = false;
    rig.setPose(DEV.pose ?? "idle"); // applied to the skeleton once the body loads
    rig
      .loadBody(BODY_URL)
      .then(() => !cancelled && setReady(true))
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError("Failed to load the base body model.");
      });
    return () => {
      cancelled = true;
      rig.dispose();
      setReady(false);
      prev.current = {};
    };
  }, [rig]);

  // Diff the serializable `build` -> rig equip/unequip whenever it changes.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      // Harness idle flag: false while this equip loop has in-flight loads.
      (window as unknown as { __rigIdle?: boolean }).__rigIdle = false;
      // Render a base top under Outerwear when Upper Body is empty (never-bare torso). Derived
      // from `build` only for the rig — the store/share-link `build` is untouched.
      const eff = effectiveBuild(build);
      for (const slot of SLOTS) {
        const id = eff[slot];
        // Open-coat undersuit tint: when Upper Body was auto-substituted under an open coat,
        // recolour the base top to the coat's mean colour so its open back blends. The tint
        // lives on the OUTERWEAR, so fold it into the dedup key — otherwise switching between two
        // coats that share the same undersuit mesh would keep the previous coat's colour.
        const underTint =
          slot === "upperBody" && !build.upperBody && build.outerwear
            ? getItemById(build.outerwear)?.model?.underLayerTint
            : undefined;
        // Real under-mesh: composite the actual game lining/undershirt onto a torso garment. An
        // upperBody garment (vest/open jacket) always shows its own lining; an outerwear coat shows
        // its lining only when the user hasn't equipped their own Upper Body (then THAT shows).
        const realUnder =
          id && (slot === "upperBody" || (slot === "outerwear" && !build.upperBody))
            ? getItemById(id)?.model?.underLayerUrl
            : undefined;
        const key = underTint
          ? `${id}|${underTint}`
          : realUnder
            ? `${id}|u:${realUnder}`
            : id;
        if (prev.current[slot] === key) continue;
        prev.current[slot] = key ?? null;
        const item = id ? getItemById(id) : undefined;
        if (item?.model?.gltfPath) {
          try {
            // TODO(M4-dye): override material.regions[].tint from build dyes here.
            const base = toRigMaterial(item.model);
            const material = underTint ? { ...(base ?? {}), tintRecolor: underTint } : base;
            // Fallback under-mesh (the generic recoloured top) if the real one fails to load — keeps
            // a shirt under the coat instead of a bare torso.
            const fallbackGlb =
              realUnder && item.model.underLayer
                ? getItemById(item.model.underLayer)?.model?.gltfPath
                : undefined;
            await rig.equip({
              id: item.id,
              slot,
              url: modelUrl(item.model.gltfPath),
              material,
              underLayerUrl: realUnder ? modelUrl(realUnder) : undefined,
              underLayerTint: realUnder ? item.model.underLayerTint : undefined,
              underLayerFallbackUrl: fallbackGlb ? modelUrl(fallbackGlb) : undefined,
              bodySkin: item.model.bodySkin
                ? {
                    colorMultiply: item.model.bodySkin.colorMultiply,
                    roughness: item.model.bodySkin.roughness,
                    texUrl: item.model.bodySkin.texPath
                      ? modelUrl(item.model.bodySkin.texPath)
                      : undefined,
                  }
                : undefined,
            });
          } catch (e) {
            console.error(e);
          }
          if (cancelled) return;
        } else if (item?.decal) {
          // 2D body cosmetic (tattoo/makeup/paint/eyes/nails) composited onto the body/head.
          try {
            await rig.equipDecal(slot, toRigDecal(item.decal));
          } catch (e) {
            console.error(e);
          }
          if (cancelled) return;
        } else {
          // empty slot
          rig.unequip(slot);
          rig.unequipDecal(slot);
        }
      }
      if (!cancelled) (window as unknown as { __rigIdle?: boolean }).__rigIdle = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [build, ready, rig]);

  return (
    <div
      className="relative h-full w-full"
      style={{ background: THEME_BACKGROUND[theme] }}
    >
      {/* key={theme} remounts the Canvas so renderer-level state (tone mapping, shadow
          type) applies cleanly — three recompiles all programs for the new renderer. */}
      <Canvas
        key={theme}
        camera={{
          position: DEV.cam ? [DEV.cam[0], DEV.cam[1], DEV.cam[2]] : [0, 1.0, 3.6],
          fov: DEV.fov ?? 35,
        }}
        dpr={[1, 2]}
        shadows={theme === "studio" ? "soft" : false}
        gl={{
          alpha: true,
          toneMapping: DEV.debugAlbedo
            ? THREE.NoToneMapping
            : theme === "studio"
              ? THREE.NeutralToneMapping
              : THREE.ACESFilmicToneMapping,
          toneMappingExposure: theme === "studio" ? 1.0 : 1.05,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
        {theme === "studio" ? <StudioLights /> : <LobbyLights />}
        <primitive object={rig.root} />
        <OrbitControls
          target={DEV.cam ? [DEV.cam[3], DEV.cam[4], DEV.cam[5]] : [0, 0.9, 0]}
          enablePan
          screenSpacePanning
          minDistance={0.05}
          maxDistance={10}
          makeDefault
        />
      </Canvas>
      <button
        onClick={() => setTheme((t) => (t === "studio" ? "lobby" : "studio"))}
        title="Toggle scene lighting"
        className="absolute right-2 top-2 z-10 rounded-md bg-black/40 px-2.5 py-1 text-xs font-medium text-white backdrop-blur transition hover:bg-black/60"
      >
        {theme === "studio" ? "Studio" : "Lobby"}
      </button>
      {DEV.tune && ready && <MaterialTuner rig={rig} />}
      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-neutral-500">
          Loading model…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
