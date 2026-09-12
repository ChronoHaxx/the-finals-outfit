import * as THREE from "three";
import { attachSourceStatic, bodySocketRest, type SourceSocketRest } from './SourceAttachment';
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Slot } from "../lib/slots";
import { disposeObject3D, disposeMaterial } from "./dispose";
import type { MaterialBinding } from "../lib/item";
import BODY_MASK_SLOTS from "../lib/body-mask-slots.json";
import { BodyDecalManager, type RigDecal } from "./BodyDecals";
import { loadReconstructedMaterial, type SurfaceView } from "./ReconstructedMaterial";
import { resolveLegacyBodyCoverage } from "./LegacyBodyCoverage";
import { enableSourceSkinning } from "./SourceMesh";
import { rebindSourceSkeleton, type SourceBoneAttachment } from "./SourceSkeleton";
import { fittingMorphNames, SourceFitting } from "./SourceFitting";
import type { SourceRigPart, SourceSkinPair } from "./SourceAssembly";

export type { RigDecal } from "./BodyDecals";

// Framework-agnostic three.js rig: loads a base body, then equips/unequips cosmetic
// glTFs by rebinding each cosmetic SkinnedMesh to the body's shared skeleton. No React.
// Shared body bones map by name. Preserved source garments can also own accessory
// branches absent from the body; those attach through their authored ancestors.

// Per-skin material/dye data, with the ColorMask URL already resolved (consistent with
// `url`). Approximates the game's layered dye system: classify each ColorMask texel into
// the nearest `regions[].mask` and recolor the baked (neutral) BaseColor with its tint.
export interface RigMaterial {
  reconstructed?: { url: string; view?: SurfaceView };
  regionMapUrl?: string;
  regionColors?: string[]; // color per part, indexed by the region map
  regionRoughness?: number[]; // optional per-part PBR, same index order as regionColors
  regionMetalness?: number[];
  regionSheen?: number[]; // per-part cloth-ness -> sheen lobe strength (0 = hard surface)
  regionMeanLuma?: number[]; // per-part mean linear luma of the baked albedo (normalizer)
  // Garment print decals (graphic-tee prints/logos): texture + UV placement
  // [offsetU, offsetV, scale, rotation], optionally gated to a region (-1 = ungated).
  garmentDecals?: { region: number; url: string; place: number[]; colorA?: string; colorB?: string }[];
  // Layered-composite baked texture set (scripts/bake-composite.mjs): a per-skin finished
  // albedo/normal/orm. When present it's assigned straight onto the mesh and the region-tint
  // shader is skipped — the look is correct by construction. orm = R:AO G:roughness B:metalness.
  bakedSet?: { albedo: string; normal: string; orm: string };
  // Open-coat undersuit: recolour this piece's albedo to a single hue (the coat's mean colour),
  // preserving the baked shading luminance, so an auto-substituted base top blends into the coat
  // it shows through. Applied on top of the baked albedo (see injectFlatRecolor).
  tintRecolor?: string;
  roughness?: number;
  metalness?: number;
  // Self-illuminated mesh cosmetics (pumpkin glow, blankface LED, gas-mask lenses): emissive
  // map URL + intensity. Assigned at runtime (emissive colour = white) since the convert-time
  // Blender emissive bake is unreliable. Survives both the baked and region/plain paths.
  emissiveMapUrl?: string;
  emissiveIntensity?: number;
}

export interface RigMaterialBinding extends RigMaterial {
  family: MaterialBinding["family"];
  doubleSided?: boolean;
  glass?: MaterialBinding["glass"];
  // Paths are resolved URLs by the time they reach the rig, just like bakedSet.
  ledScreen?: MaterialBinding["ledScreen"];
}

interface LoadedMaterial {
  material: RigMaterialBinding;
  region: THREE.Texture | null;
  decals: GarmentDecalTex[];
  baked: { map: THREE.Texture; normalMap: THREE.Texture; orm: THREE.Texture } | null;
  emissive: THREE.Texture | null;
  glassNormal: THREE.Texture | null;
  led: { animation: THREE.Texture; colorRamp: THREE.Texture | null; normal: THREE.Texture | null } | null;
}

// A loaded garment print decal ready for the shader.
interface GarmentDecalTex {
  region: number;
  place: number[];
  tex: THREE.Texture;
  // When the decal `_M` is a 2-tone mask with a chromatic scheme: light end / dark end colours.
  colorA?: THREE.Color;
  colorB?: THREE.Color;
}

export interface RigItem {
  id: string;
  slot: Slot;
  url: string; // fully-resolved .glb URL (already passed through assetUrl)
  sourceMeshUrl?: string; // preserved source geometry; legacy URL still identifies coverage masks
  sourceParts?: SourceRigPart[];
  sourceSkinPair?: SourceSkinPair;
  sourceSurfaceView?: SurfaceView;
  material?: RigMaterial;
  materialBindings?: Record<string, RigMaterialBinding>;
  // Heads only: retune the shared body material to match the face — the game swaps the
  // body color map per head (Dark/Light/FemaleMedium) and multiplies it
  // (MI_Body_*.json BodyColorMap + ColorMultiply/Roughness). texUrl is fully resolved.
  bodySkin?: { colorMultiply: [number, number, number]; roughness?: number; texUrl?: string };
  // Outerwear only: the REAL under-garment mesh (fully-resolved .glb URL) the rig composites under
  // an open coat — the actual game under-layer (e.g. LawyerSuitJacket) instead of the recoloured
  // generic top. Tracked + disposed alongside the coat. underLayerTint (the coat's icon-sampled
  // under-shirt colour) is applied as a flat albedo so the region-tint garment doesn't render as
  // its raw neutral/ColorMask base; its normal/AO detail (folds) is preserved.
  underLayerUrl?: string;
  underLayerTint?: string;
  // Fallback under-garment glb (the generic recoloured top) loaded if underLayerUrl fails at
  // runtime — so a transient load error degrades to a shirt, never a bare torso.
  underLayerFallbackUrl?: string;
}

// Shapes returned by CharacterRig.inspect() — the dev inspector's view of the live scene.
export interface InspectMaterial {
  name: string;
  side: "front" | "back" | "double";
  transparent: boolean;
  alphaTest: number;
  maps: Record<string, string | null>;
}
export interface InspectMesh {
  uuid: string;
  name: string;
  skinned: boolean;
  visible: boolean;
  triangles: number;
  vertices: number;
  materials: InspectMaterial[];
}
export interface InspectGroup {
  label: string; // slot name, or "body"
  id: string; // catalog item id
  meshes: InspectMesh[];
}

interface EquippedHandle {
  id: string;
  scene: THREE.Object3D; // the cosmetic gltf.scene we added to root
  meshes: THREE.SkinnedMesh[];
  statics: THREE.Mesh[]; // origin-authored statics re-parented onto a bone (watches/earrings)
  sourceBoneRoots?: THREE.Bone[]; // garment-owned branches attached to the body
  headComponent?: string; // this item hangs off the named source head component's own bones
  underLayerScene?: THREE.Object3D; // a composited real under-garment (see RigItem.underLayerUrl)
  underLayerMeshes?: THREE.SkinnedMesh[]; // its skinned meshes (skeletons disposed on unequip)
}

// The equipped source head's own bones, kept separate from the body's. A head-component socket
// must resolve inside the head that is actually worn: a body bone of the same name is a different
// component and cannot stand in for it.
interface SourceHeadComponent {
  id: string;
  sourceMesh: string;
  bones: Map<string, { bone: THREE.Bone; restInverse: THREE.Matrix4 }>;
}

// Inspector-only material copies own their texture references. Material.clone() keeps texture
// objects shared, which would let disposeObject3D() tear down a source texture still used by an
// unselected sibling. Copying the texture slots here makes the override a real, disposable owner.
function cloneMaterialForInspector(source: THREE.Material): THREE.Material {
  const clone = source.clone();
  const cloneFields = clone as unknown as Record<string, unknown>;
  for (const key of Object.keys(cloneFields)) {
    const value = cloneFields[key] as THREE.Texture | undefined;
    if (value?.isTexture) cloneFields[key] = value.clone();
  }
  clone.userData = { ...source.userData };
  for (const [key, value] of Object.entries(clone.userData)) {
    const texture = value as THREE.Texture | undefined;
    if (texture?.isTexture) clone.userData[key] = texture.clone();
  }
  return clone;
}

export class CharacterRig {
  private static tintUid = 0; // monotonic id for per-material program cache keys
  // 1×1 white map for pieces baked without any albedo texture (a large class of garments
  // ships ONLY Normal+OCM+ColorMask — the game paints them from flat layer colors). A map
  // is required so the region shader compiles (vMapUv) — white keeps it a no-op.
  private static white: THREE.Texture | null = null;
  private static whiteTex(): THREE.Texture {
    if (!CharacterRig.white) {
      const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      CharacterRig.white = tex;
    }
    return CharacterRig.white;
  }
  readonly root: THREE.Group;
  private skeleton: THREE.Skeleton | null = null;
  private bonesByName = new Map<string, THREE.Bone>();
  private bodyRestInverses = new Map<string, THREE.Matrix4>();
  private bodyScene: THREE.Object3D | null = null;
  private bodyMaterials: THREE.MeshStandardMaterial[] = [];
  private equipped = new Map<Slot, EquippedHandle>();
  private sourceHead: SourceHeadComponent | null = null;
  private assemblyHiddenSlots = new Set<Slot>();
  private readonly sourceFitting = new SourceFitting();
  private sourceFittingNames = new Set<string>();
  // Mesh UUID -> material copies made by the dev inspector. Values stay attached to their mesh
  // and are therefore released by disposeObject3D() with the scene; this map only prevents a
  // second copy on every toggle and is cleared when that scene leaves the rig.
  private inspectorMaterialOverrides = new Map<string, Set<THREE.Material>>();

  private readonly texLoader = new THREE.TextureLoader();
  private readonly decals: BodyDecalManager;

  constructor(
    private readonly loader: GLTFLoader,
    root: THREE.Group = new THREE.Group(),
    nailMaskUrl = "models/decals/_shared/nailmask.webp",
    // sheen: cloth regions upgrade to MeshPhysicalMaterial's sheen lobe (one extra shading
    // lobe per fragment) — viewers disable it on low-power/touch devices.
    // albedoDebug: region-tinted materials output raw albedo (no lighting) — the visual-diff
    // harness uses this to isolate color error from lighting error.
    // faceBodyHideUrl: body-UV mask (resolved URL) discarding the body's neck/chest under
    // an equipped head's own shell (coincident geometry would z-fight as camo patches).
    private readonly opts: {
      sheen?: boolean;
      albedoDebug?: boolean;
      faceBodyHideUrl?: string;
    } = {},
  ) {
    this.root = root;
    this.decals = new BodyDecalManager(this.texLoader, nailMaskUrl);
  }

  isReady(): boolean {
    return this.skeleton !== null;
  }

  sourceAssemblyId(slot: Slot): string | undefined {
    const handle = this.equipped.get(slot);
    return handle?.scene.userData.sourceAssembly ? handle.id : undefined;
  }

  equippedItemId(slot: Slot): string | undefined {
    return this.equipped.get(slot)?.id;
  }

  /** Identity of the source head component whose own bones head-attached items may use. It changes
   *  whenever the worn head does, so callers can tell that such an item has to be staged again. */
  sourceHeadComponentKey(): string | undefined {
    return this.sourceHead ? `${this.sourceHead.id}|${this.sourceHead.sourceMesh}` : undefined;
  }

  setSourceFittingTags(tags: string[]): void {
    this.sourceFittingNames = fittingMorphNames(tags);
    this.root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.userData.sourceBody || mesh.userData.sourceMesh))
        this.sourceFitting.apply(mesh, this.sourceFittingNames);
    });
  }

  whenBodyHidesReady(): Promise<void> {
    return this.decals.whenBodyHidesReady();
  }

  setAssemblyVisibility(slot: Slot, visible: boolean): void {
    const handle = this.equipped.get(slot);
    if (!handle) return;
    const wasHidden = this.assemblyHiddenSlots.has(slot);
    if (visible) this.assemblyHiddenSlots.delete(slot);
    else this.assemblyHiddenSlots.add(slot);
    for (const object of [handle.scene, handle.underLayerScene, ...handle.statics]) {
      if (!object) continue;
      if (!visible) {
        object.userData.assemblyOriginalVisibility ??= object.visible;
        object.visible = false;
      } else if (typeof object.userData.assemblyOriginalVisibility === "boolean") {
        object.visible = object.userData.assemblyOriginalVisibility;
        delete object.userData.assemblyOriginalVisibility;
      }
    }
    // Invisible clothing/head geometry must not continue cutting holes in the
    // underlying body. Other visible covering items keep their own masks active.
    if (wasHidden !== !visible) this.refreshBodyHides();
  }

  // Relaxed idle stance applied to the shared skeleton (cosmetics follow automatically —
  // they skin from the body's bones). Offsets found empirically against the exported bone
  // orientations; the A-pose remains available for debugging/harness calibration.
  private static readonly IDLE_POSE: Record<string, [number, number, number]> = {
    upperarm_l: [0.55, 0, 0.1],
    upperarm_r: [0.55, 0, -0.1],
    lowerarm_l: [0.3, 0, 0],
    lowerarm_r: [0.3, 0, 0],
    hand_l: [0.1, 0, 0],
    hand_r: [0.1, 0, 0],
  };
  private basePose = new Map<string, THREE.Euler>();
  private pose: "a" | "idle" = "a";

  setPose(pose: "a" | "idle"): void {
    this.pose = pose;
    if (!this.skeleton) return;
    for (const bone of this.skeleton.bones) {
      const base = this.basePose.get(bone.name);
      if (!base) continue;
      bone.rotation.copy(base);
      if (pose === "idle") {
        const off = CharacterRig.IDLE_POSE[bone.name];
        if (off) {
          bone.rotation.x += off[0];
          bone.rotation.y += off[1];
          bone.rotation.z += off[2];
        }
      }
    }
  }

  private bodyLoadVersion = 0;

  async loadBody(url: string, sourceMeshUrl?: string): Promise<void> {
    const version = ++this.bodyLoadVersion;
    const loaded = await Promise.allSettled([this.loader.loadAsync(url),
      ...(sourceMeshUrl ? [this.loader.loadAsync(sourceMeshUrl)] : [])]);
    const release = (scene: THREE.Object3D) => {
      const skeletons = new Set((scene.getObjectsByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh[]).map(m => m.skeleton));
      skeletons.forEach(s => s.dispose());
      disposeObject3D(scene);
    };
    const failure = loaded.find(result => result.status === "rejected");
    if (version !== this.bodyLoadVersion || failure) {
      for (const result of loaded) if (result.status === "fulfilled") release(result.value.scene);
      if (version === this.bodyLoadVersion && failure?.status === "rejected") throw failure.reason;
      return;
    }
    const gltf = (loaded[0] as PromiseFulfilledResult<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>).value;
    const source = loaded[1]?.status === "fulfilled" ? loaded[1].value : undefined;
    const body = gltf.scene.getObjectsByProperty("isSkinnedMesh", true)[0] as THREE.SkinnedMesh | undefined;
    const bones = new Map<string, THREE.Bone>(), inverses = new Map<string, THREE.Matrix4>();
    const basePose = new Map<string, THREE.Euler>();
    const driver = body?.skeleton;
    try {
      if (!body || !driver) throw new Error(`Body '${url}' has no SkinnedMesh`);
      gltf.scene.updateMatrixWorld(true);
      for (const bone of driver.bones) {
        bones.set(bone.name, bone);
        inverses.set(bone.name, bone.matrixWorld.clone().invert());
        if (bone.name in CharacterRig.IDLE_POSE) basePose.set(bone.name, bone.rotation.clone());
      }
      if (source) {
        // Preserve the existing skin material and animation driver while adding
        // the source geometry, full skin weights and authored fitting morphs.
        const candidates = source.scene.getObjectsByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh[];
        if (candidates.length !== 1 || Array.isArray(body.material) || Array.isArray(candidates[0].material))
          throw new Error("Unsupported source body material layout");
        const fresh = candidates[0];
        if ((fresh.material as THREE.Material).name !== body.material.name)
          throw new Error("Source body material slot mismatch");
        const { skeleton, attachments } = rebindSourceSkeleton(fresh.skeleton, bones, inverses);
        for (const { parent, root } of attachments) parent.add(root);
        body.geometry.dispose();
        body.geometry = fresh.geometry;
        fresh.geometry = new THREE.BufferGeometry(); // ownership transfers to body
        body.morphTargetDictionary = { ...fresh.morphTargetDictionary };
        body.morphTargetInfluences = [...(fresh.morphTargetInfluences ?? [])];
        body.bind(skeleton, fresh.bindMatrix);
        body.userData.sourceBody = true;
        body.userData.sourceBodyUrl = sourceMeshUrl;
        body.frustumCulled = false;
        // The source colour attribute encodes masks; the legacy skin material
        // expects white vertex colours. Preserve the data without tinting skin.
        body.material.vertexColors = false;
        enableSourceSkinning(body);
        this.sourceFitting.apply(body, this.sourceFittingNames);
      }
    } catch (error) {
      release(gltf.scene);
      if (source) release(source.scene);
      throw error;
    }
    if (source) release(source.scene);
    this.releaseBody();
    this.skeleton = driver!;
    this.bonesByName = bones;
    this.bodyRestInverses = inverses;
    this.basePose = basePose;
    this.setPose(this.pose);
    this.bodyScene = gltf.scene;
    this.enableShadows(gltf.scene);
    this.root.add(gltf.scene);
    this.bodyMaterials = this.collectStandardMaterials(gltf.scene);
    this.bodyBaseMaps.clear();
    this.decals.registerTarget("body", this.bodyMaterials);
    this.applyBodySkin();
    // Other archetypes require re-equipping cosmetics against their new driver.
  }

  private releaseBody(): void {
    if (!this.bodyScene) return;
    this.sourceHead = null;
    this.restoreSourceBodySkin();
    this.root.remove(this.bodyScene);
    this.forgetInspectorOverrides(this.bodyScene);
    const skeletons = new Set((this.bodyScene.getObjectsByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh[]).map(m => m.skeleton));
    if (this.skeleton) skeletons.add(this.skeleton);
    skeletons.forEach(s => s.dispose());
    disposeObject3D(this.bodyScene);
    this.bodyScene = null;
  }

  // Shadow flags for every mesh in a loaded scene. Fully-transparent shells (the baked
  // eye cornea placeholders ship alpha=0) must not cast — the shadow depth pass ignores
  // material transparency and would project them as solid silhouettes.
  private enableShadows(scene: THREE.Object3D): void {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const invisible = mats.every((m) => m.transparent && m.opacity <= 0.05);
      mesh.castShadow = !invisible;
      mesh.receiveShadow = true;
    });
  }

  private collectStandardMaterials(scene: THREE.Object3D): THREE.MeshStandardMaterial[] {
    const out: THREE.MeshStandardMaterial[] = [];
    scene.traverse((o) => {
      const mm = (o as THREE.Mesh).material;
      if (!mm) return;
      for (const m of Array.isArray(mm) ? mm : [mm])
        if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial)
          out.push(m as THREE.MeshStandardMaterial);
    });
    return out;
  }

  // Split a head GLB's materials into the skin (makeup / head tattoo target) and the iris
  // (eye color), and register them so those decals composite onto the equipped head.
  private registerHeadDecalTargets(scene: THREE.Object3D): void {
    const head: THREE.MeshStandardMaterial[] = [];
    const eyes: THREE.MeshStandardMaterial[] = [];
    for (const m of this.collectStandardMaterials(scene)) {
      const n = (m.name || "").toLowerCase();
      if (/eye/.test(n) && !/(eyeshell|eyeedge|eyelash|lash|brow)/.test(n)) eyes.push(m);
      else if (!/(eyeshell|eyeedge|eyelash|lash|brow|teeth|mouth)/.test(n)) head.push(m);
    }
    // Head skin renders as alpha-MASK, never BLEND: blended skin doesn't depth-write and
    // composites against interior geometry as blotches. The D texture's alpha is the
    // shell's rim cutout (fades to 0 at the open neck/chest edge) — alphaTest trims that
    // rim so the shell ends cleanly over the (un-hidden) body skin behind it.
    for (const m of head) {
      m.transparent = false;
      m.depthWrite = true;
      // Recovered neck coverage already uses the source fade and alpha hashing.
      // A second hard cutoff would truncate that gradual transition.
      m.alphaTest = m.userData.skinCoverage === 'neck-fade' ? 0 : 0.33;
      m.needsUpdate = true;
    }
    // Eyeballs: glossy wet surface — with the (damped) eye normals, a low roughness gives
    // one coherent catchlight instead of the baked default's diffuse grey.
    for (const m of eyes) {
      m.roughness = 0.25;
      m.needsUpdate = true;
    }
    // Legacy eye-shell/edge and lash bakes lack usable coverage. Recovered lashes
    // now evaluate coverage from the original RGB expression and can be shown.
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.some((m) => !m.userData.reconstructed && /eyeshell|eyeedge|eyelash/i.test(m.name ?? ""))) mesh.visible = false;
    });
    if (head.length) this.decals.registerTarget("head", head);
    if (eyes.length) this.decals.registerTarget("eyes", eyes);
  }

  // Equip/clear a 2D body decal (tattoo/makeup/paint/eyes/nails) in a slot.
  async equipDecal(slot: Slot, decal: RigDecal): Promise<void> {
    await this.decals.set(slot, decal);
  }
  unequipDecal(slot: Slot): void {
    this.decals.clear(slot);
  }

  async equip(item: RigItem, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    if (!this.skeleton) throw new Error("equip() called before loadBody() resolved");
    if (item.sourceSkinPair || item.sourceParts) {
      await this.equipSourceItems([item], [], signal);
      return;
    }

    const gltf = await this.loader.loadAsync(item.sourceMeshUrl ?? item.url);
    if (signal?.aborted) {
      disposeObject3D(gltf.scene);
      return;
    }

    // Load the piece-shared region map once (reused across this piece's meshes); disposed
    // with the scene since it's stashed on each tinted material's userData.
    let reconstructed: Awaited<ReturnType<typeof loadReconstructedMaterial>> | undefined;
    if (item.material?.reconstructed) {
      try {
        reconstructed = await loadReconstructedMaterial(item.material.reconstructed.url, item.material.reconstructed.view);
      } catch (error) {
        disposeObject3D(gltf.scene);
        if (signal?.aborted) return;
        throw error;
      }
    }
    const boundMaterials = !reconstructed && item.materialBindings
      ? await this.loadMaterialBindings(item.materialBindings, gltf.scene)
      : null;
    const legacyMaterial = reconstructed || boundMaterials ? undefined : item.material;
    const bakedSet = await this.loadBakedSet(legacyMaterial);
    const regionTex = bakedSet ? null : await this.loadRegionMap(legacyMaterial);
    const garmentDecals = await this.loadGarmentDecals(legacyMaterial);
    const emissiveTex = await this.loadEmissiveMap(legacyMaterial);
    // Hair cards: the strand SHAPE lives in a sibling <style>.coverage.webp (built by
    // scripts/build-hair-coverage.mjs from the dump's card-atlas coverage / NXA alpha) the
    // converter never wired in — without it the flat cards render as opaque colored shards.
    // Mirrors the bodymask convention: absent files 404 and skip (e.g. cel-shaded hairs).
    const hairCov =
      item.slot === "hair" || item.slot === "facialHair"
        ? await this.loadHairCoverage(item.url.replace(/\.glb(\?.*)?$/, ".coverage.webp$1"))
        : null;
    // Finish all asynchronous loads before attaching any of this item to the rig.
    // A newer selection can supersede even a slow recovered texture/shader load.
    const underLayer = !signal?.aborted && item.underLayerUrl
      ? await this.loadUnderLayer(item.underLayerUrl, item.underLayerTint, item.underLayerFallbackUrl)
      : null;
    if (signal?.aborted) {
      reconstructed?.dispose();
      regionTex?.dispose();
      garmentDecals.forEach((decal) => decal.tex.dispose());
      bakedSet?.map.dispose();
      bakedSet?.normalMap.dispose();
      bakedSet?.orm.dispose();
      emissiveTex?.dispose();
      hairCov?.dispose();
      disposeObject3D(gltf.scene);
      if (underLayer) {
        underLayer.meshes.forEach((mesh) => mesh.skeleton.dispose());
        disposeObject3D(underLayer.scene);
      }
      return;
    }
    this.unequip(item.slot); // the new item is ready; release the previous selection
    this.decals.clear(item.slot); // including a decal-only choice in the same slot
    gltf.scene.userData.rigItemId = item.id;

    const meshes: THREE.SkinnedMesh[] = [];
    const statics: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      const s = o as THREE.SkinnedMesh;
      if (s.isSkinnedMesh) meshes.push(s);
      else if ((o as THREE.Mesh).isMesh) statics.push(o as THREE.Mesh);
    });

    // GLTFLoader shares materials between primitives. Apply a binding only once and reuse
    // its result, including when a layered shader upgrades to MeshPhysicalMaterial.
    const appliedMaterials = new Map<THREE.Material, THREE.Material>();
    const originalTextures = this.sceneTextures(gltf.scene);
    const applyMat = (mesh: THREE.Mesh) => {
      if (reconstructed) reconstructed.apply(mesh);
      else if (boundMaterials) this.applyMaterialBindings(mesh, boundMaterials, appliedMaterials, hairCov);
      else this.applyMaterial(mesh, legacyMaterial, regionTex, garmentDecals, bakedSet, hairCov, emissiveTex);
    };

    for (const mesh of meshes) {
      const cosmeticSkel = mesh.skeleton;
      // Remap the cosmetic's bones onto the body's bones by name. Missing bones fall
      // back to the cosmetic's own bone (renders, but won't follow the body) and warn.
      const mappedBones = cosmeticSkel.bones.map((bone, i) => {
        const target = this.bonesByName.get(bone.name);
        if (!target) {
          console.warn(
            `[CharacterRig] bone '${bone.name}' (item '${item.id}') not on body skeleton; using fallback`,
          );
          return cosmeticSkel.bones[i];
        }
        return target;
      });
      // Reuse the cosmetic's own boneInverses (bind pose authored vs the same master
      // skeleton) and preserve its bindMatrix.
      // Blender reorients bone axes in legacy GLBs. Fresh UE meshes have the same
      // world-space bind shape but retain the original axes. Bind those vertices
      // to the driver's recorded neutral pose, not to its currently posed bones.
      const inverses = item.sourceMeshUrl ? cosmeticSkel.bones.map((bone, i) =>
        this.bodyRestInverses.get(bone.name)?.clone() ?? cosmeticSkel.boneInverses[i]) : cosmeticSkel.boneInverses;
      const rebound = new THREE.Skeleton(mappedBones, inverses);
      mesh.bind(rebound, mesh.bindMatrix);
      mesh.frustumCulled = false; // skinned bounds aren't auto-updated

      applyMat(mesh);
      enableSourceSkinning(mesh);
    }

    // Static (non-skinned) cosmetic meshes. Most (hair) are authored in body space and sit
    // correctly under `root`. Some (watches/earrings) are authored at the ORIGIN — they're
    // socket-attached in-engine — so for those slots we re-parent onto the matching bone
    // (re-parenting moves them out of gltf.scene, so they're tracked for disposal).
    const attached: THREE.Mesh[] = [];
    const eyeAnchor = item.slot === "eyewear" ? this.eyeWorldCenter() : null;
    for (const mesh of statics) {
      mesh.frustumCulled = false;
      applyMat(mesh);
      // Origin-authored statics (socket-attached in-engine — glasses, masks, earrings,
      // wings) often sit at ~y=0 IN WORLD SPACE; this is only a routing heuristic, not proof
      // that the exported mesh has the game's socket offset. Pin candidates to the slot's bone
      // while preserving their authored transform. Body-authored
      // statics (hair, helmets whose NODE carries the placement/scale) already sit at
      // their part and must stay under root — re-parenting them to a bone would discard
      // the node transform chain (a 0.35m helmet rendered 2m tall this way). The test
      // must use the WORLD center: a placed node often has a near-zero LOCAL bbox center.
      mesh.updateWorldMatrix(true, false);
      mesh.geometry.computeBoundingBox();
      const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? null;
      const cy = center ? center.applyMatrix4(mesh.matrixWorld).y : 1;
      const bone = Math.abs(cy) < 0.4 ? this.staticBone(item.slot) : null;
      if (bone) {
        mesh.userData.rigItemId = item.id;
        // Fold the FULL ancestor transform chain into the mesh's local transform before
        // re-parenting: quantized GLBs carry the dequant scale on WRAPPER nodes, and
        // bone.add() alone would discard it (watch meshes ballooned to 2.5m this way).
        mesh.updateWorldMatrix(true, false);
        if (
          item.slot === "earrings" ||
          item.slot === "eyewear" ||
          item.slot === "facewear" ||
          item.slot === "headwear"
        ) {
          // Head masks (hannya etc.) are authored at the ORIGIN facing world-forward. The plain
          // decompose+add (below) is right for a watch — it wants the wrist bone's rotation — but
          // head-attached statics must not inherit the arbitrary REST rotation of a facial socket:
          // that turns earrings on their side and can put glasses behind the face. Socket them at
          // the authored offset while KEEPING the authored world orientation (counter the bone
          // rotation), so they sit correctly and still follow the posed head.
          const wp = new THREE.Vector3();
          const wq = new THREE.Quaternion();
          const ws = new THREE.Vector3();
          mesh.matrixWorld.decompose(wp, wq, ws);
          const bwp = new THREE.Vector3();
          const bwq = new THREE.Quaternion();
          const bws = new THREE.Vector3();
          bone.matrixWorld.decompose(bwp, bwq, bws);
          const invBwq = bwq.clone().invert();
          mesh.quaternion.copy(invBwq).multiply(wq); // net world orientation = authored (forward)
          mesh.scale.set(ws.x / bws.x, ws.y / bws.y, ws.z / bws.z);
          mesh.position.copy(wp.applyQuaternion(invBwq)).divide(bws); // -> world pos = bone + offset
        } else {
          mesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
        }
        bone.add(mesh);
        if (eyeAnchor) {
          mesh.updateWorldMatrix(true, false);
          mesh.geometry.computeBoundingBox();
          const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3());
          if (center) {
            const currentWorld = center.applyMatrix4(mesh.matrixWorld);
            const targetLocal = bone.worldToLocal(eyeAnchor.clone());
            const currentLocal = bone.worldToLocal(currentWorld);
            mesh.position.add(targetLocal.sub(currentLocal));
          }
        }
        attached.push(mesh);
      }
    }

    // Replaced embedded maps may be shared with an unbound primitive: release them only
    // after every material has been assigned, and only if no live material still uses them.
    const retainedTextures = this.sceneTextures(gltf.scene, attached);
    for (const texture of originalTextures) if (!retainedTextures.has(texture)) texture.dispose();

    // Add the whole cosmetic scene (preserving mesh transforms); its skinned meshes now skin
    // from the body's bones, which live in the same rendered graph under `root`.
    // TODO(clip): consume item.model.hides[] to hide overlapping body submeshes.
    this.enableShadows(gltf.scene);
    for (const mesh of attached) this.enableShadows(mesh);
    this.root.add(gltf.scene);
    // The under-garment was loaded alongside the cosmetic before the swap.
    if (underLayer) this.root.add(underLayer.scene);
    this.equipped.set(item.slot, {
      id: item.id,
      scene: gltf.scene,
      meshes,
      statics: attached,
      underLayerScene: underLayer?.scene,
      underLayerMeshes: underLayer?.meshes,
    });
    // A head carries the skin + iris materials that makeup / eye-color decals composite
    // onto, hides the body's coincident neck/chest shell, and retunes the body skin tone.
    if (item.slot === "face") {
      this.registerHeadDecalTargets(gltf.scene);
      // Per-HEAD sibling mask: each head's neck/chest shell is cut differently, so a
      // shared mask would over-hide (holes) under shorter shells. ALL heads need it —
      // even the special shells (BlankFace etc.) duplicate the body's neck/chest
      // (verified: ungated they z-fight as white camo). Missing masks 404 and skip.
      this.bodyHideUrls.set("face", [item.url.replace(/\.glb(\?.*)?$/, ".bodymask.png$1")]);
      this.currentBodySkin = item.bodySkin ?? null;
      this.applyBodySkin();
    } else if (CharacterRig.BODYMASK_SLOTS.has(item.slot)) {
      // Garments ship a sibling <piece>.bodymask.png (white = body covered) — absent
      // masks 404 and are skipped by the union loader.
      const body = this.bodyScene?.getObjectsByProperty("isSkinnedMesh", true)[0] as THREE.SkinnedMesh | undefined;
      const coverage = resolveLegacyBodyCoverage(item.url, body?.userData.sourceBodyUrl);
      this.bodyHideUrls.set(item.slot, [coverage?.url ?? item.url.replace(/\.glb(\?.*)?$/, ".bodymask.png$1")]);
      if (coverage) this.bodyHideLayouts.set(item.slot, { [coverage.url]: coverage.uvTiles });
    }
    this.refreshBodyHides();
  }

  // Hair and its face/scalp parameters share a visible result. Stage all changed
  // source slots before replacing any old slot, including texture/shader failures.
  async equipSourceItems(items: RigItem[], removals: Slot[] = [], signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    if (!this.skeleton) throw new Error('Source equip called before body loading');
    const slots = [...items.map(item => item.slot), ...removals];
    if (new Set(slots).size !== slots.length) throw new Error('Repeated source transaction slot');
    if (items.some(item => !item.sourceSkinPair && !item.sourceParts)) throw new Error('Source transactions require preserved source inputs');
    const version = this.bodyLoadVersion;
    const results = await Promise.allSettled(items.map(item => {
      if (item.sourceSkinPair) return this.stageSourceSkin(item, item.sourceSkinPair, signal);
      if (item.sourceParts) return this.stageSourceAssembly(item, item.sourceParts, signal);
      throw new Error('Missing source transaction input');
    }));
    const stages = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
    const failure = results.find(result => result.status === 'rejected');
    if (signal?.aborted || version !== this.bodyLoadVersion || failure || stages.length !== items.length) {
      stages.forEach(stage => stage.release());
      if (!signal?.aborted && version === this.bodyLoadVersion && failure?.status === 'rejected') throw failure.reason;
      return false;
    }
    // No await between commits: a rendered frame sees either complete appearance.
    removals.forEach(slot => this.unequip(slot));
    stages.forEach(stage => stage.commit());
    return true;
  }

  // Find the live bone an attached static hangs from, and the socket rest it uses. Body sockets
  // keep the existing preserved-body contract. A frame names another component: the source head
  // actually worn, or an optional attachment mesh anchored on a body bone.
  //
  // A bone the component owns is checked numerically here: its bind is that component's own, so a
  // same-named bone from another component, a changed mesh or a stale index fails closed instead
  // of shifting the attachment. A bone shared with the body is supplied by the driver, whose bind
  // axes are the legacy body's rather than the source's, so it cannot be compared that way; the
  // resolver has already required that rest to equal the preserved body's, and the active body
  // identity is checked above. Optional attachment meshes transfer the rigid driver pose only;
  // their jiggle joints are not simulated here.
  private resolveSourceAttachment(attachment: NonNullable<SourceRigPart['attachment']>):
    { bone: THREE.Bone; restInverse: THREE.Matrix4; socket: SourceSocketRest; headComponent?: string } {
    const body = this.bodyScene?.getObjectsByProperty('isSkinnedMesh', true).find(o => o.userData.sourceBody);
    if (!body || new URL(body.userData.sourceBodyUrl, window.location.href).href !== attachment.bodyUrl)
      throw new Error('Source attachment does not match the active body');
    const frame = attachment.frame;
    if (!frame) {
      const bone = this.bonesByName.get(attachment.socket), restInverse = this.bodyRestInverses.get(attachment.socket);
      if (!bone || !restInverse) throw new Error('Source attachment does not match the active body');
      return { bone, restInverse, socket: bodySocketRest(attachment) };
    }
    const head = frame.kind === 'head-component' ? this.sourceHead : null;
    const component = frame.kind === 'head-component'
      ? frame.components.find(c => c.source === head?.sourceMesh)
      : frame.component;
    if (!component) throw new Error(`No active source head component carries socket ${attachment.socket}`);
    let live: { bone: THREE.Bone; restInverse: THREE.Matrix4 } | undefined;
    if (component.bodyBone) {
      const bone = this.bonesByName.get(component.bone), restInverse = this.bodyRestInverses.get(component.bone);
      if (bone && restInverse && (!head || head.bones.get(component.bone)?.bone === bone)) live = { bone, restInverse };
      else if (bone && restInverse) throw new Error(`Source attachment socket bone is not the head component's: ${component.bone}`);
    } else {
      const entry = head?.bones.get(component.bone);
      if (entry && !entry.bone.userData.sourceBoneExtension)
        throw new Error(`Source attachment socket bone is not the head component's: ${component.bone}`);
      if (entry) {
        const rest = entry.restInverse.clone().invert();
        if (rest.elements.some((v, i) => !Number.isFinite(v) || Math.abs(v - component.parentRest[i]) > 1e-5))
          throw new Error(`Source attachment socket bone is not the preserved rest: ${component.bone}`);
        live = entry;
      }
    }
    if (!live) throw new Error(`Source attachment socket bone is missing: ${component.bone}`);
    return { bone: live.bone, restInverse: live.restInverse,
      socket: { rest: component.rest, restScale: component.restScale },
      ...(head ? { headComponent: `${head.id}|${head.sourceMesh}` } : {}) };
  }

  private async stageSourceAssembly(item: RigItem, parts: SourceRigPart[], signal?: AbortSignal): Promise<{ commit: () => void; release: () => void } | undefined> {
    const scene = new THREE.Group();
    scene.name = `${item.id}:assembly`;
    scene.userData.rigItemId = item.id;
    scene.userData.sourceAssembly = true;
    const meshes: THREE.SkinnedMesh[] = [];
    const skeletons = new Set<THREE.Skeleton>();
    const attachments: SourceBoneAttachment[] = [];
    const materials = new Map<string, Awaited<ReturnType<typeof loadReconstructedMaterial>>>();
    const requests = [...new Set(parts.flatMap(part => Object.values(part.materials).map(m => m.url)))];
    const scenes = new Map<number, THREE.Object3D>();
    // Wait for every pending resource, including failed batches, before cleanup.
    // Nothing is attached until the complete item is ready and still selected.
    const results = await Promise.allSettled([
      ...parts.map(async (part) => {
        const gltf = await this.loader.loadAsync(part.url);
        scenes.set(part.sourceIndex, gltf.scene);
        gltf.scene.traverse(o => {
          if ((o as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((o as THREE.SkinnedMesh).skeleton);
        });
      }),
      ...requests.map(async (url) => {
        materials.set(url, await loadReconstructedMaterial(url, item.sourceSurfaceView));
      }),
    ]);
    for (const part of parts) {
      const root = scenes.get(part.sourceIndex);
      if (root) scene.add(root); // authored part order, independent of fetch timing
    }
    const release = () => {
      disposeObject3D(scene);
      skeletons.forEach(s => s.dispose());
      materials.forEach(m => m.dispose());
    };
    if (signal?.aborted) { release(); return; }
    const failure = results.find(r => r.status === "rejected");
    if (failure?.status === "rejected") { release(); throw failure.reason; }
    let headComponent: string | undefined;
    try {
      for (const part of parts) {
        const root = scenes.get(part.sourceIndex)!;
        root.userData.sourcePartIndex = part.sourceIndex;
        root.userData.sourceMesh = part.sourceMesh;
        const candidates = root.getObjectsByProperty('isMesh', true) as THREE.Mesh[];
        if (!candidates.length) throw new Error('Source assembly has no mesh sections');
        for (const candidate of candidates) {
          let mesh = candidate as THREE.SkinnedMesh;
          if (part.attachment) {
            const placement = this.resolveSourceAttachment(part.attachment);
            if (placement.headComponent) headComponent = placement.headComponent;
            mesh = attachSourceStatic(candidate, part.attachment, placement.bone, placement.restInverse, placement.socket);
            skeletons.add(mesh.skeleton);
          } else if (!mesh.isSkinnedMesh) throw new Error("Source clothing part must be skinned");
          const slots = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const [index, old] of slots.entries()) {
            const slot = old.userData.sourceSlot?.MaterialSlotName as string | undefined;
            const binding = slot ? part.materials[slot] : undefined;
            if (!binding) throw new Error(`Missing source material slot: ${slot}`);
            // Hair currently reads vertex colour only, but preserve a valid
            // world-input frame for the surface adapter's geometry contract.
            mesh.geometry.computeBoundingBox();
            const center = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()).multiplyScalar(100);
            materials.get(binding.url)!.apply(mesh, index, { boundsOrigin: [center.x, center.z, center.y] });
            const material = Array.isArray(mesh.material) ? mesh.material[index] : mesh.material;
            material.userData.sourceMaterial = binding.source;
          }
          if (!part.attachment) {
            const { skeleton, attachments: branches } = rebindSourceSkeleton(mesh.skeleton, this.bonesByName, this.bodyRestInverses);
            attachments.push(...branches);
            skeletons.add(skeleton);
            mesh.bind(skeleton, mesh.bindMatrix);
          }
          mesh.frustumCulled = false;
          mesh.userData.sourcePartIndex = part.sourceIndex;
          mesh.userData.sourceMesh = part.sourceMesh;
          enableSourceSkinning(mesh);
          this.sourceFitting.apply(mesh, this.sourceFittingNames);
          meshes.push(mesh);
        }
      }
    } catch (error) { release(); throw error; }
    // Original imported skeleton buffers are no longer used; all parts now share
    // the driver's neutral bind pose and continue following its current pose.
    const used = new Set(meshes.map(m => m.skeleton));
    skeletons.forEach(s => { if (!used.has(s)) s.dispose(); });
    this.enableShadows(scene);
    return { release, commit: () => {
      this.unequip(item.slot);
      // A source item replaces a decal-only choice in its slot, such as the legacy grey nail
      // tint. This also holds for an item whose parts are all hidden (a glove-covered nail).
      this.decals.clear(item.slot);
      for (const { parent, root } of attachments) parent.add(root);
      this.root.add(scene);
      this.equipped.set(item.slot, { id: item.id, scene, meshes, statics: [], sourceBoneRoots: attachments.map(a => a.root), headComponent });
      this.bodyHideUrls.set(item.slot, [...new Set(parts.flatMap(p => p.bodyMaskUrl ? [p.bodyMaskUrl] : []))]);
      this.bodyHideLayouts.set(item.slot, Object.fromEntries(parts
        .filter(p => p.bodyMaskUrl && p.bodyMaskUvTiles).map(p => [p.bodyMaskUrl!, p.bodyMaskUvTiles!])));
      this.refreshBodyHides();
    } };
  }

  private sourceBodySkin?: { mesh: THREE.SkinnedMesh; previous: THREE.MeshStandardMaterial };

  private restoreSourceBodySkin(): void {
    const previous = this.sourceBodySkin;
    if (!previous) return;
    this.sourceBodySkin = undefined;
    this.decals.unregisterTarget("body");
    disposeMaterial(previous.mesh.material as THREE.Material);
    previous.mesh.material = previous.previous;
    this.bodyMaterials = this.collectStandardMaterials(this.bodyScene!);
    this.decals.registerTarget("body", this.bodyMaterials);
  }

  private async stageSourceSkin(item: RigItem, pair: SourceSkinPair, signal?: AbortSignal): Promise<{ commit: () => void; release: () => void } | undefined> {
    if (item.slot !== "face") throw new Error("Skin pairs must own the face slot");
    const body = this.bodyScene?.getObjectsByProperty("isSkinnedMesh", true).find(o => o.userData.sourceBody) as THREE.SkinnedMesh | undefined;
    if (!body || Array.isArray(body.material) || new URL(body.userData.sourceBodyUrl, window.location.href).href !== pair.body.url)
      throw new Error("Skin pair requires its preserved fitted body");
    const version = this.bodyLoadVersion;
    const recovered = new Map<string, Awaited<ReturnType<typeof loadReconstructedMaterial>>>();
    const roots = new Map<string, THREE.Object3D>();
    const skeletons = new Set<THREE.Skeleton>();
    const urls = [...new Set([pair.head, pair.body].flatMap(p => Object.values(p.materials).flatMap(m => m.url ? [m.url] : [])))];
    const loaded = await Promise.allSettled([
      ...[["legacy", item.url], ["source", pair.head.url]].map(async ([key, url]) => {
        const gltf = await this.loader.loadAsync(url);
        roots.set(key, gltf.scene);
        gltf.scene.getObjectsByProperty("isSkinnedMesh", true).forEach(m => skeletons.add((m as THREE.SkinnedMesh).skeleton));
      }),
      ...urls.map(async url => recovered.set(url, await loadReconstructedMaterial(url, item.sourceSurfaceView))),
    ]);
    let stagedBodyMaterial: THREE.Material | undefined;
    const release = () => {
      roots.forEach(disposeObject3D);
      skeletons.forEach(s => s.dispose());
      recovered.forEach(m => m.dispose());
      if (stagedBodyMaterial) disposeMaterial(stagedBodyMaterial);
    };
    if (signal?.aborted || version !== this.bodyLoadVersion) { release(); return; }
    const failure = loaded.find(r => r.status === "rejected");
    if (failure?.status === "rejected") { release(); throw failure.reason; }
    const scene = roots.get("source")!;
    const meshes = scene.getObjectsByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh[];
    const attachments: SourceBoneAttachment[] = [];
    try {
      const legacy = new Map(this.collectStandardMaterials(roots.get("legacy")!).map(m => [m.name, m]));
      const frames = new Map<THREE.Skeleton, ReturnType<typeof rebindSourceSkeleton>>();
      const usedSlots = new Set<string>();
      if (!meshes.length) throw new Error("Source head has no skinned geometry");
      // Validate the complete fallback mapping before allocating replacements.
      // A missing later section must not orphan earlier cloned materials.
      for (const mesh of meshes) for (const old of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const slot = old.userData.sourceSlot?.MaterialSlotName as string;
        const name = pair.head.materials[slot]?.legacyName;
        if (!name || !legacy.has(name)) throw new Error(`Missing exact head preview material: ${slot}`);
        usedSlots.add(slot);
      }
      if (Object.keys(pair.head.materials).some(slot => !usedSlots.has(slot))) throw new Error("Missing source head sections");
      for (const mesh of meshes) {
        const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const replacements = originals.map(old => {
          const slot = old.userData.sourceSlot?.MaterialSlotName as string;
          const binding = pair.head.materials[slot];
          const baseline = binding?.legacyName ? legacy.get(binding.legacyName) : undefined;
          if (!baseline) throw new Error(`Missing exact head preview material: ${slot}`);
          const material = baseline.clone();
          // Cloned materials must own their textures after releasing the staging GLB.
          for (const [key, value] of Object.entries(material)) if (value?.isTexture)
            (material as unknown as Record<string, unknown>)[key] = (value as THREE.Texture).clone();
          material.userData = { ...material.userData, ...old.userData };
          old.dispose();
          return material;
        });
        mesh.material = Array.isArray(mesh.material) ? replacements : replacements[0];
        for (const [i, material] of replacements.entries()) {
          const slot = material.userData.sourceSlot.MaterialSlotName as string;
          const binding = pair.head.materials[slot];
          if (binding.url) recovered.get(binding.url)!.apply(mesh, i, { boundsOrigin: pair.head.boundsOrigin, preserveAlpha: true });
          const final = Array.isArray(mesh.material) ? mesh.material[i] : mesh.material;
          final.userData.sourceMaterial = binding.source;
          final.userData.previewMaterialFallback = !binding.url;
        }
        let frame = frames.get(mesh.skeleton);
        if (!frame) {
          frame = rebindSourceSkeleton(mesh.skeleton, this.bonesByName, this.bodyRestInverses);
          frames.set(mesh.skeleton, frame);
          attachments.push(...frame.attachments);
          skeletons.add(frame.skeleton);
        }
        mesh.bind(frame.skeleton, mesh.bindMatrix);
        mesh.frustumCulled = false;
        mesh.userData.sourceMesh = pair.head.sourceMesh;
        mesh.userData.sourcePartIndex = pair.head.sourceIndex;
        enableSourceSkinning(mesh);
        this.sourceFitting.apply(mesh, this.sourceFittingNames);
      }
      const bodyBindings = Object.values(pair.body.materials);
      if (bodyBindings.length !== 1 || !bodyBindings[0].url) throw new Error("Skin pair requires one recovered body material");
      const stage = new THREE.SkinnedMesh(body.geometry, new THREE.MeshStandardMaterial());
      try {
        recovered.get(bodyBindings[0].url)!.apply(stage, undefined, { boundsOrigin: pair.body.boundsOrigin });
        stagedBodyMaterial = stage.material;
        stagedBodyMaterial.userData.sourceMaterial = bodyBindings[0].source;
        enableSourceSkinning(stage);
      } finally {
        stagedBodyMaterial = stage.material;
        stage.customDepthMaterial?.dispose();
        stage.customDistanceMaterial?.dispose();
      }
    } catch (error) { release(); throw error; }
    const used = new Set(meshes.map(m => m.skeleton));
    skeletons.forEach(s => { if (!used.has(s)) s.dispose(); });
    disposeObject3D(roots.get("legacy")!);
    roots.delete('legacy');
    // This head's own bones, by name. Sections may share one rebound skeleton, but two sections
    // must never disagree about a name — a head-attached socket has to resolve to one bone.
    const headBones = new Map<string, { bone: THREE.Bone; restInverse: THREE.Matrix4 }>();
    try {
      for (const skeleton of used) skeleton.bones.forEach((bone, index) => {
        const existing = headBones.get(bone.name);
        if (existing && existing.bone !== bone) throw new Error(`Source head repeats bone ${bone.name}`);
        headBones.set(bone.name, { bone, restInverse: skeleton.boneInverses[index] });
      });
    } catch (error) { release(); throw error; }
    return { release, commit: () => {
      this.unequip("face");
      this.sourceBodySkin = { mesh: body, previous: body.material as THREE.MeshStandardMaterial };
      this.decals.unregisterTarget("body");
      body.material = stagedBodyMaterial!;
      this.bodyMaterials = this.collectStandardMaterials(this.bodyScene!);
      this.decals.registerTarget("body", this.bodyMaterials);
      for (const { parent, root } of attachments) parent.add(root);
      scene.name = `${item.id}:skin-preview`;
      scene.userData.rigItemId = item.id;
      scene.userData.sourceSkinPair = true;
      this.enableShadows(scene);
      this.root.add(scene);
      this.equipped.set("face", { id: item.id, scene, meshes, statics: [], sourceBoneRoots: attachments.map(a => a.root) });
      this.sourceHead = { id: item.id, sourceMesh: pair.head.sourceMesh, bones: headBones };
      this.registerHeadDecalTargets(scene);
      if (this.collectStandardMaterials(scene).some(m => m.userData.skinCoverage === 'neck-fade')) {
        // Keep skin behind the fading edge. The original matching morph pulls
        // the body's upper neck inside the head; a legacy cutout creates holes.
        this.bodyHideUrls.delete('face');
      } else this.bodyHideUrls.set("face", [item.url.replace(/\.glb(\?.*)?$/, ".bodymask.png$1")]);
      this.currentBodySkin = item.bodySkin ?? null;
      this.refreshBodyHides();
    } };
  }

  // Load a real under-garment glb and rebind its skinned meshes onto the body skeleton (same
  // bone-name mapping as the primary equip). Rendered with its OWN glb material (the converter-
  // baked neutral look — correct for dark linings/undershirts). Returns null on failure so equip
  // degrades gracefully to the generic recoloured top. Statics ride along in the scene.
  private async loadUnderLayer(
    url: string,
    tint?: string,
    fallbackUrl?: string,
  ): Promise<{ scene: THREE.Object3D; meshes: THREE.SkinnedMesh[] } | null> {
    // These are region-tint garments: their glb albedo is the NEUTRAL/ColorMask base meant to be
    // dyed at runtime, so left raw it renders cyan/purple garbage. Flatten to a clean undershirt
    // colour (the coat's icon-sampled under-shirt tint, or a dark default) while KEEPING the
    // normal/AO maps so the folds still read — a solid, plausible undersuit.
    const color = new THREE.Color(tint ?? "#3a3a3e");
    const recolor = (m: THREE.Material) => {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) return;
      std.map?.dispose(); // free the un-dyed base map's GPU memory before orphaning it
      std.map = null; // drop the un-dyed base map (the source of the garish look)
      std.color.copy(color);
      std.roughness = Math.max(std.roughness ?? 0.8, 0.7);
      std.metalness = 0;
      std.needsUpdate = true;
    };
    // Try the real under-mesh first, then the generic fallback — so a load error never leaves a
    // bare torso (effectiveBuild has already suppressed the generic upperBody substitution).
    for (const u of [url, fallbackUrl]) {
      if (!u) continue;
      try {
        const gltf = await this.loader.loadAsync(u);
        const meshes: THREE.SkinnedMesh[] = [];
        gltf.scene.traverse((o) => {
          const s = o as THREE.SkinnedMesh;
          if (s.isSkinnedMesh) meshes.push(s);
        });
        gltf.scene.traverse((o) => {
          const mat = (o as THREE.Mesh).material;
          if (mat) (Array.isArray(mat) ? mat : [mat]).forEach(recolor);
        });
        for (const mesh of meshes) {
          const skel = mesh.skeleton;
          const mapped = skel.bones.map((b, i) => this.bonesByName.get(b.name) ?? skel.bones[i]);
          mesh.bind(new THREE.Skeleton(mapped, skel.boneInverses), mesh.bindMatrix);
          mesh.frustumCulled = false;
        }
        this.enableShadows(gltf.scene);
        return { scene: gltf.scene, meshes };
      } catch (e) {
        console.warn(`[CharacterRig] under-layer load failed '${u}'`, e);
      }
    }
    return null;
  }

  // Slots whose pieces wrap the body and may ship a generated coverage mask.
  // Single source of truth: src/lib/body-mask-slots.json — the verification check
  // imports the same module, so the two can never disagree. (`face` is in the set but
  // is handled by its own branch above, which also registers head decal targets.)
  private static readonly BODYMASK_SLOTS = new Set<Slot>(BODY_MASK_SLOTS as Slot[]);
  private bodyHideUrls = new Map<Slot | "face", string[]>();
  private bodyHideLayouts = new Map<Slot, Record<string, [number, number]>>();
  private refreshBodyHides(): void {
    this.decals.setBodyHideMasks([...this.bodyHideUrls]
      .filter(([slot]) => !this.assemblyHiddenSlots.has(slot)).flatMap(([, urls]) => urls),
      Object.assign({}, ...[...this.bodyHideLayouts].filter(([slot]) => !this.assemblyHiddenSlots.has(slot)).map(([, layout]) => layout)));
  }

  private currentBodySkin: RigItem["bodySkin"] | null = null;
  private bodyBaseMaps = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>();
  private bodySkinTex: THREE.Texture | null = null; // swapped-in variant (owned)

  // Apply (or reset) the equipped head's body-skin pairing on the shared body material —
  // swap the color map variant if the head specifies one, and apply the LINEAR
  // ColorMultiply (three's material.color matches UE's semantics here).
  private applyBodySkin(): void {
    const bs = this.currentBodySkin;
    const want = bs?.texUrl ?? null;
    const have = (this.bodySkinTex?.userData.url as string | undefined) ?? null;
    if (want !== have) {
      this.bodySkinTex?.dispose();
      this.bodySkinTex = null;
      if (want) {
        const tex = this.texLoader.load(want);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.userData.url = want;
        this.bodySkinTex = tex;
      }
    }
    for (const m of this.bodyMaterials) {
      if (m.userData.skinSurface) continue;
      if (!this.bodyBaseMaps.has(m)) this.bodyBaseMaps.set(m, m.map);
      const baseMap = this.bodyBaseMaps.get(m) ?? null;
      m.map = this.bodySkinTex ?? baseMap;
      if (bs) {
        m.color.setRGB(bs.colorMultiply[0], bs.colorMultiply[1], bs.colorMultiply[2]);
        if (bs.roughness !== undefined) m.roughness = bs.roughness;
      } else {
        m.color.setRGB(1, 1, 1);
        m.roughness = 0.6; // converter bake default
      }
      m.needsUpdate = true;
    }
  }

  // Bone an origin-authored static accessory attaches to, by slot.
  private staticBone(slot: Slot): THREE.Bone | null {
    const bone = (...names: string[]) => {
      for (const n of names) {
        const b = this.bonesByName.get(n);
        if (b) return b;
      }
      return null;
    };
    switch (slot) {
      case "wrist":
        return bone("hand_l", "lowerarm_l");
      case "hands":
        // origin-authored hand props (foam gloves etc.) — held in the right hand in-game
        return bone("hand_r", "lowerarm_r");
      case "earrings": {
        // Earrings are authored at the EAR-SOCKET origin (mm-scale offset) — parenting to the
        // head bone buries them at skull centre (verified: skull-01 sat at (0,1.68,-0.02),
        // invisible inside the head). The ear bones are FACIAL_* bones that exist only on the
        // equipped head's own armature (the body skeleton has no facial bones). Single-earring
        // items are visually side-agnostic; prefer the LEFT lobe (matches in-game icons).
        const face = this.equipped.get("face");
        let lobe: THREE.Bone | null = null;
        face?.scene.traverse((o) => {
          const b = o as THREE.Bone;
          if (!b.isBone || !/earlobe/i.test(b.name)) return;
          if (!lobe || /_L_/i.test(b.name)) lobe = b;
        });
        return lobe ?? bone("head", "neck_01");
      }
      case "eyewear":
      case "facewear":
      case "headwear":
        return bone("head", "neck_01");
      case "upperBack":
      case "lowerBack":
        return bone("spine_03", "spine_02", "spine_01");
      case "upperBody":
      case "outerwear":
        // origin-authored torso props (tool cases, chest rigs) — most upper-body items
        // are skinned and never reach this path
        return bone("spine_03", "spine_02");
      default:
        return null; // hair etc. — authored in body space, stays under root
    }
  }

  // Load a piece's garment print decals (cap 4 — each costs a texture unit in the patched
  // shader). Failures skip the decal rather than failing the equip.
  // Origin-authored eyewear has no actor/socket transform in the extracted static mesh. Derive
  // its anchor from the equipped head's visible eyeball geometry instead of inventing a world
  // coordinate (rooted, body-space eyewear such as GamingGlasses never enters this path).
  private eyeWorldCenter(): THREE.Vector3 | null {
    const face = this.equipped.get("face")?.scene;
    if (!face) return null;
    face.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    let found = false;
    face.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const label = [mesh.name, ...mats.map((m) => m.name)].join(" ");
      if (!/eye/i.test(label) || /shell|edge|lash|brow/i.test(label)) return;
      const part = new THREE.Box3().setFromObject(mesh);
      if (part.isEmpty()) return;
      box.union(part);
      found = true;
    });
    return found ? box.getCenter(new THREE.Vector3()) : null;
  }

  private async loadGarmentDecals(mat?: RigMaterial): Promise<GarmentDecalTex[]> {
    if (!mat?.garmentDecals?.length) return [];
    const out: GarmentDecalTex[] = [];
    for (const d of mat.garmentDecals.slice(0, 4)) {
      try {
        const tex = await this.texLoader.loadAsync(d.url);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false; // match glTF UV convention (vMapUv)
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        out.push({
          region: d.region,
          place: d.place,
          tex,
          colorA: d.colorA ? new THREE.Color(d.colorA) : undefined,
          colorB: d.colorB ? new THREE.Color(d.colorB) : undefined,
        });
      } catch (e) {
        console.warn(`[CharacterRig] failed to load garment decal '${d.url}'`, e);
      }
    }
    return out;
  }

  private sceneTextures(scene: THREE.Object3D, extra: THREE.Object3D[] = []): Set<THREE.Texture> {
    const textures = new Set<THREE.Texture>();
    for (const root of [scene, ...extra]) root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of [...Object.values(material), ...Object.values(material.userData)]) {
          if ((value as THREE.Texture | undefined)?.isTexture) textures.add(value as THREE.Texture);
        }
      }
    });
    return textures;
  }

  private async loadBindingTexture(url: string | undefined, colorSpace: THREE.ColorSpace): Promise<THREE.Texture | null> {
    if (!url) return null;
    try {
      const texture = await this.texLoader.loadAsync(url);
      texture.colorSpace = colorSpace;
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      return texture;
    } catch (error) {
      console.warn(`[CharacterRig] failed to load material texture '${url}'`, error);
      return null;
    }
  }

  private async loadMaterialBindings(
    bindings: Record<string, RigMaterialBinding>,
    scene: THREE.Object3D,
  ): Promise<Map<string, LoadedMaterial>> {
    const names = new Set(this.collectStandardMaterials(scene).map((material) => material.name));
    const loaded = new Map<string, LoadedMaterial>();
    await Promise.all(Object.entries(bindings).map(async ([name, material]) => {
      // Do not fetch assets for names absent from this GLB or unsupported source shaders.
      if (!names.has(name)) return;
      const entry: LoadedMaterial = {
        material, region: null, decals: [], baked: null, emissive: null, glassNormal: null, led: null,
      };
      if (this.usesStandardBinding(material)) {
        [entry.baked, entry.decals, entry.emissive] = await Promise.all([
          this.loadBakedSet(material), this.loadGarmentDecals(material), this.loadEmissiveMap(material),
        ]);
        if (!entry.baked) entry.region = await this.loadRegionMap(material);
      } else if (material.family === "glass" && material.glass) {
        entry.glassNormal = await this.loadBindingTexture(material.glass.normal, THREE.NoColorSpace);
      } else if (material.family === "led" && material.ledScreen) {
        const [animation, colorRamp, normal] = await Promise.all([
          this.loadBindingTexture(material.ledScreen.animation, THREE.SRGBColorSpace),
          this.loadBindingTexture(material.ledScreen.colorRamp, THREE.SRGBColorSpace),
          this.loadBindingTexture(material.ledScreen.normal, THREE.NoColorSpace),
        ]);
        if (animation) {
          animation.magFilter = THREE.NearestFilter;
          animation.minFilter = THREE.NearestFilter;
          animation.generateMipmaps = false;
          entry.led = { animation, colorRamp, normal };
        } else {
          colorRamp?.dispose();
          normal?.dispose();
        }
      }
      loaded.set(name, entry);
    }));
    return loaded;
  }

  private usesStandardBinding(material: RigMaterialBinding): boolean {
    if (material.family === "glass" || material.family === "led") return false;
    // A single-material item may carry explicit legacy colour/PBR data even when its
    // source shader has no reconstruction. Metadata alone preserves the embedded GLB
    // appearance for every family, including a layered slot awaiting its own bake.
    return Object.entries(material).some(([key, value]) =>
      value !== undefined && !["family", "doubleSided", "glass", "ledScreen"].includes(key));
  }

  private applyMaterialBindings(
    mesh: THREE.Mesh,
    bindings: Map<string, LoadedMaterial>,
    applied: Map<THREE.Material, THREE.Material>,
    hairCoverage: THREE.Texture | null,
  ): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const result = materials.map((source) => {
      const previous = applied.get(source);
      if (previous) return previous;
      const binding = bindings.get(source.name);
      if (!binding || !(source as THREE.MeshStandardMaterial).isMeshStandardMaterial) return source;
      const { material } = binding;
      let output = source as THREE.MeshStandardMaterial;
      if (material.family === "glass" && material.glass) {
        this.clearSurfaceMaps(output);
        output.color.set(material.glass.color);
        output.opacity = material.glass.opacity;
        output.roughness = material.glass.roughness;
        output.normalMap = binding.glassNormal;
        output.metalness = 0;
        output.transparent = output.opacity < 1;
        output.depthWrite = !output.transparent;
        output.alphaTest = 0;
      } else if (material.family === "led") {
        this.clearSurfaceMaps(output);
        output.color.set(0x050505);
        output.roughness = 0.25;
        output.metalness = 0;
        output.transparent = false;
        output.depthWrite = true;
        output.alphaTest = 0;
        if (binding.led && material.ledScreen) this.applyLedScreen(output, material.ledScreen, binding.led);
      } else if (this.usesStandardBinding(material)) {
        // Reuse the existing shader implementation with one material at a time. Source
        // family replaces the legacy glass-name guess on this authoritative path.
        const carrier = new THREE.Mesh(mesh.geometry, output);
        this.applyMaterial(carrier, material, binding.region, binding.decals, binding.baked,
          hairCoverage, binding.emissive, false);
        output = carrier.material;
        // A material can be removed before its first shader compile. Own decal textures
        // immediately, instead of relying on onBeforeCompile to register them for cleanup.
        binding.decals.forEach((decal, index) => { output.userData[`garmentDecalTex${index}`] = decal.tex; });
      }
      if (hairCoverage && !this.usesStandardBinding(material)) {
        output.alphaMap = hairCoverage;
        output.alphaTest = 0.5;
        output.transparent = false;
        output.side = THREE.DoubleSide;
        output.envMapIntensity = 0.55;
      }
      if (material.doubleSided !== undefined) {
        output.side = material.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      }
      output.needsUpdate = true;
      applied.set(source, output);
      return output;
    });
    mesh.material = Array.isArray(mesh.material) ? result : result[0];
  }

  private clearSurfaceMaps(material: THREE.MeshStandardMaterial): void {
    material.map = material.normalMap = material.roughnessMap = material.metalnessMap = null;
    material.alphaMap = material.aoMap = material.emissiveMap = null;
    material.emissive.set(0x000000);
    material.emissiveIntensity = 1;
  }

  private applyLedScreen(
    material: THREE.MeshStandardMaterial,
    screen: NonNullable<RigMaterialBinding["ledScreen"]>,
    textures: NonNullable<LoadedMaterial["led"]>,
  ): void {
    material.map ??= CharacterRig.whiteTex(); // ensures vMapUv exists on the standard shader
    material.normalMap = textures.normal;
    material.emissive.set(0xffffff);
    material.userData.ledAnimationTexture = textures.animation;
    material.userData.ledScreen = screen;
    if (textures.colorRamp) material.userData.ledColorRampTexture = textures.colorRamp;
    const time = { value: screen.captureTime ?? 0 };
    const start = performance.now();
    if (screen.captureTime === undefined) material.onBeforeRender = () => {
      time.value = (performance.now() - start) / 1000;
    };
    const tint = new THREE.Color(screen.tint ?? "#ffffff");
    const rampImage = textures.colorRamp?.image as { width?: number; height?: number } | undefined;
    const verticalRamp = (rampImage?.height ?? 1) > (rampImage?.width ?? 1);
    const atlasImage = textures.animation.image as { width?: number; height?: number } | undefined;
    const pixelWidth = screen.pixelWidth ?? (atlasImage?.width ?? screen.trackCount) / screen.trackCount;
    const pixelHeight = screen.pixelHeight ?? (atlasImage?.height ?? screen.frameCount) / screen.frameCount;
    const key = `led-${CharacterRig.tintUid++}`;
    material.customProgramCacheKey = () => key;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uLedAnimation = { value: textures.animation };
      shader.uniforms.uLedColorRamp = { value: textures.colorRamp ?? CharacterRig.whiteTex() };
      shader.uniforms.uLedTime = time;
      shader.uniforms.uLedTint = { value: tint };
      shader.uniforms.uLedBrightness = { value: screen.brightness };
      // The exported atlas has tracks in columns and frames in rows. Placement is a
      // reconstruction from source UV scalars; the cooked Unreal shader graph is absent.
      shader.fragmentShader = [
        "uniform sampler2D uLedAnimation;",
        "uniform sampler2D uLedColorRamp;",
        "uniform float uLedTime;",
        "uniform vec3 uLedTint;",
        "uniform float uLedBrightness;",
        shader.fragmentShader,
      ].join("\n").replace("#include <emissivemap_fragment>", [
        `vec2 ledUv = (vMapUv - 0.5) / ${screen.uvScale.toFixed(8)} + 0.5 + vec2(${(screen.uvOffsetU ?? 0).toFixed(8)}, ${screen.uvOffsetV.toFixed(8)});`,
        "float ledInside = step(0.0, ledUv.x) * step(ledUv.x, 1.0) * step(0.0, ledUv.y) * step(ledUv.y, 1.0);",
        `float ledFrame = mod(floor(uLedTime * ${screen.animationSpeed.toFixed(8)}), ${screen.frameCount.toFixed(1)});`,
        `vec2 ledAtlasUv = (clamp(ledUv, 0.001, 0.999) + vec2(${Math.min(screen.animationTrack, screen.trackCount - 1).toFixed(1)}, ledFrame)) / vec2(${screen.trackCount.toFixed(1)}, ${screen.frameCount.toFixed(1)});`,
        "vec4 ledPixel = texture2D(uLedAnimation, ledAtlasUv);",
        `vec2 ledCell = fract(ledUv * vec2(${pixelWidth.toFixed(8)}, ${pixelHeight.toFixed(8)})) - 0.5;`,
        "float ledRadius = length(ledCell);",
        "float ledEdge = max(fwidth(ledRadius), 0.0001);",
        "float ledCoverage = 1.0 - smoothstep(0.5 - ledEdge, 0.5 + ledEdge, ledRadius);",
        textures.colorRamp
          ? `vec3 ledColor = texture2D(uLedColorRamp, ${verticalRamp ? "vec2(0.5, clamp(ledUv.x, 0.0, 1.0))" : "vec2(clamp(ledUv.x, 0.0, 1.0), 0.5)"}).rgb;`
          : "vec3 ledColor = vec3(1.0);",
        "totalEmissiveRadiance = ledPixel.rgb * ledPixel.a * ledColor * uLedTint * uLedBrightness * ledInside * ledCoverage;",
      ].join("\n"));
    };
  }

  // Load a skin's baked layered-composite set (albedo/normal/orm — scripts/bake-composite.mjs).
  // Assigned straight onto the mesh's MeshStandardMaterial; the textures sit on standard
  // material slots so dispose.ts frees them with the cosmetic scene on unequip.
  private async loadBakedSet(
    mat?: RigMaterial,
  ): Promise<{ map: THREE.Texture; normalMap: THREE.Texture; orm: THREE.Texture } | null> {
    if (!mat?.bakedSet) return null;
    const results = await Promise.allSettled([
      this.texLoader.loadAsync(mat.bakedSet.albedo),
      this.texLoader.loadAsync(mat.bakedSet.normal),
      this.texLoader.loadAsync(mat.bakedSet.orm),
    ]);
    if (results.some((result) => result.status === "rejected")) {
      for (const result of results) if (result.status === "fulfilled") result.value.dispose();
      console.warn(`[CharacterRig] failed to load baked set`, results.filter((result) => result.status === "rejected"));
      return null;
    }
    const [map, normalMap, orm] = results.map((result) => (result as PromiseFulfilledResult<THREE.Texture>).value);
    map.colorSpace = THREE.SRGBColorSpace;
    normalMap.colorSpace = THREE.NoColorSpace;
    orm.colorSpace = THREE.NoColorSpace;
    for (const t of [map, normalMap, orm]) {
      t.flipY = false; // glTF UV convention (vMapUv / UV0), matches the baked maps
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
    }
    return { map, normalMap, orm };
  }

  // Load a hair's strand-coverage mask (greyscale; white = hair). Used as an alphaMap +
  // alphaTest so the flat cards cut out into strands. Absent (cel-shaded / solid hairs) 404s
  // and skips — those render opaque, which is correct for them.
  private async loadHairCoverage(url: string): Promise<THREE.Texture | null> {
    try {
      const tex = await this.texLoader.loadAsync(url);
      tex.colorSpace = THREE.NoColorSpace; // a mask, not color (three reads alphaMap.g)
      tex.flipY = false; // match glTF UV convention (vMapUv / UV0)
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      return tex;
    } catch {
      return null; // no sibling coverage for this hair — leave it opaque
    }
  }

  private async loadRegionMap(mat?: RigMaterial): Promise<THREE.Texture | null> {
    if (!mat?.regionMapUrl || !mat.regionColors?.length) return null;
    try {
      const tex = await this.texLoader.loadAsync(mat.regionMapUrl);
      tex.colorSpace = THREE.NoColorSpace; // part indices, not color
      tex.flipY = false; // match glTF UV convention (vMapUv)
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      return tex;
    } catch (e) {
      console.warn(`[CharacterRig] failed to load region map '${mat.regionMapUrl}'`, e);
      return null;
    }
  }

  private async loadEmissiveMap(mat?: RigMaterial): Promise<THREE.Texture | null> {
    if (!mat?.emissiveMapUrl) return null;
    try {
      const tex = await this.texLoader.loadAsync(mat.emissiveMapUrl);
      tex.colorSpace = THREE.SRGBColorSpace; // emissive is a colour map
      tex.flipY = false; // glTF UV convention (vMapUv)
      tex.needsUpdate = true;
      return tex;
    } catch (e) {
      console.warn(`[CharacterRig] failed to load emissive map '${mat.emissiveMapUrl}'`, e);
      return null;
    }
  }

  // Eyewear lenses: the source names lens materials "*Glass*" / "*Lens*", usually with a tint word
  // ("MI_RoundSunglasses_Glass_Purple"). Map the word to a glass colour; everything else reads as
  // clear. Without this the region/baked pass paints lenses opaque grey/black (audit: ~9 eyewear).
  private static readonly GLASS_TINT: Record<string, string> = {
    purple: "#7a5bd0", violet: "#7a5bd0", red: "#9e2733", crimson: "#9e2733", pink: "#e070a0",
    blue: "#3b6fd0", cyan: "#40b0c0", green: "#3aa060", yellow: "#d6c33a", gold: "#c9a23c",
    amber: "#c98a30", orange: "#cf7a2e", black: "#15151a", smoked: "#15151a", dark: "#1b1b20",
    brown: "#3a2a1e", silver: "#aeb4ba", mirror: "#aeb4ba", clear: "#e2e8ef", white: "#e2e8ef",
  };
  private static isGlass(m: THREE.Material | undefined): boolean {
    // A LENS material says "Lens" or "Glass" (MI_Glass_UEMat01, MI_RoundSunglasses_Glass_Purple,
    // BlackGlass). The piece word "(Sun)glasses" appears in FRAME material names
    // (MI_CasualGlasses_CasualGlasses, MI_AviatorSunglasses) — matching it turned every
    // spectacle FRAME translucent clear-white (census: all ~50 eyewear scored 45-55).
    return !!m && /lens|glass(?!es)/i.test(m.name ?? "");
  }
  private applyGlass(std: THREE.MeshStandardMaterial): void {
    const word = (/(?:glass|lens)[_\- ]?([a-z]+)/i.exec(std.name) ?? [])[1]?.toLowerCase();
    const clear = !word || word === "clear" || word === "transparent" || word === "glass";
    std.color = new THREE.Color(CharacterRig.GLASS_TINT[word ?? ""] ?? "#cfd6de");
    std.map = null; // the baked/neutral lens albedo is the source of the opaque grey
    std.transparent = true;
    std.opacity = clear ? 0.18 : 0.44;
    std.roughness = 0.07;
    std.metalness = 0;
    std.depthWrite = false; // translucent: don't occlude what's behind the lens
    std.needsUpdate = true;
  }

  // Apply per-skin material data to a mesh: set roughness/metalness, and (when a region map
  // + colors exist) patch each MeshStandardMaterial with the region-color shader.
  private applyMaterial(
    mesh: THREE.Mesh,
    mat: RigMaterial | undefined,
    regionTex: THREE.Texture | null,
    garmentDecals: GarmentDecalTex[] = [],
    baked: { map: THREE.Texture; normalMap: THREE.Texture; orm: THREE.Texture } | null = null,
    hairCov: THREE.Texture | null = null,
    emissiveTex: THREE.Texture | null = null,
    useGlassHeuristic = true,
  ): void {
    // Hair coverage cuts the flat cards into strands — apply first (independent of dye data, and
    // needed even if `mat` is absent). DoubleSide: cards are single-sided planes seen from both
    // faces; alphaTest (not blend) so strands depth-write and don't need back-to-front sorting.
    if (hairCov) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        std.alphaMap = hairCov;
        std.alphaTest = 0.5;
        std.transparent = false;
        std.side = THREE.DoubleSide;
        // Flat hair lacks the game's anisotropic strand speculars, so the neutral studio env
        // irradiance washes the (low-saturation) brown/blonde base toward grey-ash. Damp the
        // env contribution so the warm pigment reads through; the key light still lights it.
        std.envMapIntensity = 0.55;
        std.needsUpdate = true;
      }
    }
    if (!mat) return;
    // Self-illuminated cosmetics (pumpkin glow, blankface LED, gas-mask lenses): assign the
    // emissive map to every sub-material up front so it survives whichever path runs below
    // (baked / region / plain — and the sheen path's phys.copy carries it). Emissive colour is
    // white; the map carries the glow's shape + colour, emissiveIntensity scales it. The
    // convert-time Blender emissive bake is unreliable, so the rig owns this.
    if (emissiveTex) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        std.emissive = new THREE.Color(0xffffff);
        std.emissiveMap = emissiveTex;
        std.emissiveIntensity = mat.emissiveIntensity ?? 1;
        std.needsUpdate = true;
      }
    }
    // Glass lenses (eyewear): translucent tinted glass, NOT an opaque region/baked surface. Done
    // before the branches below, which skip glass materials via the CharacterRig.isGlass guards.
    {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if (useGlassHeuristic && CharacterRig.isGlass(m)) this.applyGlass(m as THREE.MeshStandardMaterial);
    }
    // Baked layered composite: the per-skin look is fully resolved (color + detail + pattern
    // + AO in the albedo; spatial roughness/metalness in the orm). Assign it straight onto the
    // standard material and skip the region-tint shader entirely — correct by construction.
    if (baked) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (useGlassHeuristic && CharacterRig.isGlass(std)) continue;
        std.map = baked.map;
        std.normalMap = baked.normalMap;
        std.roughnessMap = baked.orm; // three reads G
        std.metalnessMap = baked.orm; // three reads B
        std.roughness = 1; // maps are the full signal; factors are pure multipliers
        std.metalness = 1;
        std.color.set(0xffffff);
        // NOTE: the coat back "opening" is GENUINE missing geometry in the game mesh (forcing
        // opaque does NOT fill it — tested), revealed in-game by a merged undersuit we don't
        // have. Do NOT force opaque here: alpha is load-bearing for mesh/lace/fishnet garments.
        // Garment prints (KCP graphic, satin "32" number, …) aren't baked into the albedo —
        // overlay them on top of the finished composite (placement-localized; the region gate
        // is dropped since the baked path carries no region map). An undersuit shown through an
        // open coat instead gets a flat recolour to the coat's hue (mutually exclusive: the
        // chosen tint undersuit is decal-free).
        if (garmentDecals.length) this.injectGarmentDecals(std, garmentDecals);
        else if (mat.tintRecolor) this.injectFlatRecolor(std, mat.tintRecolor);
        std.needsUpdate = true;
      }
      return;
    }
    // Cloth regions get a sheen lobe (soft fabric fresnel instead of a hard specular) —
    // that needs MeshPhysicalMaterial, which extends standard so copy() carries everything.
    const wantsSheen = this.opts.sheen !== false && !!mat.regionSheen?.some((s) => s > 0.3);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < mats.length; i++) {
      let std = mats[i] as THREE.MeshStandardMaterial;
      if (useGlassHeuristic && CharacterRig.isGlass(std)) continue;
      if (wantsSheen && std.isMeshStandardMaterial && !(std as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
        const phys = new THREE.MeshPhysicalMaterial();
        phys.copy(std);
        phys.sheen = 1;
        phys.sheenRoughness = 0.75;
        phys.sheenColor.set(0xffffff);
        if (Array.isArray(mesh.material)) mesh.material[i] = phys;
        else mesh.material = phys;
        std.dispose(); // textures are shared with phys and dispose() doesn't free them
        mats[i] = phys;
        std = phys;
      }
      // The importer derives sane values (cloth-gated metalness, floored roughness) — apply
      // them directly; the baked GLB carries a placeholder 0.6.
      std.roughness = mat.roughness ?? 0.6;
      if (mat.metalness !== undefined) std.metalness = mat.metalness;
      // Textureless bake (no albedo in the dump): substitute a white map + unit normalizer
      // so each region renders exactly its authored color (no base shading to modulate).
      let meanLuma = mat.regionMeanLuma;
      if (regionTex && mat.regionColors?.length && !std.map) {
        std.map = CharacterRig.whiteTex();
        meanLuma = mat.regionColors.map(() => 1);
      }
      if (regionTex && mat.regionColors?.length && std.map) {
        this.patchRegions(
          std,
          regionTex,
          mat.regionColors,
          mat.regionRoughness,
          mat.regionMetalness,
          wantsSheen ? mat.regionSheen : undefined,
          meanLuma,
          garmentDecals,
        );
      } else if (!regionTex && mat.regionColors?.length === 1) {
        // No region map (e.g. hair, an untextured mesh): a single flat tint.
        std.color = new THREE.Color(mat.regionColors[0]);
        std.needsUpdate = true;
      }
    }
  }

  // Recolour a baked albedo so its REGION AVERAGE lands on `hex` (the coat's mean colour),
  // keeping the base's relative shading variation. The chosen tint undersuit (a plain light-grey
  // nylon top) has a measured mean linear luma of ~0.5, so dividing the per-texel luma by 0.5
  // normalises the base to average 1.0 — then `tint * normalised` averages exactly to the tint
  // (value AND hue), so a dark coat gets a correspondingly dark undersuit (not a bright one).
  // The open back then reads as the same colour as the coat instead of a stray panel.
  private static readonly TINT_UNDERSUIT_MEAN_LUMA = 0.5;
  private injectFlatRecolor(std: THREE.MeshStandardMaterial, hex: string): void {
    const c = new THREE.Color(hex); // sRGB hex -> linear working space (matches diffuseColor)
    const cacheKey = `flattint-${CharacterRig.tintUid++}`;
    std.customProgramCacheKey = () => cacheKey;
    std.onBeforeCompile = (shader) => {
      shader.uniforms.uFlatTint = { value: new THREE.Vector3(c.r, c.g, c.b) };
      shader.uniforms.uFlatRefLuma = { value: CharacterRig.TINT_UNDERSUIT_MEAN_LUMA };
      shader.fragmentShader =
        "uniform vec3 uFlatTint;\nuniform float uFlatRefLuma;\n" +
        shader.fragmentShader.replace(
          "#include <map_fragment>",
          [
            "#include <map_fragment>",
            "{",
            "  float baseLuma = clamp( dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ), 0.0, 1.0 );",
            "  float shade = clamp( baseLuma / max( uFlatRefLuma, 1e-3 ), 0.0, 2.0 );",
            "  diffuseColor.rgb = clamp( uFlatTint * shade, 0.0, 1.0 );",
            "}",
          ].join("\n"),
        );
    };
  }

  // Overlay garment print decals on a material WITHOUT the region-tint shader (used by the
  // baked-composite path). Same placement decode as patchRegions but ungated by region.
  private injectGarmentDecals(std: THREE.MeshStandardMaterial, garmentDecals: GarmentDecalTex[]): void {
    const decals = garmentDecals.slice(0, 4);
    if (!decals.length) return;
    const cacheKey = `bakeddecal-${decals.length}-${CharacterRig.tintUid++}`;
    std.customProgramCacheKey = () => cacheKey;
    std.onBeforeCompile = (shader) => {
      let prelude = "";
      const glsl: string[] = [];
      decals.forEach((d, i) => {
        shader.uniforms[`uGDecalTex${i}`] = { value: d.tex };
        shader.uniforms[`uGDecalPlace${i}`] = {
          value: new THREE.Vector4(d.place[0], d.place[1], d.place[2], d.place[3] ?? 0),
        };
        std.userData[`garmentDecalTex${i}`] = d.tex; // freed by dispose.ts via userData
        prelude += `uniform sampler2D uGDecalTex${i};\nuniform vec4 uGDecalPlace${i};\n`;
        // Chromatic scheme: the decal `_M` is a luminance mask — recolour it light→colorA,
        // dark→colorB (e.g. AlfaActa: white→white, black→red). Absent = render the texture as-is.
        const recolor = !!(d.colorA && d.colorB);
        if (recolor) {
          shader.uniforms[`uGDecalColA${i}`] = { value: new THREE.Vector3(d.colorA!.r, d.colorA!.g, d.colorA!.b) };
          shader.uniforms[`uGDecalColB${i}`] = { value: new THREE.Vector3(d.colorB!.r, d.colorB!.g, d.colorB!.b) };
          prelude += `uniform vec3 uGDecalColA${i};\nuniform vec3 uGDecalColB${i};\n`;
        }
        glsl.push(
          "{",
          `  vec4 pl = uGDecalPlace${i};`,
          // scale (pl.z) ~1 = a full-UV decal authored to the piece's own UV (e.g. KCP merch
          // overlay) -> sample identity; otherwise it's a small placed print, centered+scaled.
          "  vec2 duv = pl.z >= 0.95 ? vMapUv : ( vMapUv - vec2( pl.x, 0.5 - pl.y ) ) / max( pl.z, 1e-4 ) + 0.5;",
          "  if ( duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0 ) {",
          `    vec4 dc = texture2D( uGDecalTex${i}, duv );`,
          recolor
            ? `    vec3 dcol = mix( uGDecalColB${i}, uGDecalColA${i}, dot( dc.rgb, vec3( 0.299, 0.587, 0.114 ) ) );`
            : "    vec3 dcol = dc.rgb;",
          "    diffuseColor.rgb = mix( diffuseColor.rgb, dcol, dc.a );",
          "  }",
          "}",
        );
      });
      shader.fragmentShader =
        prelude +
        shader.fragmentShader.replace(
          "#include <map_fragment>",
          ["#include <map_fragment>", ...glsl].join("\n"),
        );
    };
  }

  // Reconstruct the game's layered-dye look on a baked MeshStandardMaterial via
  // onBeforeCompile (keeps skinning/lights/shadows/IBL/tonemapping intact). The region map
  // gives each pixel a part index; that part is recolored to its authored color, modulated
  // by the baked base's shading detail:
  //   shade = baseLuma / meanLuma(region)  — the base normalized so its REGION AVERAGE is
  //   1.0; multiplying the authored color by shade^gamma keeps wrinkles/AO while landing
  //   the region's average exactly on the authored color. Without meanLuma (older data)
  //   fall back to the luminance-preserving recolor.
  private patchRegions(
    std: THREE.MeshStandardMaterial,
    regionTex: THREE.Texture,
    colors: string[],
    roughArr?: number[],
    metalArr?: number[],
    sheenArr?: number[],
    meanLumaArr?: number[],
    garmentDecals: GarmentDecalTex[] = [],
  ): void {
    const n = Math.min(colors.length, 16);
    const flat = new Float32Array(n * 3); // sRGB hex -> linear working space
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.set(colors[i]);
      flat[i * 3] = c.r;
      flat[i * 3 + 1] = c.g;
      flat[i * 3 + 2] = c.b;
    }
    // Optional per-part PBR: each part's material layer carries a roughness/metalness so
    // metallic trims read shiny instead of inheriting one flat material value.
    const pbr = !!(roughArr?.length && metalArr?.length);
    const rough = pbr ? Float32Array.from({ length: n }, (_, i) => roughArr![i] ?? 0.6) : null;
    const metal = pbr ? Float32Array.from({ length: n }, (_, i) => metalArr![i] ?? 0) : null;
    const hasLuma = !!(meanLumaArr && meanLumaArr.length >= n);
    const luma = hasLuma ? Float32Array.from({ length: n }, (_, i) => meanLumaArr[i]) : null;
    const sheen = sheenArr?.length
      ? Float32Array.from({ length: n }, (_, i) => sheenArr[i] ?? 0)
      : null;

    std.userData.regionMapTexture = regionTex; // disposed by dispose.ts via userData
    // Unique per material instance: custom onBeforeCompile uniforms are captured only on a
    // program cache-MISS, so sharing a program would share one uniforms object.
    const cacheKey = `region-${n}-${pbr ? "pbr" : "x"}-${CharacterRig.tintUid++}`;
    std.customProgramCacheKey = () => cacheKey;
    std.onBeforeCompile = (shader) => {
      shader.uniforms.uRegionMap = { value: regionTex };
      shader.uniforms.uRegionColors = { value: flat };
      shader.uniforms.uTintAmount = { value: 1.0 };
      let prelude =
        `#define REGION_COUNT ${n}\n` +
        "uniform sampler2D uRegionMap;\n" +
        "uniform vec3 uRegionColors[REGION_COUNT];\n" +
        "uniform float uTintAmount;\n";
      if (pbr) {
        shader.uniforms.uRegionRough = { value: rough };
        shader.uniforms.uRegionMetal = { value: metal };
        prelude +=
          "uniform float uRegionRough[REGION_COUNT];\n" +
          "uniform float uRegionMetal[REGION_COUNT];\n";
      }
      if (hasLuma) {
        shader.uniforms.uRegionMeanLuma = { value: luma };
        shader.uniforms.uShadeGamma = { value: 1.0 };
        prelude +=
          "uniform float uRegionMeanLuma[REGION_COUNT];\n" + "uniform float uShadeGamma;\n";
      }
      if (sheen) {
        shader.uniforms.uRegionSheen = { value: sheen };
        prelude += "uniform float uRegionSheen[REGION_COUNT];\n";
      }
      // Garment print decals: sampled after the region recolor, alpha-blended on top.
      // Placement maps the decal into UV space: duv = (uv - offset)/scale + 0.5, optionally
      // gated to the decal's region. (Rotation in place.w is rare and currently ignored.)
      const decalGlsl: string[] = [];
      garmentDecals.forEach((d, i) => {
        shader.uniforms[`uGDecalTex${i}`] = { value: d.tex };
        shader.uniforms[`uGDecalPlace${i}`] = {
          value: new THREE.Vector4(d.place[0], d.place[1], d.place[2], d.place[3] ?? 0),
        };
        std.userData[`garmentDecalTex${i}`] = d.tex; // disposed by dispose.ts via userData
        prelude += `uniform sampler2D uGDecalTex${i};\nuniform vec4 uGDecalPlace${i};\n`;
        const recolor = !!(d.colorA && d.colorB);
        if (recolor) {
          shader.uniforms[`uGDecalColA${i}`] = { value: new THREE.Vector3(d.colorA!.r, d.colorA!.g, d.colorA!.b) };
          shader.uniforms[`uGDecalColB${i}`] = { value: new THREE.Vector3(d.colorB!.r, d.colorB!.g, d.colorB!.b) };
          prelude += `uniform vec3 uGDecalColA${i};\nuniform vec3 uGDecalColB${i};\n`;
        }
        const gate = d.region >= 0 ? `vRegionIdx == ${d.region} && ` : "";
        decalGlsl.push(
          "{",
          `  vec4 pl = uGDecalPlace${i};`,
          // Placement decoded vs the garment UV (measured with an injected UV-grid texture
          // on the BasicTshirt): center = (pl.x, 0.5 - pl.y) — UE's V offset points up —
          // and pl.z is the decal's full extent.
          // scale (pl.z) ~1 = a full-UV decal authored to the piece's own UV (e.g. KCP merch
          // overlay) -> sample identity; otherwise it's a small placed print, centered+scaled.
          "  vec2 duv = pl.z >= 0.95 ? vMapUv : ( vMapUv - vec2( pl.x, 0.5 - pl.y ) ) / max( pl.z, 1e-4 ) + 0.5;",
          `  if ( ${gate}duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0 ) {`,
          `    vec4 dc = texture2D( uGDecalTex${i}, duv );`,
          recolor
            ? `    vec3 dcol = mix( uGDecalColB${i}, uGDecalColA${i}, dot( dc.rgb, vec3( 0.299, 0.587, 0.114 ) ) );`
            : "    vec3 dcol = dc.rgb;",
          "    diffuseColor.rgb = mix( diffuseColor.rgb, dcol, dc.a );",
          "  }",
          "}",
        );
      });
      // Keep the uniforms reachable for calibration/debug (uTintAmount, uShadeGamma).
      std.userData.regionShaderUniforms = shader.uniforms;
      const recolor = hasLuma
        ? [
            "{",
            "  float baseLuma = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );",
            "  float shade = clamp( baseLuma / max( uRegionMeanLuma[ vRegionIdx ], 1e-3 ), 0.0, 2.0 );",
            "  vec3 recolored = uRegionColors[ vRegionIdx ] * pow( max( shade, 1e-4 ), uShadeGamma );",
            "  diffuseColor.rgb = mix( diffuseColor.rgb, recolored, uTintAmount );",
            "}",
          ]
        : [
            "{",
            "  vec3 tint = uRegionColors[ vRegionIdx ];",
            // Luminance-preserving recolor: colorway hue/saturation, base shading for value.
            "  float baseLuma = clamp( dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ), 0.0, 1.0 );",
            "  float tintLuma = max( dot( tint, vec3( 0.299, 0.587, 0.114 ) ), 0.04 );",
            "  vec3 recolored = clamp( tint * ( baseLuma / tintLuma ), 0.0, 1.0 );",
            "  diffuseColor.rgb = mix( diffuseColor.rgb, recolored, uTintAmount );",
            "}",
          ];
      let frag = shader.fragmentShader.replace(
        "#include <map_fragment>",
        [
          "#include <map_fragment>",
          // region map stores the part index as value/255*(N-1); declared at main scope so the
          // roughness/metalness/sheen chunks below can reuse it.
          "int vRegionIdx = int( floor( texture2D( uRegionMap, vMapUv ).r * float( REGION_COUNT - 1 ) + 0.5 ) );",
          ...recolor,
          ...decalGlsl,
        ].join("\n"),
      );
      if (pbr) {
        frag = frag
          .replace(
            "#include <roughnessmap_fragment>",
            "#include <roughnessmap_fragment>\n\troughnessFactor = uRegionRough[ vRegionIdx ];",
          )
          .replace(
            "#include <metalnessmap_fragment>",
            "#include <metalnessmap_fragment>\n\tmetalnessFactor = uRegionMetal[ vRegionIdx ];",
          );
      }
      if (sheen) {
        // Gate the physical material's sheen lobe per region (cloth only). `material` is the
        // PhysicalMaterial struct declared by this chunk; USE_SHEEN is set because sheen=1.
        frag = frag.replace(
          "#include <lights_physical_fragment>",
          "#include <lights_physical_fragment>\n#ifdef USE_SHEEN\n\tmaterial.sheenColor *= uRegionSheen[ vRegionIdx ];\n#endif",
        );
      }
      if (this.opts.albedoDebug) {
        // Calibration mode: bypass lighting, emit the recolored albedo. The viewer pairs
        // this with NoToneMapping, so the framebuffer is exactly sRGB(albedo).
        frag = frag.replace(
          "#include <opaque_fragment>",
          "gl_FragColor = vec4( diffuseColor.rgb, diffuseColor.a );",
        );
      }
      shader.fragmentShader = prelude + frag;
    };
    std.needsUpdate = true;
  }

  // DEV material tuner: live-push global PBR tweaks onto an equipped slot's meshes so a human can
  // dial the lit look toward the official icon by eye (see MaterialTuner). roughness/metalness are
  // FACTORS that multiply the baked maps (so they work on the baked-composite path; region-tinted
  // pieces override roughness/metalness per-region in-shader and ignore these two). normalScale,
  // envMapIntensity and colour multiply work on every MeshStandardMaterial. Resets on re-equip.
  setMaterialParams(
    slot: Slot,
    p: {
      roughness?: number;
      metalness?: number;
      normalScale?: number;
      envMapIntensity?: number;
      colorHex?: string;
    },
  ): void {
    const handle = this.equipped.get(slot);
    if (!handle) return;
    const apply = (mesh: THREE.Mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mm of mats) {
        const std = mm as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue;
        if (p.roughness !== undefined) std.roughness = p.roughness;
        if (p.metalness !== undefined) std.metalness = p.metalness;
        if (p.normalScale !== undefined && std.normalScale) std.normalScale.set(p.normalScale, p.normalScale);
        if (p.envMapIntensity !== undefined) std.envMapIntensity = p.envMapIntensity;
        if (p.colorHex !== undefined) std.color.set(p.colorHex);
        std.needsUpdate = true;
      }
    };
    for (const m of handle.meshes) apply(m);
    for (const m of handle.statics) apply(m);
  }

  unequip(slot: Slot): void {
    const handle = this.equipped.get(slot);
    if (!handle) return;
    this.assemblyHiddenSlots.delete(slot);
    this.bodyHideLayouts.delete(slot);
    // A head being removed takes its decal targets with it (the makeup/eye decals stay pending
    // in the manager and re-apply if a head is equipped again), and un-hides the body shell.
    if (slot === "face") {
      // Items socketed onto this head's own bones go with it: those bones leave the scene graph,
      // so keeping the attachment would strand it at the pose it happened to be drawn in.
      this.sourceHead = null;
      for (const [dependent, entry] of [...this.equipped])
        if (dependent !== slot && entry.headComponent) this.unequip(dependent);
      this.restoreSourceBodySkin();
      this.decals.unregisterTarget("head");
      this.decals.unregisterTarget("eyes");
      this.bodyHideUrls.delete("face");
      this.currentBodySkin = null;
      this.applyBodySkin();
    } else {
      this.bodyHideUrls.delete(slot);
    }
    this.refreshBodyHides();
    this.root.remove(handle.scene);
    handle.sourceBoneRoots?.forEach(bone => bone.removeFromParent());
    for (const mesh of handle.meshes) mesh.skeleton.dispose();
    disposeObject3D(handle.scene);
    // Bone-attached statics live outside handle.scene, so dispose them separately.
    for (const mesh of handle.statics) {
      mesh.removeFromParent();
      disposeObject3D(mesh);
    }
    // A composited real under-garment (open-coat undersuit) is a separate scene under root.
    if (handle.underLayerScene) {
      this.root.remove(handle.underLayerScene);
      for (const mesh of handle.underLayerMeshes ?? []) mesh.skeleton.dispose();
      this.forgetInspectorOverrides(handle.underLayerScene);
      disposeObject3D(handle.underLayerScene);
    }
    this.forgetInspectorOverrides(handle.scene);
    this.equipped.delete(slot);
  }

  // Report live objects for the dev inspector, including the resolved material maps and
  // source-sidedness. This catches missing textures and incorrect slot assignments that
  // cannot be diagnosed by reading catalog metadata alone.
  inspect(): InspectGroup[] {
    const groups: InspectGroup[] = [];

    const readMesh = (mesh: THREE.Mesh | THREE.SkinnedMesh): InspectMesh => {
      const g = mesh.geometry;
      const idx = g.index;
      const pos = g.attributes.position;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return {
        uuid: mesh.uuid,
        name: mesh.name || "(unnamed)",
        skinned: (mesh as THREE.SkinnedMesh).isSkinnedMesh === true,
        visible: mesh.visible,
        triangles: Math.round((idx ? idx.count : (pos?.count ?? 0)) / 3),
        vertices: pos?.count ?? 0,
        materials: mats.map((m) => {
          const std = m as THREE.MeshStandardMaterial;
          // A texture's origin: TextureLoader keeps the HTMLImageElement, so `src` is the URL
          // the rig fetched. A texture that came in with the GLB has no src — worth showing,
          // since "from the mesh file" vs "assigned by the rig" is the question being asked.
          const mapOf = (t: THREE.Texture | null | undefined) =>
            t ? ((t.image as { src?: string } | undefined)?.src ?? "(embedded in mesh)") : null;
          return {
            name: std.name || "(unnamed)",
            side: std.side === THREE.DoubleSide ? "double" : std.side === THREE.BackSide ? "back" : "front",
            transparent: !!std.transparent,
            alphaTest: std.alphaTest ?? 0,
            maps: {
              map: mapOf(std.map),
              normalMap: mapOf(std.normalMap),
              roughnessMap: mapOf(std.roughnessMap),
              metalnessMap: mapOf(std.metalnessMap),
              alphaMap: mapOf(std.alphaMap),
              emissiveMap: mapOf(std.emissiveMap),
            },
          };
        }),
      };
    };

    const collect = (label: string, id: string, roots: THREE.Object3D[]): void => {
      const meshes: InspectMesh[] = [];
      for (const r of roots)
        r.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) meshes.push(readMesh(m));
        });
      if (meshes.length) groups.push({ label, id, meshes });
    };

    if (this.bodyScene) collect("body", "body", [this.bodyScene]);
    for (const [slot, h] of this.equipped) {
      const roots: THREE.Object3D[] = [h.scene, ...h.statics];
      if (h.underLayerScene) roots.push(h.underLayerScene);
      collect(slot, h.id, roots);
    }
    return groups;
  }

  // Inspector actions. Kept on the rig so the panel never reaches into three directly.
  setMeshVisible(uuid: string, visible: boolean): void {
    this.root.traverse((o) => {
      if (o.uuid === uuid) o.visible = visible;
    });
  }

  setMeshSide(uuid: string, side: "front" | "double"): void {
    this.root.traverse((o) => {
      if (o.uuid !== uuid) return;
      const mesh = o as THREE.Mesh;
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const overrides = this.inspectorMaterialOverrides.get(uuid) ?? new Set<THREE.Material>();
      const materials = sourceMaterials.map((source) => {
        // GLTFLoader reuses one Three.js material for every primitive that references the same
        // glTF material. A side toggle is a mesh-local diagnostic, so copy only when another
        // mesh still points at the source; an unshared material can be changed in place.
        if (overrides.has(source)) return source;
        if (!this.isMaterialSharedOutsideMesh(mesh, source)) return source;
        const copy = cloneMaterialForInspector(source);
        if (source.userData.ledScreen && copy.userData.ledAnimationTexture) {
          // Material.clone deliberately omits shader callbacks. Rebuild the LED patch
          // against the copy's textures so a side diagnostic cannot remove the display
          // or leave its uniforms pointing at a sibling's disposed texture objects.
          this.applyLedScreen(copy as THREE.MeshStandardMaterial, source.userData.ledScreen, {
            animation: copy.userData.ledAnimationTexture,
            colorRamp: copy.userData.ledColorRampTexture ?? null,
            normal: (copy as THREE.MeshStandardMaterial).normalMap,
          });
        }
        overrides.add(copy);
        return copy;
      });
      if (materials.some((material, i) => material !== sourceMaterials[i])) {
        mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
        this.inspectorMaterialOverrides.set(uuid, overrides);
      }
      for (const m of materials) {
        m.side = side === "double" ? THREE.DoubleSide : THREE.FrontSide;
        m.needsUpdate = true;
      }
    });
  }

  private isMaterialSharedOutsideMesh(mesh: THREE.Mesh, material: THREE.Material): boolean {
    let shared = false;
    this.root.traverse((o) => {
      if (shared || o === mesh) return;
      const other = o as THREE.Mesh;
      if (!other.isMesh) return;
      const materials = Array.isArray(other.material) ? other.material : [other.material];
      if (materials.includes(material)) shared = true;
    });
    return shared;
  }

  private forgetInspectorOverrides(root: THREE.Object3D): void {
    root.traverse((o) => this.inspectorMaterialOverrides.delete(o.uuid));
  }

  dispose(): void {
    this.bodyLoadVersion++;
    this.sourceFittingNames.clear();
    this.bodySkinTex?.dispose();
    this.bodySkinTex = null;
    this.bodyBaseMaps.clear();
    for (const slot of [...this.equipped.keys()]) this.unequip(slot);
    this.releaseBody();
    this.decals.clearAll();
    this.skeleton = null;
    this.bonesByName.clear();
    this.bodyRestInverses.clear();
    this.inspectorMaterialOverrides.clear();
  }
}
