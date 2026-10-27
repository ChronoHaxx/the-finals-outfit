import * as THREE from "three";
import { fetchAsset as checkedFetch } from "../lib/asset-fetch";
import { VerifiedByteCache } from "../lib/verified-bytes";
import { HAIR_LIGHTING_GLSL } from './HairLighting';
import {
  RECOVERED_SAMPLER_TARGET, assemblePackedLayers, planReconstructedSamplers, rewriteSamplerGlsl,
  samplerPlanReport, samplerUniformBindings,
} from "./ReconstructedSamplers";
import type { SamplerPackResource, SamplerPlan, SamplerTextureSpec } from "./ReconstructedSamplers";

export const SURFACE_VIEWS = ["lit", "baseColor", "normal", "roughness", "metalness", "ao", "specular"] as const;
export type SurfaceView = (typeof SURFACE_VIEWS)[number];

type TextureSpec = SamplerTextureSpec;
interface Manifest {
  formatVersion: number;
  itemId: string;
  shader: string;
  shaderSha256: string;
  coverageShader?: string;
  coverageShaderSha256?: string;
  coverageGeometryFields?: string[];
  textures: TextureSpec[];
  viewDependentCloth?: boolean;
  geometryDependentNormals?: boolean;
  requiredUvSets?: number[];
  skinSurface?: boolean;
  // The recovered skin coverage the runtime treats as a source neck fade (w61 admits the
  // scalp-stubble extension exactly as the w53 manifest needs: the stubble coverage lerps the
  // gated neck fade to 1 by the saturated stubble alpha, so every neck-fade behaviour applies).
  skinCoverage?: 'neck-fade' | 'neck-fade-stubble';
  worldSurface?: boolean;
  glassSurface?: boolean;
  blendMode?: string;
  surfaceKind?: "eye" | "teeth" | "eyelash" | "hair" | "hair-metallic" | "glass" | "hologram";
  // M_FloatingHologram (scripts/shader-probe/hologram_contract.py): additive unlit emission with screen-space view inputs.
  hologramSurface?: boolean;
  shadingModel?: string;
  requiredViewFields?: string[];
  hologramProgram?: { textSha256?: string; rawSha256?: string; qualityLevel?: string };
  timePolicy?: { gameTime?: number };
  fogPolicy?: { fog?: string };
  normalSpace?: "world" | "tangent" | "strand-tangent";
  twoSided?: boolean;
  requiresVertexColor?: boolean;
  parameterOverrides?: string[];
  recoveredEmissive?: boolean;
  // Authored opacity mask through the compiled dithered clip (scripts/shader-probe/masked_contract.py).
  maskedClip?: { policy: string; opacitySource: { slot: string; component: string } };
  // PlasticSheet parametric fresnel opacity through its DitherTemporalAA clip (scripts/shader-probe/plastic_sheet_contract.py):
  // a geometry-dependent kept fraction rendered with alpha hashing; no UV-only coverage, so shadows stay opaque.
  parametricOpacity?: { policy: string; fields?: string[] };
  // PlasticSheet two-sided sign pins; the face sign itself is listed in requiredGeometryFields when the program reads it.
  twoSidedSign?: { policy: string };
  // Glass: 'source-world' for a cubemap program (its reflection lookup needs fixed UE world axes), otherwise
  // 'source-world-or-orthonormal-equivalent' (dot products only, evaluated in reflected view space).
  geometryFrame?: string;
  requiredGeometryFields?: string[];
}

// Cubemap glass geometry in the source-world frame (scripts/shader-probe/glass_contract.py FRAME_POLICY).
// Derived: SourceTransform.ts converts UE (X, Y, Z) cm to three.js (X, Z, Y) m, so a three.js world vector maps back
// as .xzy (directions) and .xzy * 100 (positions, cm); the swap is a reflection, so tangent handedness negates, as
// for world surfaces. Choice (signed off 12 Oct 2026, cubemapGlassYaw): the mesh component world yaw is pinned to the preview
// pose. rig.root sits at the three.js origin with identity rotation and only the camera orbits (CharacterViewer),
// so this world frame is the source mesh component frame: component world yaw 0, the character faces UE +Y.
// The cube direction then depends on the camera only through the reflected view vector, never on the view axes.
// faceSign is UE's two-sided sign with an unmirrored primitive and view: +1 front face, -1 back face.
// three draws a transparent DoubleSide material as a BackSide pass then a FrontSide pass. The BackSide program
// defines FLIP_SIDED: winding is reversed (gl_FrontFacing is true on geometric back faces) and the vertex stage
// negates the normal and tangent. glassUnflip undoes both, so the contract sees the vertex frame before UE's
// TwoSidedSign plus the geometric face sign.
const GLASS_SOURCE_WORLD_GEOMETRY = `
  #ifdef FLIP_SIDED
    float glassUnflip = -1.0;
  #else
    float glassUnflip = 1.0;
  #endif
  vec3 glassWorldView = transpose(mat3(viewMatrix)) * vViewPosition;
  ReconstructedGeometry recoveredGeometry;
  recoveredGeometry.position = (cameraPosition - glassWorldView).xzy * 100.0;
  recoveredGeometry.view = glassWorldView.xzy * 100.0;
  recoveredGeometry.normal = (transpose(mat3(viewMatrix)) * vNormal).xzy * glassUnflip;
  recoveredGeometry.tangent = (transpose(mat3(viewMatrix)) * vTangent).xzy * glassUnflip;
  recoveredGeometry.handedness = -vRecoveredHandedness;
`;
const GLASS_SOURCE_WORLD_FIELDS = new Set(["position", "tangent", "normal", "view", "handedness", "faceSign"]);
// Two-sided PlasticSheet on the generic reflected view-space route (scripts/shader-probe/plastic_sheet_contract.py): UE's
// TwoSidedSign is the rasterizer face sign once its Flags and CullingSign pins hold. Its alpha-hashed DoubleSide
// material draws one pass, so FLIP_SIDED is never defined there and gl_FrontFacing/vNormal are the raw values; the
// unflip mirrors glassUnflip so a later switch to a two-pass transparent draw would still hand the contract the
// vertex frame and the geometric face. Emitted only for such programs, so every other program's GLSL is unchanged.
const GENERIC_FACE_UNFLIP = `
              #ifdef FLIP_SIDED
                float recoveredUnflip = -1.0;
              #else
                float recoveredUnflip = 1.0;
              #endif`;

// M_FloatingHologram preview contract, runtime half (_docs/goal-100-2026-10-11/floatinghologram-contract/, design section 5).
// The one qualified program, by its CRLF-normalised asm text hash (scripts/shader-probe/hologram_programs.json).
const HOLOGRAM_PROGRAMS = new Set(["538e2b69d7363ccdf0fcd21735877c3699ecc5051b1e3e5a923f3c5b5a6a3d57"]);
const HOLOGRAM_VIEW_FIELDS = new Set(["fragCoord", "invSize", "rectMin"]);
// The emitter declares the view struct in the shader text itself; the runtime fills it by these field names.
const HOLOGRAM_VIEW_STRUCT = /^struct ReconstructedView \{ vec2 fragCoord; vec2 rectMin; vec2 invSize; \};$/m;
// Fields that would need a geometry frame, coverage or another surface route. A hologram reads none of them.
const HOLOGRAM_FORBIDDEN_FIELDS = ["geometryDependentNormals", "viewDependentCloth", "twoSidedSign", "glassSurface",
  "worldSurface", "skinSurface", "skinCoverage", "maskedClip", "parametricOpacity", "geometryFrame",
  "requiredGeometryFields", "normalSpace", "coverageShader", "coverageShaderSha256", "coverageGeometryFields",
  "requiresVertexColor"] as const;

function validateHologram(manifest: Manifest): string[] {
  const fail = (why: string) => { throw new Error(`Unsupported recovered hologram contract: ${why}`); };
  if (manifest.hologramSurface !== true || manifest.surfaceKind !== "hologram") fail("route selector");
  if (manifest.recoveredEmissive !== true || manifest.blendMode !== "BLEND_Additive"
    || manifest.shadingModel !== "MSM_Unlit" || manifest.twoSided !== true) fail("blend, shading or emission state");
  for (const field of HOLOGRAM_FORBIDDEN_FIELDS)
    if ((manifest as unknown as Record<string, unknown>)[field] !== undefined) fail(`geometry or surface field ${field}`);
  const fields = manifest.requiredViewFields;
  if (!Array.isArray(fields) || new Set(fields).size !== fields.length || !fields.every(f => HOLOGRAM_VIEW_FIELDS.has(f)))
    fail("view fields");
  if (!HOLOGRAM_PROGRAMS.has(manifest.hologramProgram?.textSha256 ?? "")) fail("program");
  // Signed-off pins (signoffs-2026-10-12.json gameTimeZeroAndNameGate, noFogPin): a frozen frame and no fog term.
  // The runtime adds neither; it only refuses a manifest built under some other policy.
  if (manifest.timePolicy?.gameTime !== 0 || manifest.fogPolicy?.fog !== "none") fail("time or fog policy");
  return fields!;
}

// ReconstructedView in D3D pixel conventions (manifest viewPolicy): fragCoord = (x, H - y) from GL's bottom-left
// gl_FragCoord, rectMin = (vx, H - vy - vh), invSize = 1 / (vw, vh), for the current viewport (vx, vy, vw, vh) in
// physical pixels and the bound render target's (or drawing buffer's) height H. rect = (rectMin, invSize); the
// reciprocal is taken here, once per draw, as UE does on the CPU, so the shader sees the float32-rounded 1 / size.
const hologramViewport = new THREE.Vector4();
function updateHologramView(renderer: THREE.WebGLRenderer, rect: THREE.Vector4, height: { value: number }) {
  renderer.getCurrentViewport(hologramViewport);
  const target = renderer.getRenderTarget();
  const H = target ? Math.max(1, target.height >> renderer.getActiveMipmapLevel()) : renderer.getContext().drawingBufferHeight;
  const { x, y, z: w, w: h } = hologramViewport;
  rect.set(x, H - y - h, 1 / w, 1 / h);
  height.value = H;
}

// Hash-verified shader and texture bytes, reused across loads of the same authored file
// (hair and face swaps restage the same skin textures). Every call receives its own copy;
// manifests are not hashed and always load fresh. Bounded to 128 MiB / 512 entries.
const verifiedBytes = new VerifiedByteCache(checkedFetch);

// Every sampler resource starts from the authored bytes: fetch, decompress and
// hash-check the original file before anything is uploaded or regrouped. A repeat
// load reuses bytes that already passed that check; layout validation still runs per load.
function fetchTextureData(spec: TextureSpec, base: string): Promise<ArrayBuffer> {
  return verifiedBytes.load(new URL(spec.file, base).href, spec.sha256, "gzip");
}

/** The authored texture bytes (every mip, decompressed and hash-checked) for the developer source-file export. */
export async function fetchRecoveredTexture(spec: TextureSpec, manifestUrl: string) {
  const data = await fetchTextureData(spec, new URL(manifestUrl, window.location.href).href);
  return { data, ...validateTextureLayout(spec, data) };
}

function validateTextureLayout(spec: TextureSpec, data: ArrayBuffer): { half: boolean } {
  const half = spec.componentType === "float16";
  if ((spec.componentType !== undefined && !half) || (half && spec.srgb)
    || (spec.cube && (spec.array || spec.depth !== 6))
    || (!spec.array && !spec.cube && spec.depth !== 1)) throw new Error("Unsupported recovered texture layout");
  const bytesPerPixel = half ? 8 : 4;
  let end = 0;
  for (const m of spec.mips) {
    if (m.offset !== end || m.bytes !== m.width * m.height * spec.depth * bytesPerPixel)
      throw new Error("Invalid recovered mip layout");
    end += m.bytes;
  }
  if (end !== data.byteLength || !spec.mips.length) throw new Error("Invalid recovered texture length");
  return { half };
}

// Three's CompressedArrayTexture explicitly supports RGBAFormat mip data. Its
// DataArrayTexture upload path only uploads level zero, losing cooked mipmaps.
// @types/three omits this supported RGBA upload branch from constructor types.
const RGBA_COMPRESSED = THREE.RGBAFormat as unknown as THREE.CompressedPixelFormat;

function applySamplerPolicy(texture: THREE.Texture, spec: { srgb: boolean; wrapS: string; wrapT: string }, name: string) {
  texture.name = name;
  texture.colorSpace = spec.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.flipY = false;
  const wrap = (s: string) => s === "TA_Clamp" ? THREE.ClampToEdgeWrapping
    : s === "TA_Mirror" ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
  texture.wrapS = wrap(spec.wrapS);
  texture.wrapT = wrap(spec.wrapT);
  // Shared UE samplers depend on runtime scalability settings. Trilinear sampling
  // is the preview policy; the cooked mip contents and sRGB conversion are retained.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

async function loadTexture(spec: TextureSpec, base: string): Promise<THREE.Texture> {
  const data = await fetchTextureData(spec, base);
  const { half } = validateTextureLayout(spec, data);
  const mipmaps = spec.mips.map((m) => ({
    data: half ? new Uint16Array(data, m.offset, m.bytes / 2) : new Uint8Array(data, m.offset, m.bytes),
    width: m.width, height: m.height,
  }));
  const { width, height } = mipmaps[0];
  const type = half ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const texture = spec.array
    ? new THREE.CompressedArrayTexture(mipmaps, width, height, spec.depth, RGBA_COMPRESSED, type)
    : new THREE.CompressedTexture(spec.cube ? [] : mipmaps, width, height, RGBA_COMPRESSED, type);
  if (spec.cube) {
    // Three's compressed cubemap path supports decoded RGBA face mipmaps. Keep
    // the source +X/-X/+Y/-Y/+Z/-Z order and every authored level, without flips.
    texture.image = Array.from({ length: 6 }, (_, face) => ({ width, height, mipmaps: mipmaps.map(m => {
      const size = m.width * m.height * 4;
      return { width: m.width, height: m.height, data: m.data.subarray(face * size, (face + 1) * size) };
    }) })) as unknown as typeof texture.image;
  }
  applySamplerPolicy(texture, spec, `recovered:${spec.id}`);
  return texture;
}

// Packed layers never exist as their own GPU texture: the authored bytes go
// straight into one array upload, so a layer and its original resource can
// never both own an allocation.
async function loadPackedTexture(resource: SamplerPackResource, base: string): Promise<THREE.Texture> {
  const buffers = await Promise.all(resource.layers.map(async (layer) => {
    const data = await fetchTextureData(layer.texture, base);
    validateTextureLayout(layer.texture, data);
    return data;
  }));
  const { layout } = resource;
  const mipmaps = assemblePackedLayers(buffers, layout);
  const texture = new THREE.CompressedArrayTexture(mipmaps, layout.width, layout.height, layout.depth,
    RGBA_COMPRESSED, layout.componentType === "float16" ? THREE.HalfFloatType : THREE.UnsignedByteType);
  applySamplerPolicy(texture, layout, `recovered:pack${resource.index}`);
  return texture;
}

const SURFACE_STRUCT = `
struct ReconstructedSurface {
  vec3 baseColor;
  vec3 normal;
  float roughness;
  float metalness;
  float specular;
  float ao;
  vec3 subsurfaceColor;
  float opacity;
  float scatter;
  vec3 emissive;
};
varying vec2 vRecoveredUv0;
varying vec2 vRecoveredUv1;

// Fallback for legacy converted meshes without tangents. Derive a frame from UV0;
// validating it against the game's vertex factory is a separate fidelity check.
mat3 recoveredTangentFrame(vec3 position, vec3 normal, vec2 uv) {
  vec3 q0 = dFdx(position), q1 = dFdy(position);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1perp = cross(q1, normal), q0perp = cross(normal, q0);
  vec3 tangent = q1perp * st0.x + q0perp * st1.x;
  vec3 bitangent = q1perp * st0.y + q0perp * st1.y;
  float determinant = max(dot(tangent, tangent), dot(bitangent, bitangent));
  float scale = determinant > 0.0 ? inversesqrt(determinant) : 0.0;
  return mat3(tangent * scale, bitangent * scale, normal);
}
`;

function replaceChunk(source: string, name: string, replacement: string): string {
  const marker = `#include <${name}>`;
  if (!source.includes(marker)) throw new Error(`Three shader chunk changed: ${name}`);
  return source.replace(marker, replacement);
}

export async function loadReconstructedMaterial(url: string, view: SurfaceView = "lit") {
  const base = new URL(url, window.location.href).href;
  const manifest: Manifest = await (await checkedFetch(base)).json();
  if (manifest.formatVersion !== 1) throw new Error("Unsupported recovered material format");
  const requiredUvSets = manifest.requiredUvSets ?? [0, 1];
  if (!Array.isArray(requiredUvSets) || requiredUvSets.some(uv => uv !== 0 && uv !== 1))
    throw new Error("Unsupported recovered UV requirement");
  const needsUv1 = requiredUvSets.includes(1);
  // The hologram route (validateHologram). View inputs exist only there, so a stray view field also lands here and fails.
  const hologram = manifest.hologramSurface !== undefined || manifest.surfaceKind === "hologram"
    || manifest.requiredViewFields !== undefined;
  const viewFields = hologram ? validateHologram(manifest) : [];
  const worldSurface = !!manifest.skinSurface || !!manifest.worldSurface;
  const glass = !!manifest.glassSurface;
  if ((glass || manifest.surfaceKind === 'glass') && (!glass || manifest.surfaceKind !== 'glass'
    || manifest.normalSpace !== 'tangent' || manifest.blendMode !== 'BLEND_TranslucentGreyTransmittance'
    || worldSurface || manifest.viewDependentCloth || manifest.geometryDependentNormals))
    throw new Error('Unsupported recovered glass surface contract');
  // A cubemap glass program declares the source-world frame; every other qualified glass program keeps the
  // orthonormal-equivalent reflected view space (absent on manifests that predate the field).
  const glassSourceWorld = glass && manifest.geometryFrame === 'source-world';
  if (glass && !glassSourceWorld && manifest.geometryFrame !== undefined
    && manifest.geometryFrame !== 'source-world-or-orthonormal-equivalent')
    throw new Error('Unsupported recovered glass geometry frame');
  if (glassSourceWorld && (!manifest.recoveredEmissive
    || !(manifest.requiredGeometryFields ?? []).every(field => GLASS_SOURCE_WORLD_FIELDS.has(field))))
    throw new Error('Unsupported recovered cubemap glass contract');
  const glassFaceSign = glassSourceWorld && (manifest.requiredGeometryFields ?? []).includes('faceSign');
  const usesGeometry = !!manifest.geometryDependentNormals || worldSurface || glass;
  const hair = manifest.surfaceKind === 'hair';
  // M_Hair_Metallic (scripts/shader-probe/hair_metallic_contract.py): the hair kind's coverage and shadows with the
  // generic DefaultLit PBR lighting, the vertex colour the pinned program reads, and DoubleSide; never the Karis
  // hair lighting. Its coverage may read the vertex colour, so the shadow pass supplies the real colour.
  const hairMetallic = manifest.surfaceKind === 'hair-metallic';
  if (manifest.skinCoverage && ((manifest.skinCoverage !== 'neck-fade'
      && manifest.skinCoverage !== 'neck-fade-stubble') || !manifest.skinSurface))
    throw new Error('Unsupported recovered skin coverage');
  const neckFade = manifest.skinCoverage !== undefined;
  const maskedClip = !!manifest.maskedClip;
  if (maskedClip && (worldSurface || glass || manifest.surfaceKind || typeof manifest.maskedClip?.policy !== 'string'))
    throw new Error('Unsupported recovered masked clip contract');
  const masked = manifest.surfaceKind === "eyelash" || hair || hairMetallic || neckFade || maskedClip;
  // PlasticSheet (plastic_sheet_contract): parametric opacity on the generic geometry route, BLEND_Masked only.
  const parametric = !!manifest.parametricOpacity;
  if (parametric && (!manifest.geometryDependentNormals || worldSurface || glass || maskedClip || manifest.surfaceKind
    || manifest.blendMode !== 'BLEND_Masked' || typeof manifest.parametricOpacity?.policy !== 'string'))
    throw new Error('Unsupported recovered parametric opacity contract');
  // A generic geometry program that reads the rasterizer face (two-sided PlasticSheet); cubemap glass has its own block.
  const faceSignField = !glass && (manifest.requiredGeometryFields ?? []).includes('faceSign');
  const genericFaceSign = faceSignField && !manifest.worldSurface;
  if (genericFaceSign && (!manifest.geometryDependentNormals || worldSurface))
    throw new Error('Unsupported recovered face sign contract');
  // A two-sided source-world program that reads the rasterizer face (M_FlowerPetal, scripts/shader-probe/
  // attachment_family_contract.py; 23 Oct 2026): the worldSurface block supplies it as the cubemap glass block does.
  // Never on skin or on a program that also declares the generic geometry route (both blocks would declare the geometry).
  const worldFaceSign = faceSignField && !!manifest.worldSurface;
  if (worldFaceSign && (manifest.skinSurface || manifest.geometryDependentNormals || manifest.twoSided !== true))
    throw new Error('Unsupported recovered face sign contract');
  const shaderBytes = await verifiedBytes.load(new URL(manifest.shader, base).href, manifest.shaderSha256, "identity");
  let recoveredShader = new TextDecoder().decode(shaderBytes);
  if (hologram && HOLOGRAM_VIEW_STRUCT.test(recoveredShader) !== viewFields.length > 0)
    throw new Error("Unsupported recovered hologram contract: view struct");
  let coverageShader: string | undefined;
  // hair-metallic coverage may read the vertex colour (its dither powers differ per instance); every other masked
  // kind keeps UV-only coverage. The field must be present either way.
  const coverageColor = hairMetallic && manifest.coverageGeometryFields?.length === 1
    && manifest.coverageGeometryFields[0] === "color";
  if (masked) {
    if (!manifest.coverageShader || !manifest.coverageShaderSha256
      || !(hairMetallic
        ? (manifest.coverageGeometryFields?.length === 0 || coverageColor)
        : manifest.coverageGeometryFields?.length === 0))
      throw new Error("Recovered masked shadows require validated UV-only coverage");
    const bytes = await verifiedBytes.load(new URL(manifest.coverageShader, base).href,
      manifest.coverageShaderSha256, "identity");
    coverageShader = new TextDecoder().decode(bytes);
  }
  // One plan drives the surface pass, the shadow/coverage pass and every upload.
  // It aliases identical identities exactly as before and, only when the budget
  // demands it, moves compatible 2D textures into shared array layers. The
  // authored files, manifest metadata and shader hashes are untouched; only the
  // already-verified runtime shader strings are transformed.
  const plan: SamplerPlan = planReconstructedSamplers(manifest.textures,
    { target: RECOVERED_SAMPLER_TARGET, deduplicate: true });
  recoveredShader = rewriteSamplerGlsl(recoveredShader, plan);
  if (coverageShader) coverageShader = rewriteSamplerGlsl(coverageShader, plan, { allowMissingDeclarations: true });
  const planReport = samplerPlanReport(plan);

  const loaded = await Promise.allSettled(plan.resources.map((resource) =>
    resource.kind === "pack" ? loadPackedTexture(resource, base) : loadTexture(resource.texture, base)));
  const textures = new Map<string, THREE.Texture>();
  loaded.forEach((result, i) => { if (result.status === "fulfilled") textures.set(plan.resources[i].key, result.value); });
  const failure = loaded.find((r) => r.status === "rejected");
  if (failure?.status === "rejected") {
    textures.forEach((t) => t.dispose());
    textures.clear();
    throw failure.reason;
  }
  const uniformBindings = samplerUniformBindings(plan);
  const dispose = () => textures.forEach((t) => t.dispose());
  // UE BLEND_Additive + MSM_Unlit, two-sided (design section 5), on an unlit material: no lights, no specular, no fog.
  const makeHologramMaterial = (old: THREE.Material) => {
    const material = new THREE.MeshBasicMaterial({ name: `${manifest.itemId}:recovered`, side: THREE.DoubleSide });
    // Colour One/One onto what is behind; alpha Zero/One, so the target's coverage alpha is unchanged. Depth tested,
    // never written. One DoubleSide draw: three otherwise draws a transparent DoubleSide material as a back pass and
    // a front pass; additive light is order-free and reads no face sign, so one pass equals UE's single two-sided draw.
    Object.assign(material, {
      transparent: true, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      depthWrite: false, depthTest: true, forceSinglePass: true, fog: false, toneMapped: view === "lit",
    });
    if (needsUv1) material.defines = { ...material.defines, USE_UV1: "" };
    material.userData.reconstructed = true;
    material.userData.sourceInstance = manifest.itemId;
    material.userData.sourceSlot = old.userData.sourceSlot;
    material.userData.surfaceKind = manifest.surfaceKind;
    material.userData.recoveredManifest = base; // OutfitSourceExport packages the authored textures
    // StableFrameState: a visible additive material activates the stable-frame accumulator, whose linear HDR target
    // is where One/One blending is exact (tone mapping follows the blend). The direct path is dev-only and inexact.
    material.userData.recoveredAdditive = true;
    material.userData.hologramPolicy = "additive unlit emission at GameTime 0 with fog off; exact in the stable-frame "
      + "accumulator (light over the empty backdrop passes through); the direct ?temporal=0 path tone-maps before blending";
    material.userData.recoveredSamplers = planReport;
    for (const resource of plan.resources) {
      const texture = textures.get(resource.key);
      if (texture) material.userData[resource.kind === "pack" ? `recoveredPack${resource.index}` : resource.texture.id] = texture;
    }
    // The view rectangle of the draw being made (updateHologramView); three calls this right before each draw.
    const rect = new THREE.Vector4(0, 0, 1, 1), height = { value: 1 };
    material.onBeforeRender = (renderer) => updateHologramView(renderer, rect, height);
    material.customProgramCacheKey = () =>
      `recovered-hologram-v1:${manifest.shaderSha256}:${plan.cacheKey}:${view}:${needsUv1}:${viewFields.join(",")}`;
    material.onBeforeCompile = (shader) => {
      for (const binding of uniformBindings) shader.uniforms[binding.name] = { value: textures.get(binding.resource) };
      shader.uniforms.uRecoveredViewRect = { value: rect };
      shader.uniforms.uRecoveredTargetHeight = height;
      shader.vertexShader = "varying vec2 vRecoveredUv0;\nvarying vec2 vRecoveredUv1;\n" + shader.vertexShader;
      shader.vertexShader = replaceChunk(shader.vertexShader, "uv_vertex", `
        #include <uv_vertex>
        vRecoveredUv0 = uv;
        vRecoveredUv1 = ${needsUv1 ? "uv1" : "vec2(0.0)"};
      `);
      let fragment = SURFACE_STRUCT + "uniform vec4 uRecoveredViewRect;\nuniform float uRecoveredTargetHeight;\n"
        + recoveredShader + "\n" + shader.fragmentShader;
      fragment = replaceChunk(fragment, "map_fragment", `${viewFields.length ? `
        ReconstructedView recoveredView;
        recoveredView.fragCoord = vec2(gl_FragCoord.x, uRecoveredTargetHeight - gl_FragCoord.y);
        recoveredView.rectMin = uRecoveredViewRect.xy;
        recoveredView.invSize = uRecoveredViewRect.zw;` : ""}
        ReconstructedSurface recovered = recoveredSurface(vRecoveredUv0, vRecoveredUv1${viewFields.length ? ", recoveredView" : ""});
      `);
      // The linear pre-exposure emission is the whole colour, unscaled (manifest emissivePolicy).
      fragment = replaceChunk(fragment, "opaque_fragment",
        "outgoingLight = recovered.emissive;\ndiffuseColor.a = 1.0;\n#include <opaque_fragment>");
      shader.fragmentShader = fragment;
    };
    for (const value of Object.values(old)) if (value?.isTexture) value.dispose();
    old.dispose();
    return material;
  };
  return {
    dispose,
    apply(mesh: THREE.Mesh, materialIndex?: number, skinOptions?: { boundsOrigin: [number, number, number]; preserveAlpha?: boolean }) {
      if (hair && (manifest.normalSpace !== 'strand-tangent' || !manifest.requiresVertexColor ||
          mesh.geometry.getAttribute('color')?.itemSize !== 4 || !worldSurface))
        throw new Error('Recovered hair requires the original RGBA vertex masks and strand tangent');
      if (hairMetallic && (manifest.normalSpace !== 'tangent' || !manifest.requiresVertexColor ||
          mesh.geometry.getAttribute('color')?.itemSize !== 4 || !worldSurface))
        throw new Error('Recovered metallic hair requires the original RGBA vertex masks and the tangent flake normal space');
      if (masked && Array.isArray(mesh.material) && mesh.material.length !== 1)
        throw new Error("Recovered lash shadows require a separate source section");
      if (worldSurface && (!skinOptions || skinOptions.boundsOrigin.length !== 3 || !skinOptions.boundsOrigin.every(Number.isFinite)))
        throw new Error("Recovered world surface requires source bounds");
      if (usesGeometry && !mesh.geometry.hasAttribute("tangent")) {
        dispose();
        throw new Error("Geometry-dependent surface requires original tangents");
      }
      if (!mesh.geometry.hasAttribute("uv")) {
        dispose();
        throw new Error("Recovered surface is missing a required original UV set");
      }
      // UE's local vertex factory binds the mesh's last texcoord stream to every
      // channel a material requests beyond what the mesh has, so on a single-UV
      // static mesh the material's UV1 reads UV0. Alias it the same way.
      if (needsUv1 && !mesh.geometry.hasAttribute("uv1"))
        mesh.geometry.setAttribute("uv1", mesh.geometry.getAttribute("uv"));
      if (hologram) {
        // Every hologram slot in the catalog is a single-section mesh; a section of a shared mesh is refused.
        if ((Array.isArray(mesh.material) && mesh.material.length !== 1) || (materialIndex !== undefined && materialIndex !== 0))
          throw new Error("Recovered hologram requires a single-section mesh");
        const old = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const material = makeHologramMaterial(old);
        mesh.material = Array.isArray(mesh.material) ? [material] : material;
        // Additive light is not matter: no shadow. The rig re-derives castShadow from transparency after equipping
        // (CharacterRig.enableShadows), so the mesh also carries depth/distance materials that write neither colour nor
        // depth: the shadow pass draws nothing for it whichever value castShadow ends up with.
        mesh.castShadow = false;
        mesh.customDepthMaterial?.dispose();
        mesh.customDistanceMaterial?.dispose();
        const noShadow = <T extends THREE.Material>(shadow: T): T => {
          shadow.colorWrite = false;
          shadow.depthWrite = false;
          shadow.name = `${manifest.itemId}:no-shadow`;
          shadow.userData.hologramShadowPolicy = "additive light casts no shadow";
          return shadow;
        };
        mesh.customDepthMaterial = noShadow(new THREE.MeshDepthMaterial());
        mesh.customDistanceMaterial = noShadow(new THREE.MeshDistanceMaterial());
        mesh.userData.recoveredAdditive = true;
        return;
      }
      const makeMaterial = (old: THREE.Material) => {
        const material = new THREE.MeshPhysicalMaterial({
          name: `${manifest.itemId}:recovered`, roughness: 1, metalness: 1,
          side: manifest.twoSided === undefined ? old.side : manifest.twoSided ? THREE.DoubleSide : THREE.FrontSide,
        });
        // Spatial alpha hashing consumes the raw material coverage. Native UE
        // temporal dithering is still pending; texture alpha alone is not coverage.
        // PlasticSheet's kept fraction replaces UE's temporal dither the same way (signed off, ditheredOpacity).
        material.alphaHash = masked || parametric;
        // Qualified glass recovers the source material's opacity. It uses the
        // preview's alpha blend and lighting, not UE refraction/transmittance.
        material.transparent = glass && view === 'lit';
        material.depthWrite = !material.transparent;
        if (manifest.skinSurface && skinOptions?.preserveAlpha && !neckFade) {
          // Retain the current preview's neck-edge coverage while native skin
          // opacity/depth-offset evaluation is still a separate adapter.
          const previous = old as THREE.MeshStandardMaterial;
          material.map = previous.map;
          previous.map = null; // transfer this texture's ownership
          material.alphaTest = previous.alphaTest;
        }
        material.defines = { ...material.defines, ...(needsUv1 ? { USE_UV1: "" } : {}),
          ...(mesh.geometry.hasAttribute("tangent") ? { USE_TANGENT: "" } : {}) };
        material.toneMapped = view === "lit";
        material.userData.reconstructed = true;
        material.userData.sourceInstance = manifest.itemId;
        material.userData.sourceSlot = old.userData.sourceSlot;
        material.userData.viewDependentCloth = !!manifest.viewDependentCloth;
        material.userData.geometryDependentNormals = !!manifest.geometryDependentNormals;
        material.userData.skinSurface = !!manifest.skinSurface;
        material.userData.skinCoverage = manifest.skinCoverage;
        material.userData.surfaceKind = manifest.surfaceKind;
        material.userData.normalSpace = manifest.normalSpace; // OutfitExport bakes world-space normals differently
        material.userData.recoveredManifest = base; // OutfitSourceExport packages the authored textures
        material.userData.glassOpacityPolicy = glass ? 'source opacity; alpha-blended preview; native refraction and lighting pending' : undefined;
        material.userData.parameterOverrides = manifest.parameterOverrides;
        material.userData.hairLightingPolicy = hair ? 'Karis 2016 R/TT/TRT preview; native lighting, volume shadows and TAA pending' : undefined;
        material.userData.coveragePolicy = maskedClip ? manifest.maskedClip!.policy
          : parametric ? manifest.parametricOpacity!.policy
          : masked ? "raw material coverage with Three alpha hashing; native TAA pending" : undefined;
        material.userData.skinOpacityPolicy = neckFade ? 'source neck mask and enable; preview alpha hashing; native dither, discard and depth offset pending'
          : manifest.skinSurface ? "existing preview coverage; native opacity pending" : undefined;
        // Counts and plan key so a run can be proven against the manifest. A
        // small sampler count is a budget fact, never an acceptance signal.
        material.userData.recoveredSamplers = planReport;
        // disposeObject3D already releases textures stored directly on userData.
        for (const resource of plan.resources) {
          const texture = textures.get(resource.key);
          if (texture) material.userData[resource.kind === "pack" ? `recoveredPack${resource.index}` : resource.texture.id] = texture;
        }
        material.customProgramCacheKey = () => `recovered-v13:${manifest.shaderSha256}:${plan.cacheKey}:${view}:${mesh.geometry.hasAttribute("tangent")}:${needsUv1}:${!!skinOptions?.preserveAlpha}:${worldSurface}:${manifest.normalSpace}:${neckFade}:${glass}:${maskedClip}:${parametric}:${genericFaceSign}${hairMetallic ? ":hair-metallic" : ""}${worldFaceSign ? ":world-face-sign" : ""}`;
        material.onBeforeCompile = (shader) => {
          for (const binding of uniformBindings) shader.uniforms[binding.name] = { value: textures.get(binding.resource) };
          shader.vertexShader = "varying vec2 vRecoveredUv0;\nvarying vec2 vRecoveredUv1;\n" + shader.vertexShader;
          // These channels are material masks, not diffuse vertex colours.
          if (hair || hairMetallic) shader.vertexShader = 'attribute vec4 color;\nvarying vec4 vRecoveredColor;\n' + shader.vertexShader;
          if (usesGeometry) shader.vertexShader = "varying float vRecoveredHandedness;\n" + shader.vertexShader;
          if (worldSurface) {
            const [x, y, z] = skinOptions!.boundsOrigin;
            shader.uniforms.uRecoveredBoundsOrigin = { value: new THREE.Vector3(x, z, y).multiplyScalar(0.01) };
            shader.vertexShader = "uniform vec3 uRecoveredBoundsOrigin;\nvarying vec3 vRecoveredObjectPosition;\n" + shader.vertexShader;
          }
          shader.vertexShader = replaceChunk(shader.vertexShader, "uv_vertex", `
            #include <uv_vertex>
            vRecoveredUv0 = uv;
            vRecoveredUv1 = ${needsUv1 ? "uv1" : "vec2(0.0)"};
            ${hair || hairMetallic ? 'vRecoveredColor = color;' : ''}
            ${usesGeometry ? "vRecoveredHandedness = tangent.w;" : ""}
            ${worldSurface ? "vRecoveredObjectPosition = (modelMatrix * vec4(uRecoveredBoundsOrigin, 1.0)).xyz;" : ""}
          `);
          let fragment = SURFACE_STRUCT + recoveredShader + "\n" + shader.fragmentShader;
          if (hair || hairMetallic) fragment = 'varying vec4 vRecoveredColor;\n' + fragment;
          if (hair) {
            const physical = THREE.ShaderChunk.lights_physical_pars_fragment;
            if (!physical.includes('struct PhysicalMaterial {')) throw new Error('Three physical material structure changed');
            fragment = replaceChunk(fragment, 'lights_physical_pars_fragment', physical.replace('struct PhysicalMaterial {',
              'struct PhysicalMaterial { vec3 hairTangent; float hairScatter; float hairRoughness; float hairSpecular;') + HAIR_LIGHTING_GLSL);
            fragment = replaceChunk(fragment, 'lights_fragment_maps', `
              #if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_CUBE_UV)
                iblIrradiance += getIBLIrradiance(recoveredHairFacingNormal(geometryViewDir, material.hairTangent));
              #endif
            `);
          }
          if (usesGeometry) fragment = "varying float vRecoveredHandedness;\n" + fragment;
          if (worldSurface) fragment = "varying vec3 vRecoveredObjectPosition;\n" + fragment;
          fragment = replaceChunk(fragment, "map_fragment", `
            ${manifest.viewDependentCloth ? `
              vec3 recoveredGeometryNormal = normalize(vNormal);
              #ifdef USE_TANGENT
                mat3 recoveredViewFrame = mat3(normalize(vTangent), normalize(vBitangent), recoveredGeometryNormal);
              #else
                mat3 recoveredViewFrame = recoveredTangentFrame(-vViewPosition, recoveredGeometryNormal, vRecoveredUv0);
              #endif
              vec3 recoveredViewTangent = transpose(recoveredViewFrame) * normalize(vViewPosition);
            ` : ""}
            ${glassSourceWorld ? GLASS_SOURCE_WORLD_GEOMETRY + (glassFaceSign
              ? "recoveredGeometry.faceSign = (gl_FrontFacing ? 1.0 : -1.0) * glassUnflip;" : "") : ""}
            ${(manifest.geometryDependentNormals || glass) && !glassSourceWorld ? `${genericFaceSign ? GENERIC_FACE_UNFLIP : ""}
              // Differentiate a reflected view-space surface in source centimetres.
              // Positions and tangent vectors share one frame; retain interpolated
              // vector lengths, since the source differentiates their curvature.
              ReconstructedGeometry recoveredGeometry;
              recoveredGeometry.position = vec3(-vViewPosition.x, vViewPosition.y, -vViewPosition.z) * 100.0;
              recoveredGeometry.tangent = vec3(vTangent.x, -vTangent.y, vTangent.z)${genericFaceSign ? " * recoveredUnflip" : ""};
              recoveredGeometry.normal = vec3(vNormal.x, -vNormal.y, vNormal.z)${genericFaceSign ? " * recoveredUnflip" : ""};
              recoveredGeometry.view = -recoveredGeometry.position;
              recoveredGeometry.handedness = -vRecoveredHandedness;${genericFaceSign ? `
              recoveredGeometry.faceSign = (gl_FrontFacing ? 1.0 : -1.0) * recoveredUnflip;` : ""}
            ` : ""}
            ${worldSurface ? `${worldFaceSign ? GENERIC_FACE_UNFLIP : ""}
              // Skin and facial materials need source world axes for their view,
              // bounds and reflection terms.
              vec3 skinWorldView = transpose(mat3(viewMatrix)) * vViewPosition;
              vec3 skinWorldPosition = cameraPosition - skinWorldView;
              vec3 skinWorldNormal = transpose(mat3(viewMatrix)) * vNormal;
              vec3 skinWorldTangent = transpose(mat3(viewMatrix)) * vTangent;
              ReconstructedGeometry recoveredGeometry;
              recoveredGeometry.position = skinWorldPosition.xzy * 100.0;
              recoveredGeometry.view = skinWorldView.xzy * 100.0;
              recoveredGeometry.normal = skinWorldNormal.xzy${worldFaceSign ? " * recoveredUnflip" : ""};
              recoveredGeometry.tangent = skinWorldTangent.xzy${worldFaceSign ? " * recoveredUnflip" : ""};
              recoveredGeometry.handedness = -vRecoveredHandedness;${worldFaceSign ? `
              recoveredGeometry.faceSign = (gl_FrontFacing ? 1.0 : -1.0) * recoveredUnflip;` : ""}
              recoveredGeometry.objectPosition = vRecoveredObjectPosition.xzy * 100.0;
              ${hair || hairMetallic ? 'recoveredGeometry.color = vRecoveredColor;' : ''}
            ` : ""}
            ReconstructedSurface recovered = recoveredSurface(vRecoveredUv0, vRecoveredUv1${manifest.viewDependentCloth ? ", recoveredViewTangent" : ""}${usesGeometry ? ", recoveredGeometry" : ""});
            diffuseColor.rgb = recovered.baseColor;
            ${masked || parametric || (glass && view === 'lit') ? "diffuseColor.a *= clamp(recovered.opacity, 0.0, 1.0);" : ""}
            ${manifest.skinSurface && skinOptions?.preserveAlpha && !neckFade ? `
              #ifdef USE_MAP
                diffuseColor.a *= texture2D(map, vMapUv).a;
              #endif
            ` : ""}
            // recovered_surface_ready
          `);
          fragment = replaceChunk(fragment, "roughnessmap_fragment", "float roughnessFactor = recovered.roughness;");
          fragment = replaceChunk(fragment, "metalnessmap_fragment", "float metalnessFactor = recovered.metalness;");
          if (manifest.recoveredEmissive) fragment = replaceChunk(fragment, "emissivemap_fragment", `
            #include <emissivemap_fragment>
            totalEmissiveRadiance += recovered.emissive;
          `);
          fragment = replaceChunk(fragment, "normal_fragment_maps", `
            ${hair ? `
              // The source Normal output means fibre tangent for MSM_Hair. Keep
              // it distinct from the geometric card normal and do not flip its
              // root-to-tip direction when viewing a card from behind.
              mat3 recoveredFrame = mat3(normalize(vTangent), normalize(vBitangent), normalize(vNormal));
              vec3 recoveredStrand = normalize(recoveredFrame * normalize(recovered.normal));
            ` : manifest.normalSpace === "world" ? `
              normal = normalize(mat3(viewMatrix) * recovered.normal.xzy);
              #ifdef DOUBLE_SIDED
                normal *= faceDirection;
              #endif
            ` : `
            #ifdef USE_TANGENT
              mat3 recoveredFrame = mat3(normalize(vTangent), normalize(vBitangent), normal);
              #ifdef DOUBLE_SIDED
                recoveredFrame[0] *= faceDirection;
                recoveredFrame[1] *= faceDirection;
              #endif
              normal = normalize(recoveredFrame * normalize(recovered.normal));
            #else
            normal = normalize(recoveredTangentFrame(-vViewPosition, normal, vRecoveredUv0) * normalize(recovered.normal));
            #endif
            `}
          `);
          // UE stores dielectric F0 as 0.08 * Specular. Three's lighting remains a
          // preview renderer; substituting this value preserves the material input.
          fragment = replaceChunk(fragment, "lights_physical_fragment", `
            #include <lights_physical_fragment>
            material.specularColor = vec3(0.08 * recovered.specular);
            material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor);
            material.specularF90 = 1.0;
            ${hair ? `material.hairTangent = recoveredStrand;
              material.hairScatter = recovered.scatter;
              material.hairRoughness = recovered.roughness;
              material.hairSpecular = recovered.specular;` : ''}
          `);
          fragment = replaceChunk(fragment, "aomap_fragment", "reflectedLight.indirectDiffuse *= recovered.ao;");
          if (view !== "lit") {
            const value = view === "baseColor" ? "recovered.baseColor"
              : view === "normal" ? "normalize(recovered.normal) * 0.5 + 0.5" : `vec3(recovered.${view})`;
            fragment = replaceChunk(fragment, "opaque_fragment", `outgoingLight = ${value};\n#include <opaque_fragment>`);
          }
          shader.fragmentShader = fragment;
        };
        for (const value of Object.values(old)) if (value?.isTexture) value.dispose();
        old.dispose();
        return material;
      };
      if (Array.isArray(mesh.material)) {
        if (materialIndex !== undefined && !mesh.material[materialIndex]) throw new Error("Missing source material section");
        mesh.material = mesh.material.map((old, i) => materialIndex === undefined || i === materialIndex ? makeMaterial(old) : old);
      } else {
        if (materialIndex !== undefined && materialIndex !== 0) throw new Error("Missing source material section");
        mesh.material = makeMaterial(mesh.material);
      }
      if (masked) {
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const patchShadow = (shadow: THREE.MeshDepthMaterial | THREE.MeshDistanceMaterial) => {
          shadow.alphaHash = true;
          shadow.side = material.side;
          shadow.defines = { ...shadow.defines, ...(needsUv1 ? { USE_UV1: "" } : {}) };
          shadow.userData.recoveredCoverage = true;
          shadow.userData.recoveredSamplers = planReport;
          shadow.customProgramCacheKey = () => `recovered-coverage-v3:${manifest.coverageShaderSha256}:${plan.cacheKey}:${needsUv1}:${hair}:${maskedClip}${hairMetallic ? ":hair-metallic" : ""}`;
          shadow.onBeforeCompile = shader => {
            // Same plan, same uniform mapping as the surface pass.
            for (const binding of uniformBindings) shader.uniforms[binding.name] = { value: textures.get(binding.resource) };
            shader.vertexShader = 'varying vec2 vRecoveredUv0;\nvarying vec2 vRecoveredUv1;\n' + shader.vertexShader;
            // The metallic kind's coverage may read the vertex colour, so the shadow pass always supplies it.
            if (hairMetallic) shader.vertexShader = 'attribute vec4 color;\nvarying vec4 vRecoveredColor;\n' + shader.vertexShader;
            shader.vertexShader = replaceChunk(shader.vertexShader, 'uv_vertex', `#include <uv_vertex>
              vRecoveredUv0 = uv; vRecoveredUv1 = ${needsUv1 ? 'uv1' : 'vec2(0.0)'};${hairMetallic ? ' vRecoveredColor = color;' : ''}`);
            shader.fragmentShader = SURFACE_STRUCT + coverageShader + '\n'
              + (hairMetallic ? 'varying vec4 vRecoveredColor;\n' : '') + shader.fragmentShader;
            shader.fragmentShader = replaceChunk(shader.fragmentShader, 'map_fragment', maskedClip ? `
              // Masked clip coverage was emitted as a UV-only function.
              diffuseColor.a *= clamp(recoveredSurface(vRecoveredUv0, vRecoveredUv1).opacity, 0.0, 1.0);
            ` : `
              // Coverage was sliced independently. The hair kinds' coverage struct carries the vertex colour:
              // the metallic kind's dither powers can make it live, so the shadow pass passes the real colour;
              // the Karis hair kind's never is, so it keeps the synthetic white.
              ReconstructedGeometry g = ReconstructedGeometry(vec3(0.0), vec3(1.0,0.0,0.0), vec3(0.0,0.0,1.0),
                vec3(0.0,0.0,1.0), 1.0, vec3(0.0)${hair ? ', vec4(1.0)' : hairMetallic ? ', vRecoveredColor' : ''});
              diffuseColor.a *= clamp(recoveredSurface(vRecoveredUv0, vRecoveredUv1, g).opacity, 0.0, 1.0);
            `);
          };
          return shadow;
        };
        mesh.customDepthMaterial?.dispose();
        mesh.customDistanceMaterial?.dispose();
        mesh.customDepthMaterial = patchShadow(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
        mesh.customDistanceMaterial = patchShadow(new THREE.MeshDistanceMaterial());
      }
    },
  };
}
