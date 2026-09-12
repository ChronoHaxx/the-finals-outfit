import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CharacterRig, type RigMaterial, type RigMaterialBinding, type RigDecal, type RigItem } from "../rig/CharacterRig";
import { SURFACE_VIEWS, type SurfaceView } from "../rig/ReconstructedMaterial";
import { loadSourceAssemblyItems, loadSourceOutfit, loadSourceRigParts, loadSourceSkinPair, type SourceOutfit, type SourceMaterialParameters } from "../rig/SourceAssembly";
import MaterialTuner from "./MaterialTuner";
import { StablePreview } from "./StablePreview";
import MeshInspector from "./MeshInspector";
import { createGltfLoader } from "../rig/loaders";
import { useBuildStore, effectiveBuild } from "../store/useBuildStore";
import { getItemById } from "../lib/catalog";
import { modelUrl } from "../lib/assets";
import { encodeOutfit } from "../lib/outfit";
import { SLOTS, type Slot } from "../lib/slots";
import type { Item } from "../lib/item";

const BODY_URL = modelUrl("models/body/SK_Body_M.glb");
const NAIL_MASK_URL = modelUrl("models/decals/_shared/nailmask.webp");
const RECOVERED_ITEMS = ["casual-longcoat-leather-black", "casual-longcoat-leather-camo", "casual-longcoat-satin"];

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
  reconstructed?: boolean;
  sourceMeshes?: boolean;
  sourceAssembly?: boolean;
  sourceFitting?: boolean;
  surfaceView?: SurfaceView;
  isolate?: boolean;
  temporal?: boolean;
  inspect: boolean;
}
function readDevParams(): DevParams {
  if (typeof window === "undefined")
    return { debugAlbedo: false, noBaked: false, tune: false, inspect: false };
  const p = new URLSearchParams(window.location.search);
  // Production uses the validated source paths automatically. Diagnostic URL
  // switches remain local; reconstructed=0 is a complete legacy comparison.
  if (!import.meta.env.DEV) return {
    debugAlbedo: false, noBaked: false, tune: false, inspect: false,
    reconstructed: p.get("reconstructed") !== "0",
    sourceMeshes: true, sourceAssembly: true, sourceFitting: true,
    surfaceView: "lit", isolate: false, temporal: true,
  };
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
    reconstructed: p.get("reconstructed") === "1",
    sourceMeshes: p.get("sourceMeshes") !== "0",
    sourceAssembly: p.get("sourceAssembly") !== "0",
    sourceFitting: p.get("sourceFitting") !== "0",
    surfaceView: SURFACE_VIEWS.find((v) => v === p.get("surface")) ?? "lit",
    isolate: p.get("isolate") === "1",
    temporal: p.get("temporal") !== "0",
    // ?inspect=1 mounts the DEV MeshInspector. Unlike the tuner it takes its own
    // column rather than overlaying the canvas, so the model is never occluded.
    inspect: p.get("inspect") === "1",
  };
}
const DEV = readDevParams();

const sourcePreviewKey = (id: string, item: SourceOutfit['items'][string], skinParameters: SourceMaterialParameters[] = []) =>
  `${id}|parts:${JSON.stringify(item.parts)}|parameters:${JSON.stringify([item.materialParameters, skinParameters])}`;

// Two scene themes: a neutral wardrobe preview for comparing item colours, and
// a dark lobby view with a warm key and blue rim lights.
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
      surfaceUrl: l.surfacePath ? modelUrl(l.surfacePath) : undefined,
      surfaceOverride: l.surfaceOverride,
      uv: l.uv,
      uvScale: l.uvScale,
      uvLayout: l.uvLayout,
      uvOffsetX: l.uvOffsetX,
      colorOverride: l.colorOverride,
      colorMultiply: l.colorMultiply,
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

function toRigMaterialBindings(
  model: NonNullable<Item["model"]>,
  tintRecolor?: string,
): Record<string, RigMaterialBinding> | undefined {
  if (!model.materialBindings) return undefined;
  const resolve = (path: string | undefined) => path ? bust(modelUrl(path)) : undefined;
  return Object.fromEntries(Object.entries(model.materialBindings).map(([name, binding]) => [name, {
    ...toRigMaterial({ gltfPath: model.gltfPath, material: binding }),
    ...(tintRecolor ? { tintRecolor } : {}),
    family: binding.family,
    doubleSided: binding.doubleSided,
    glass: binding.glass ? { ...binding.glass, normal: resolve(binding.glass.normal) } : undefined,
    ledScreen: binding.ledScreen ? {
      ...binding.ledScreen,
      animation: resolve(binding.ledScreen.animation)!,
      colorRamp: resolve(binding.ledScreen.colorRamp),
      normal: resolve(binding.ledScreen.normal),
    } : undefined,
  }]));
}

// Procedural studio reflection environment. A neutral fill and broad panels keep
// recovered metal detail visible instead of leaving black interiors between bright
// streaks. Compared on source armour, leather, cloth and shoes plus legacy controls;
// this remains preview lighting, not a reproduction of the game's illumination.
function makeSoftboxScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const roomMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
  roomMaterial.color.setScalar(0.4); // linear radiance, not an sRGB colour swatch
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
  panel(8, 6, 7, [1.5, 6, 3]); // top-front key softbox
  panel(8, 6, 3, [-4.5, 2.5, 2]); // camera-left fill
  panel(6, 6, 2, [4.5, 2, -2.5]); // back-right accent
  return scene;
}

// Image-based lighting via PMREM (no network/asset dependency, unlike drei's
// <Environment> HDR presets). The studio theme uses the softbox scene above as the
// primary light source; the lobby theme keeps the generic bright RoomEnvironment, dimmed,
// so its key + rim lights define the look.
function StudioEnvironment({ intensity, softbox }: { intensity: number; softbox?: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = softbox ? makeSoftboxScene() : new RoomEnvironment();
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

// Neutral studio preview. Shared lighting is reviewed against multiple material
// families; recovered material values remain independent of the environment choice.
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
  const [hasRecoveredPreview, setHasRecoveredPreview] = useState(false);

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
      .loadBody(BODY_URL, DEV.reconstructed && DEV.sourceMeshes && DEV.sourceAssembly && DEV.sourceFitting
        ? modelUrl("models/reconstructed-meshes-v2/SK_Body_M.glb") : undefined)
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
    if (DEV.reconstructed) setError(null);
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      // Harness idle flag: false while this equip loop has in-flight loads.
      (window as unknown as { __rigIdle?: boolean }).__rigIdle = false;
      // Restore the previous inspection state before swapping items, including
      // when the next item is outside the recovered material family.
      rig.root.traverse((o) => {
        if (typeof o.userData.reconstructionOriginalVisibility === "boolean") {
          o.visible = o.userData.reconstructionOriginalVisibility;
          delete o.userData.reconstructionOriginalVisibility;
        }
      });
      // Render a base top under Outerwear when Upper Body is empty (never-bare torso). Derived
      // from `build` only for the rig — the store/share-link `build` is untouched.
      let supported = new Set<string>();
      if (DEV.reconstructed && DEV.sourceMeshes && DEV.sourceAssembly) {
        try {
          supported = await loadSourceAssemblyItems(modelUrl("models/reconstructed-assemblies-v1"));
          if (cancelled) return;
        } catch (e) {
          if (cancelled) return;
          console.error(e);
          setError("Couldn’t load reconstructed item data.");
          (window as unknown as { __rigIdle?: boolean }).__rigIdle = true;
          return;
        }
      }
      const completeCoat = !!build.outerwear && supported.has(build.outerwear);
      const eff = completeCoat ? build : effectiveBuild(build);
      let assembly: SourceOutfit | undefined;
      let sourceShirtConflict = false;
      if (DEV.reconstructed && DEV.sourceAssembly) {
        try {
          const ids = Object.values(eff).filter((id): id is string => !!id);
          const sourceUrl = modelUrl("models/reconstructed-assembly-v2");
          assembly = await loadSourceOutfit(ids, sourceUrl);
          sourceShirtConflict = !!completeCoat && assembly.slotConflicts.some(c =>
            c.slot === "EBodySlot::BodyUpper" && c.items.includes(build.outerwear!) && c.items.includes(build.upperBody!));
          if (sourceShirtConflict) {
            // The coat includes its authored top and occupies BodyUpper. Keep the
            // user's shirt selection for removal of the coat, but it contributes
            // neither geometry nor active tags while that complete coat is worn.
            assembly = await loadSourceOutfit(ids.filter(id => id !== build.upperBody), sourceUrl);
          }
          if (cancelled) return;
        } catch (e) {
          if (cancelled) return;
          console.error(e);
          setError("Couldn’t load outfit fitting data.");
          (window as unknown as { __rigIdle?: boolean }).__rigIdle = true;
          return;
        }
      }
      const appearanceSlots = new Set<Slot>();
      // Source hair attaches through the preserved body's head frame. The
      // legacy-body diagnostic modes must keep their legacy hair path as well.
      const requestedHair = eff.hair && DEV.sourceMeshes && DEV.sourceFitting && supported.has(eff.hair) ? assembly?.items[eff.hair] : undefined;
      const requestedFace = eff.face && DEV.sourceMeshes && DEV.sourceFitting ? assembly?.items[eff.face] : undefined;
      const faceItem = eff.face ? getItemById(eff.face) : undefined;
      if (assembly && requestedFace && faceItem?.model?.gltfPath && (requestedHair || (!eff.hair && rig.sourceAssemblyId('hair')))) {
        appearanceSlots.add('hair'); appearanceSlots.add('face');
        try {
          const parameters = assembly.materialParameters.filter(p => p.itemId === eff.hair);
          const assetsUrl = modelUrl('models/reconstructed-assemblies-v1');
          const pair = await loadSourceSkinPair(faceItem.id, requestedFace, assetsUrl, parameters);
          if (cancelled) return;
          if (!pair) appearanceSlots.clear(); // this face remains on the existing path
          else {
            const hairKey = requestedHair ? sourcePreviewKey(eff.hair!, requestedHair) : null;
            const faceKey = sourcePreviewKey(faceItem.id, requestedFace, parameters);
            const changes: RigItem[] = [], removals: Slot[] = [];
            if (prev.current.hair !== hairKey) {
              if (requestedHair) changes.push({ id: eff.hair!, slot: 'hair', url: '',
                sourceParts: await loadSourceRigParts(requestedHair, assetsUrl),
                sourceSurfaceView: DEV.debugAlbedo ? 'baseColor' : DEV.surfaceView });
              else removals.push('hair');
            }
            if (prev.current.face !== faceKey) changes.push({ id: faceItem.id, slot: 'face', url: modelUrl(faceItem.model.gltfPath),
              sourceSkinPair: pair, sourceSurfaceView: DEV.debugAlbedo ? 'baseColor' : DEV.surfaceView,
              bodySkin: faceItem.model.bodySkin ? { colorMultiply: faceItem.model.bodySkin.colorMultiply,
                roughness: faceItem.model.bodySkin.roughness,
                texUrl: faceItem.model.bodySkin.texPath ? modelUrl(faceItem.model.bodySkin.texPath) : undefined } : undefined });
            if (cancelled) return;
            const committed = await rig.equipSourceItems(changes, removals, controller.signal);
            if (cancelled) return;
            if (committed) { prev.current.hair = hairKey; prev.current.face = faceKey; }
            else { delete prev.current.hair; delete prev.current.face; }
          }
        } catch (e) {
          if (cancelled) return;
          console.error(e); setError('Couldn’t load this hair and scalp preview.');
          delete prev.current.hair; delete prev.current.face;
        }
      }
      for (const slot of SLOTS) {
        if (appearanceSlots.has(slot)) continue;
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
        const sourceCandidate = id && supported.has(id) && (slot !== 'hair' || (DEV.sourceMeshes && DEV.sourceFitting))
          ? assembly?.items[id] : undefined;
        // A part socketed onto the head component only exists while a source head is worn: its
        // sockets are that head's own. Without one, keep the ordinary path instead of failing.
        const headSocketed = !!sourceCandidate?.parts.some(part => !part.hidden && part.definition.bAttachToHeadMesh);
        const headComponent = headSocketed ? rig.sourceHeadComponentKey() : undefined;
        const sourceItem = headSocketed && !headComponent ? undefined : sourceCandidate;
        const skinCandidate = id && slot === "face" && DEV.sourceMeshes && DEV.sourceFitting ? assembly?.items[id] : undefined;
        let skinParameters: SourceMaterialParameters[] = [];
        if (skinCandidate && assembly) {
          // Hair is staged before the face. Use the successfully equipped source
          // hairstyle, including the previous one when a replacement fails.
          const hair = rig.sourceAssemblyId('hair');
          try {
            const parameterOutfit = hair === eff.hair ? assembly : await loadSourceOutfit(
              [...Object.entries(eff).filter(([slot]) => slot !== 'hair').map(([, id]) => id), hair]
                .filter((id): id is string => !!id), modelUrl('models/reconstructed-assembly-v2'));
            if (cancelled) return;
            skinParameters = parameterOutfit.materialParameters.filter(p => p.itemId === hair);
          } catch (e) {
            if (cancelled) return;
            console.error(e); setError('Couldn’t load scalp fitting data.'); delete prev.current[slot]; continue;
          }
        }
        const sourceKey = sourceItem ?? skinCandidate;
        // An item socketed onto the head component belongs to the head that is worn: the face is
        // staged before this loop, so a head swap has to re-stage it rather than be deduplicated.
        const key = sourceKey ? sourcePreviewKey(id!, sourceKey, skinParameters)
          + (headSocketed ? `|head:${headComponent ?? "none"}` : "") : underTint
          ? `${id}|${underTint}`
          : realUnder
            ? `${id}|u:${realUnder}`
            : id;
        if (prev.current[slot] === key) continue;
        const item = id ? getItemById(id) : undefined;
        if (item && (item.model?.gltfPath || sourceItem)) {
          try {
            // TODO(M4-dye): override material.regions[].tint from build dyes here.
            const base = item.model ? toRigMaterial(item.model) : undefined;
            if (base && DEV.reconstructed && RECOVERED_ITEMS.includes(item.id)) {
              base.reconstructed = {
                url: bust(modelUrl(`models/reconstructed/${item.id}.json`)),
                view: DEV.debugAlbedo ? "baseColor" : DEV.surfaceView,
              };
            }
            const material = underTint ? { ...(base ?? {}), tintRecolor: underTint } : base;
            // Fallback under-mesh (the generic recoloured top) if the real one fails to load — keeps
            // a shirt under the coat instead of a bare torso.
            const fallbackGlb =
              realUnder && item.model?.underLayer
                ? getItemById(item.model.underLayer)?.model?.gltfPath
                : undefined;
            const sourceParts = sourceItem ? await loadSourceRigParts(sourceItem,
              modelUrl("models/reconstructed-assemblies-v1")) : undefined;
            const sourceSkinPair = skinCandidate ? await loadSourceSkinPair(item.id, skinCandidate,
              modelUrl("models/reconstructed-assemblies-v1"), skinParameters) : undefined;
            await rig.equip({
              id: item.id,
              slot,
              url: item.model?.gltfPath ? modelUrl(item.model.gltfPath) : sourceParts![0]?.url ?? "",
              sourceMeshUrl: DEV.reconstructed && DEV.sourceMeshes && RECOVERED_ITEMS.includes(item.id)
                ? modelUrl("models/reconstructed-meshes-v2/SK_Casual_LongCoat_M.glb") : undefined,
              sourceParts,
              sourceSkinPair,
              sourceSurfaceView: DEV.debugAlbedo ? "baseColor" : DEV.surfaceView,
              material,
              materialBindings: item.model ? toRigMaterialBindings(item.model, underTint) : undefined,
              underLayerUrl: realUnder ? modelUrl(realUnder) : undefined,
              underLayerTint: realUnder ? item.model?.underLayerTint : undefined,
              underLayerFallbackUrl: fallbackGlb ? modelUrl(fallbackGlb) : undefined,
              bodySkin: item.model?.bodySkin
                ? {
                    colorMultiply: item.model.bodySkin.colorMultiply,
                    roughness: item.model.bodySkin.roughness,
                    texUrl: item.model.bodySkin.texPath
                      ? modelUrl(item.model.bodySkin.texPath)
                      : undefined,
                  }
                : undefined,
            }, controller.signal);
          } catch (e) {
            if (cancelled) return;
            console.error(e);
            if (sourceItem || skinCandidate || (DEV.reconstructed && RECOVERED_ITEMS.includes(item.id))) setError("Couldn’t load this shader preview.");
            // Failed loads remain retryable on the next build change.
            delete prev.current[slot];
            continue;
          }
          if (cancelled) return;
        } else if (item?.decal) {
          // 2D body cosmetic (tattoo/makeup/paint/eyes/nails) composited onto the body/head.
          // A source item may still occupy the slot (a native nail replaced by a legacy-only
          // polish). Remove it, and forget the committed key so a cancelled pass reprocesses it.
          rig.unequip(slot);
          delete prev.current[slot];
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
        prev.current[slot] = key ?? null;
      }
      if (assembly) {
        const activeCoat = rig.sourceAssemblyId("outerwear");
        // Failed replacements retain their previous source assemblies in any slot.
        // Resolve visibility from the items actually equipped after the batch.
        const actual = Object.fromEntries(SLOTS.map(slot => [slot, rig.equippedItemId(slot)
          ?? (getItemById(eff[slot] ?? "")?.decal ? eff[slot] : undefined)])) as typeof eff;
        if (SLOTS.some(slot => actual[slot] !== eff[slot])) {
          try {
            const ids = Object.values(actual).filter((id): id is string => !!id);
            assembly = await loadSourceOutfit(ids, modelUrl("models/reconstructed-assembly-v2"));
            sourceShirtConflict = !!activeCoat && assembly.slotConflicts.some(c =>
              c.slot === "EBodySlot::BodyUpper" && c.items.includes(activeCoat) && c.items.includes(actual.upperBody!));
            if (sourceShirtConflict) assembly = await loadSourceOutfit(ids.filter(id => id !== actual.upperBody),
              modelUrl("models/reconstructed-assembly-v2"));
            if (cancelled) return;
          } catch (e) {
            if (cancelled) return;
            console.error(e);
            setError("Couldn’t load outfit fitting data.");
          }
        }
        for (const slot of SLOTS) rig.setAssemblyVisibility(slot,
          !(slot === "upperBody" && sourceShirtConflict && !!activeCoat) &&
          !assembly.items[actual[slot] ?? ""]?.hidden);
        rig.setSourceFittingTags(DEV.sourceFitting ? assembly.fittingTags : []);
        (window as unknown as { __sourceAssembly?: SourceOutfit }).__sourceAssembly = assembly;
      }
      await rig.whenBodyHidesReady();
      if (cancelled) return;
      let recovered = false;
      rig.root.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          .some(m => m.userData.reconstructed === true)) recovered = true;
      });
      if (!cancelled) setHasRecoveredPreview(recovered);
      if (DEV.reconstructed && DEV.isolate && recovered) {
        rig.root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mesh.userData.reconstructionOriginalVisibility = mesh.visible;
          mesh.visible = materials.some((m) => m.userData.reconstructed === true);
        });
      }
      if (!cancelled) (window as unknown as { __rigIdle?: boolean }).__rigIdle = true;
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [build, ready, rig]);

  const changePreviewOption = (name: "surface" | "isolate", value: string) => {
    const url = new URL(window.location.href);
    // The URL is only hydrated on mount; it does not follow edits in the picker.
    // Save the current outfit before reloading to change a preview option.
    const slots: Partial<Record<Slot, string>> = {};
    for (const slot of SLOTS) if (build[slot]) slots[slot] = build[slot];
    url.searchParams.set("outfit", encodeOutfit({ slots }));
    url.searchParams.set(name, value);
    window.location.assign(url);
  };

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
        {DEV.reconstructed && DEV.temporal && !DEV.debugAlbedo && DEV.surfaceView === "lit" && <StablePreview />}
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
      {import.meta.env.DEV && DEV.reconstructed && hasRecoveredPreview && (
        <div className="absolute left-2 top-2 z-10 rounded-md bg-black/70 px-3 py-2 text-xs text-white">
          <span className="mb-1 block">Recovered shader · preview lighting</span>
          <select
            aria-label="Recovered material view"
            className="w-full rounded bg-neutral-800 p-1"
            value={DEV.surfaceView}
            onChange={(event) => changePreviewOption("surface", event.target.value)}
          >
            {SURFACE_VIEWS.map((view) => <option key={view} value={view}>{view === "baseColor" ? "Material colour" : view === "lit" ? "Lit surface" : view[0].toUpperCase() + view.slice(1)}</option>)}
          </select>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={DEV.isolate ?? false}
              onChange={(event) => changePreviewOption("isolate", event.target.checked ? "1" : "0")} />
            Isolate recovered items
          </label>
        </div>
      )}
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
      {DEV.inspect && ready && <MeshInspector rig={rig} />}
    </div>
  );
}
