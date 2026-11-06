import * as THREE from "three";
import { fetchAsset as checkedFetch } from "../lib/asset-fetch";
import { VerifiedByteCache } from "../lib/verified-bytes";
import { HAIR_LIGHTING_GLSL } from './HairLighting';
import { installSampledAlphaHash } from './AlphaHashSampling';
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
  surfaceKind?: "eye" | "teeth" | "eyelash" | "hair" | "hair-metallic" | "glass" | "hologram" | "attachment-family"
    | "thin-translucent";
  // (w122, decision #16a) a pinned MSM_ThinTranslucent program (scripts/shader-probe/thin_translucent_contract.py): UE's
  // dual-source blend Dest = o0 + Dest * o1 drawn as a multiply pass (o1) then an additive pass (o0).
  thinTranslucentSurface?: boolean;
  thinTranslucentPolicy?: string;
  // A qualified attachment-family program (scripts/shader-probe/attachment_family_contract.py), on the worldSurface route.
  attachmentFamily?: boolean;
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
  // Preview emission exposure (signed off 29 Oct 2026, _docs/goal-100-2026-10-11/signoffs-2026-10-29.json
  // emissionHueKeepingExposure): a recovered emission brighter than 1 in any channel is scaled so its peak channel is 1,
  // keeping its hue, before the Neutral tone curve. Opt-in per manifest; absent, the emission is added unchanged.
  emissiveExposure?: "hue-keeping";
  // Authored opacity mask through the compiled dithered clip (scripts/shader-probe/masked_contract.py). cutout: the
  // attachment-family dither-free cut-out (attachment_family_contract.FAMILY_CUTOUT_POLICY), opacity exactly 0 or 1.
  maskedClip?: { policy: string; cutout?: boolean; opacitySource: { slot: string; component?: string; texture?: string };
    neckFade?: { slot: string | null; fade: number[] } };
  // PlasticSheet parametric fresnel opacity through its DitherTemporalAA clip (scripts/shader-probe/plastic_sheet_contract.py):
  // a geometry-dependent kept fraction rendered with alpha hashing; no UV-only coverage, so shadows stay opaque.
  parametricOpacity?: { policy: string; fields?: string[] };
  // PlasticSheet two-sided sign pins; the face sign itself is listed in requiredGeometryFields when the program reads it.
  twoSidedSign?: { policy: string };
  // Glass: 'source-world' for a cubemap program (its reflection lookup needs fixed UE world axes), otherwise
  // 'source-world-or-orthonormal-equivalent' (dot products only, evaluated in reflected view space).
  geometryFrame?: string;
  requiredGeometryFields?: string[];
  // (w115) the base-pass vertex shader's TEXCOORD record (scripts/shader-probe/vertex_interpolants.py).
  vertexInterpolants?: unknown;
  // (w119 watches) a static-mesh (FLocalVertexFactory) base pass of an enrolled root (build-materials STATIC_MESH_POLICY).
  staticMesh?: { name?: string };
  // (w115 part 2) vertex_offset.py's record; `value` is the scale with the material constants folded in.
  vertexOffset?: { value?: unknown };
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
// (w98b cel family, decision #5) the rendering camera's world axes a cameraBasis program reads: cb0[24..26], the
// right/up/forward rows of View.CameraViewToTranslatedWorld (the cel eyes MI's fake highlight), supplied live by the
// worldSurface block. cameraForward is also the Lavalamp cameraForward field (cb0[18]); supplying it here does not
// lift that program's registry stop (its manifest can never be built while it is stopped).
const CAMERA_BASIS_FIELDS = new Set(["cameraRight", "cameraUp", "cameraForward"]);
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

// (w122, decision #16a) Thin-translucent blend passes. A lit section's material is its first pass; THIN_PASSES maps it to
// the passes three must draw right after it, with the same object, geometry and group. One hook per mesh draws them
// from onAfterRender, which three calls once per render item right after that item's draw; renderBufferDirect is the
// call three itself makes for each side of a DoubleSide transparent material. The shadow pass never calls it.
const THIN_PASSES = new WeakMap<THREE.Material, THREE.Material[]>();
function installThinPasses(mesh: THREE.Mesh) {
  if (mesh.userData.recoveredThinPassHook === true) return;
  mesh.userData.recoveredThinPassHook = true;
  const previous = mesh.onAfterRender;
  mesh.onAfterRender = function (renderer, scene, camera, geometry, material, group) {
    previous.call(this, renderer, scene, camera, geometry, material, group);
    const rest = THIN_PASSES.get(material);
    // three's typings name the last argument a Group; at runtime it is the render item's geometry group (or null).
    if (rest) for (const pass of rest)
      renderer.renderBufferDirect(camera, scene, geometry, pass, this, group as unknown as THREE.GeometryGroup);
  };
}

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
  vec3 transmittance; // (w122) thin-translucent programs only; unwritten elsewhere
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

// (w115 part 2) A vertex_offset.py scale expression as GLSL: UV0 (the `uv` attribute), the vertex colour (read as
// recoveredOffsetColor), finite literals, floor, neg, add and mul. Anything else fails closed.
function offsetGlsl(e: unknown): string {
  if (Array.isArray(e)) {
    const [kind, ...args] = e as unknown[];
    if (kind === 'uv' && args[0] === 0 && (args[1] === 'x' || args[1] === 'y')) return `uv.${args[1]}`;
    if (kind === 'color' && typeof args[0] === 'string' && ['x', 'y', 'z', 'w'].includes(args[0]))
      return `recoveredOffsetColor.${args[0]}`;
    if (kind === 'const' && args.length === 1 && typeof args[0] === 'number' && Number.isFinite(args[0])) {
      const text = Math.fround(args[0]).toPrecision(9);
      return `(${text})`;
    }
    if ((kind === 'floor' || kind === 'neg') && args.length === 1)
      return kind === 'floor' ? `floor(${offsetGlsl(args[0])})` : `(-${offsetGlsl(args[0])})`;
    if ((kind === 'add' || kind === 'mul') && args.length === 2)
      return `(${offsetGlsl(args[0])} ${kind === 'add' ? '+' : '*'} ${offsetGlsl(args[1])})`;
  }
  throw new Error('Unsupported recovered vertex offset expression');
}

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
  // (w122, decision #16a) the thin-translucent route: the cubemap glass block's source-world geometry, its own
  // emission and transmittance outputs, and (lit view) the two blend passes per face side. Nothing else combines with it.
  const thin = !!manifest.thinTranslucentSurface;
  if ((thin || manifest.surfaceKind === 'thin-translucent') && (!thin || manifest.surfaceKind !== 'thin-translucent'
    || manifest.normalSpace !== 'tangent' || manifest.blendMode !== 'BLEND_TranslucentGreyTransmittance'
    || manifest.shadingModel !== 'MSM_ThinTranslucent' || manifest.geometryFrame !== 'source-world'
    || typeof manifest.twoSided !== 'boolean' || worldSurface || glass || hologram || manifest.viewDependentCloth
    || manifest.geometryDependentNormals || manifest.maskedClip !== undefined || manifest.parametricOpacity !== undefined
    || manifest.coverageShader !== undefined || manifest.vertexInterpolants !== undefined
    || manifest.vertexOffset !== undefined || manifest.staticMesh !== undefined || manifest.emissiveExposure !== undefined
    || !(manifest.requiredGeometryFields ?? []).every(field => GLASS_SOURCE_WORLD_FIELDS.has(field))))
    throw new Error('Unsupported recovered thin-translucent surface contract');
  const thinFaceSign = thin && (manifest.requiredGeometryFields ?? []).includes('faceSign');
  const sourceWorldGeometry = glassSourceWorld || thin;
  const usesGeometry = !!manifest.geometryDependentNormals || worldSurface || glass || thin;
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
  // 29 Oct 2026 (w85, decision #14): an attachment-family surface's dither-free cut-out (the player-name mask). Its
  // opacity is exactly 0 or 1 and its coverage is UV-only, so the alpha-hash and UV-only shadow paths keep or discard
  // each fragment exactly. Only that pairing is admitted on the worldSurface route; skin never.
  // 29 Oct 2026 (w87 Feather, decision #12): or the kept fraction of a dithered family tail (masked_contract): its
  // opacity is one authored channel (opacitySource.component) at UV-only coordinates, so the same alpha-hash and
  // UV-only shadow paths reproduce it as they do on any masked clip.
  // 2 Nov 2026 (w113 blank-face LED head): or the bare neck fade of a family head program with no hair-card term
  // (masked_contract NECK_FADE_BARE_POLICY): its kept fraction reads UV v alone, no texture, on the same paths.
  const familyCutout = maskedClip && manifest.attachmentFamily === true
    && manifest.surfaceKind === 'attachment-family' && !!manifest.worldSurface && !manifest.skinSurface
    && (manifest.maskedClip?.cutout === true || typeof manifest.maskedClip?.opacitySource?.component === 'string'
      || (manifest.maskedClip?.neckFade?.slot === null && Array.isArray(manifest.maskedClip?.neckFade?.fade)));
  if (maskedClip && (((worldSurface || manifest.surfaceKind) && !familyCutout) || glass
    || typeof manifest.maskedClip?.policy !== 'string'))
    throw new Error('Unsupported recovered masked clip contract');
  const masked = manifest.surfaceKind === "eyelash" || hair || hairMetallic || neckFade || maskedClip;
  // PlasticSheet (plastic_sheet_contract): parametric opacity on the generic geometry route, BLEND_Masked only.
  const parametric = !!manifest.parametricOpacity;
  if (parametric && (!manifest.geometryDependentNormals || worldSurface || glass || maskedClip || manifest.surfaceKind
    || manifest.blendMode !== 'BLEND_Masked' || typeof manifest.parametricOpacity?.policy !== 'string'))
    throw new Error('Unsupported recovered parametric opacity contract');
  // The hue-keeping emission exposure applies to a deferred surface's recovered emission only: never the additive
  // hologram (its light is the whole output) nor the forward glass route.
  const hueKeeping = manifest.emissiveExposure !== undefined;
  if (hueKeeping && (manifest.emissiveExposure !== 'hue-keeping' || manifest.recoveredEmissive !== true || hologram || glass))
    throw new Error('Unsupported recovered emissive exposure');
  // A generic geometry program that reads the rasterizer face (two-sided PlasticSheet); cubemap glass has its own block.
  const faceSignField = !glass && !thin && (manifest.requiredGeometryFields ?? []).includes('faceSign');
  const genericFaceSign = faceSignField && !manifest.worldSurface;
  if (genericFaceSign && (!manifest.geometryDependentNormals || worldSurface))
    throw new Error('Unsupported recovered face sign contract');
  // A two-sided source-world program that reads the rasterizer face (M_FlowerPetal, scripts/shader-probe/
  // attachment_family_contract.py; 23 Oct 2026): the worldSurface block supplies it as the cubemap glass block does.
  // Never on skin or on a program that also declares the generic geometry route (both blocks would declare the geometry).
  const worldFaceSign = faceSignField && !!manifest.worldSurface;
  if (worldFaceSign && (manifest.skinSurface || manifest.geometryDependentNormals || manifest.twoSided !== true))
    throw new Error('Unsupported recovered face sign contract');
  // (w98b cel family, decision #5) a worldSurface program that reads the rendering camera's world axes (the cel eyes
  // MI's fake highlight; reads.cameraBasis in scripts/shader-probe/attachment_family_programs.json, cb0[24..26] =
  // View.CameraViewToTranslatedWorld's right/up/forward rows): the worldSurface block supplies them live each frame
  // from the camera's world matrix, in the same source-world frame as view and position. Each field is set only when
  // the program's own requiredGeometryFields lists it (a folded-dead row stays unset, exactly as the emitted shader's
  // struct declares it); never on skin.
  const worldCameraBasis = !glass && worldSurface
    ? (manifest.requiredGeometryFields ?? []).filter(field => CAMERA_BASIS_FIELDS.has(field)) : [];
  if (worldCameraBasis.length && (manifest.skinSurface || manifest.geometryDependentNormals))
    throw new Error('Unsupported recovered camera basis contract');
  // (w115 vertex interpolators) a program whose base-pass vertex shader passes the raw local position through
  // (manifest.vertexInterpolants): only the generic geometry route sets it, from the untouched position attribute
  // (three applies morphs and skinning to `transformed`, never to `position`), in source centimetres and axes:
  // build-meshes writes GLB = UE (X, Z, Y) * 0.01.
  const localPosition = (manifest.requiredGeometryFields ?? []).includes('localPosition');
  if (localPosition && (!manifest.geometryDependentNormals || worldSurface || glass || !manifest.vertexInterpolants))
    throw new Error('Unsupported recovered local position contract');
  // (w115 part 2) the world position offset the same vertex shader applies (vertex_offset.py: fur shells pushed out by
  // layer x Length, M_FurLOD inflated by a vertex-colour term): S along the skinned object normal, in UE centimetres.
  // Only with the vertex record on the generic route, and masked, so the custom shadow pass carries it too.
  const vertexOffset = manifest.vertexOffset === undefined ? undefined : offsetGlsl(manifest.vertexOffset?.value);
  if (vertexOffset !== undefined && (!manifest.geometryDependentNormals || worldSurface || glass
    || !manifest.vertexInterpolants || !maskedClip))
    throw new Error('Unsupported recovered vertex offset contract');
  const offsetColor = vertexOffset?.includes('recoveredOffsetColor') ?? false;
  // (w119 watches) a static-mesh program that reads the mesh vertex colour (its COLOR0, sm5_slice static_mesh): the
  // generic geometry route supplies it as the hair kinds do. Only there, and never with the vertex offset's own colour
  // attribute declaration.
  const staticColor = manifest.staticMesh?.name === 'static-mesh-base-pass-v1' && manifest.requiresVertexColor === true;
  if (manifest.staticMesh !== undefined && manifest.staticMesh?.name !== 'static-mesh-base-pass-v1')
    throw new Error('Unsupported recovered static-mesh contract');
  if (staticColor && (!manifest.geometryDependentNormals || worldSurface || glass || hair || hairMetallic
    || vertexOffset !== undefined || !(manifest.requiredGeometryFields ?? []).includes('color')))
    throw new Error('Unsupported recovered static-mesh colour contract');
  const offsetVertex = vertexOffset === undefined ? '' : `${offsetColor ? `
    #if defined( USE_COLOR ) && !defined( USE_COLOR_ALPHA )
      vec4 recoveredOffsetColor = vec4( color, 1.0 );
    #else
      vec4 recoveredOffsetColor = vec4( color );
    #endif` : ''}
    transformed += normalize( objectNormal ) * ( ${vertexOffset} ) * 0.01;`;
  // The vertex colour is a material input here, as for hair; three declares the attribute only with vertexColors.
  const offsetColorAttribute = offsetColor
    ? '#if !defined( USE_COLOR ) && !defined( USE_COLOR_ALPHA )\nattribute vec4 color;\n#endif\n' : '';
  const shaderBytes = await verifiedBytes.load(new URL(manifest.shader, base).href, manifest.shaderSha256, "identity");
  let recoveredShader = new TextDecoder().decode(shaderBytes);
  if (hologram && HOLOGRAM_VIEW_STRUCT.test(recoveredShader) !== viewFields.length > 0)
    throw new Error("Unsupported recovered hologram contract: view struct");
  let coverageShader: string | undefined;
  // hair-metallic coverage may read the vertex colour (its dither powers differ per instance); every other masked
  // kind keeps UV-only coverage. The field must be present either way.
  const coverageColor = hairMetallic && manifest.coverageGeometryFields?.length === 1
    && manifest.coverageGeometryFields[0] === "color";
  // (w115) a masked cut-out whose clip reads the vertex-recorded local position (M_FurShells' wind mask): its coverage
  // takes that one field, which the shadow pass supplies from the same untouched position attribute.
  const coverageLocal = localPosition && maskedClip && manifest.coverageGeometryFields?.length === 1
    && manifest.coverageGeometryFields[0] === "localPosition";
  if (masked) {
    if (!manifest.coverageShader || !manifest.coverageShaderSha256
      || !(hairMetallic
        ? (manifest.coverageGeometryFields?.length === 0 || coverageColor)
        : manifest.coverageGeometryFields?.length === 0 || coverageLocal))
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
    apply(mesh: THREE.Mesh, materialIndex?: number, skinOptions?: { boundsOrigin: [number, number, number]; preserveAlpha?: boolean;
        requireSourceCoverage?: boolean }) {
      // A legacy-free head has no legacy alpha for preserveAlpha to keep (w91-head-skin): its skin must bring the source neck coverage.
      if (skinOptions?.requireSourceCoverage && manifest.skinSurface && !neckFade)
        throw new Error('A legacy-free head skin requires the source neck coverage');
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
      // thinPass (w122): one of the lit thin-translucent blend passes, drawn on one face side; release: whether this call
      // owns disposing the replaced material (the last pass made for a section).
      const makeMaterial = (old: THREE.Material, thinPass?: 'multiply' | 'add', thinSide?: THREE.Side, release = true) => {
        const material = new THREE.MeshPhysicalMaterial({
          name: `${manifest.itemId}:recovered${thinPass ? `:${thinPass}` : ''}`, roughness: 1, metalness: 1,
          side: thinPass ? thinSide! : manifest.twoSided === undefined ? old.side : manifest.twoSided ? THREE.DoubleSide : THREE.FrontSide,
        });
        // Spatial alpha hashing consumes the raw material coverage. Native UE
        // temporal dithering is still pending; texture alpha alone is not coverage.
        // PlasticSheet's kept fraction replaces UE's temporal dither the same way (signed off, ditheredOpacity).
        material.alphaHash = masked || parametric;
        // Qualified glass recovers the source material's opacity. It uses the
        // preview's alpha blend and lighting, not UE refraction/transmittance.
        material.transparent = (glass && view === 'lit') || !!thinPass;
        material.depthWrite = !material.transparent;
        if (thinPass) {
          // UE writes o0 + Dest * o1 with dual-source blending. Pass 1 multiplies what is behind by o1 (Zero/SrcColor);
          // pass 2 adds o0 (One/One). Alpha keeps the target's coverage (Zero/One). Depth tested, never written. The
          // multiplier is a linear factor, never tone-mapped; exact in the stable-frame accumulator's linear target.
          Object.assign(material, {
            blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendEquationAlpha: THREE.AddEquation,
            blendSrc: thinPass === 'multiply' ? THREE.ZeroFactor : THREE.OneFactor,
            blendDst: thinPass === 'multiply' ? THREE.SrcColorFactor : THREE.OneFactor,
            blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, forceSinglePass: true,
          });
        }
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
        material.toneMapped = view === "lit" && thinPass !== 'multiply';
        material.userData.reconstructed = true;
        if (thin) {
          // OutfitExport bakes it like glass (source opacity, alpha blend); StableFrameState turns the accumulator on.
          material.userData.thinTranslucentPolicy = manifest.thinTranslucentPolicy ?? 'thin-translucent two-pass blend';
          material.userData.recoveredThinTranslucent = view === 'lit';
          material.userData.thinPass = thinPass;
        }
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
        material.customProgramCacheKey = () => `recovered-v13:${manifest.shaderSha256}:${plan.cacheKey}:${view}:${mesh.geometry.hasAttribute("tangent")}:${needsUv1}:${!!skinOptions?.preserveAlpha}:${worldSurface}:${manifest.normalSpace}:${neckFade}:${glass}:${maskedClip}:${parametric}:${genericFaceSign}${hairMetallic ? ":hair-metallic" : ""}${worldFaceSign ? ":world-face-sign" : ""}${worldCameraBasis.length ? ":world-camera-basis" : ""}${hueKeeping ? ":hue-keeping" : ""}${vertexOffset ? `:offset:${vertexOffset}` : ""}${thin ? `:thin:${thinPass ?? "single"}` : ""}`;
        if (hueKeeping) material.userData.emissiveExposurePolicy = 'hue-keeping preview exposure: peak channel scaled to 1 (signoffs-2026-10-29.json)';
        material.onBeforeCompile = (shader) => {
          // Decision #19: alpha-hashed coverage converges in the stable-frame accumulator (inert without alphaHash).
          installSampledAlphaHash(shader, material);
          for (const binding of uniformBindings) shader.uniforms[binding.name] = { value: textures.get(binding.resource) };
          shader.vertexShader = "varying vec2 vRecoveredUv0;\nvarying vec2 vRecoveredUv1;\n" + shader.vertexShader;
          // These channels are material masks, not diffuse vertex colours.
          if (hair || hairMetallic || staticColor) shader.vertexShader = 'attribute vec4 color;\nvarying vec4 vRecoveredColor;\n' + shader.vertexShader;
          if (usesGeometry) shader.vertexShader = "varying float vRecoveredHandedness;\n" + shader.vertexShader;
          if (localPosition) shader.vertexShader = "varying vec3 vRecoveredLocalPosition;\n" + shader.vertexShader;
          if (worldSurface) {
            const [x, y, z] = skinOptions!.boundsOrigin;
            shader.uniforms.uRecoveredBoundsOrigin = { value: new THREE.Vector3(x, z, y).multiplyScalar(0.01) };
            shader.vertexShader = "uniform vec3 uRecoveredBoundsOrigin;\nvarying vec3 vRecoveredObjectPosition;\n" + shader.vertexShader;
          }
          shader.vertexShader = replaceChunk(shader.vertexShader, "uv_vertex", `
            #include <uv_vertex>
            vRecoveredUv0 = uv;
            vRecoveredUv1 = ${needsUv1 ? "uv1" : "vec2(0.0)"};
            ${hair || hairMetallic || staticColor ? 'vRecoveredColor = color;' : ''}
            ${usesGeometry ? "vRecoveredHandedness = tangent.w;" : ""}
            ${localPosition ? "vRecoveredLocalPosition = position;" : ""}
            ${worldSurface ? "vRecoveredObjectPosition = (modelMatrix * vec4(uRecoveredBoundsOrigin, 1.0)).xyz;" : ""}
          `);
          if (vertexOffset) {
            // After skinning, along the skinned object normal (the vertex shader's world normal before LocalToWorld).
            shader.vertexShader = offsetColorAttribute + replaceChunk(shader.vertexShader, "skinning_vertex",
              `#include <skinning_vertex>${offsetVertex}`);
          }
          let fragment = SURFACE_STRUCT + recoveredShader + "\n" + shader.fragmentShader;
          if (hair || hairMetallic || staticColor) fragment = 'varying vec4 vRecoveredColor;\n' + fragment;
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
          if (localPosition) fragment = "varying vec3 vRecoveredLocalPosition;\n" + fragment;
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
            ${sourceWorldGeometry ? GLASS_SOURCE_WORLD_GEOMETRY + (glassFaceSign || thinFaceSign
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
              recoveredGeometry.faceSign = (gl_FrontFacing ? 1.0 : -1.0) * recoveredUnflip;` : ""}${staticColor ? `
              recoveredGeometry.color = vRecoveredColor;` : ""}${localPosition ? `
              recoveredGeometry.localPosition = vRecoveredLocalPosition.xzy * 100.0;` : ""}
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
              ${worldCameraBasis.length ? `
              // (w98b cel family, decision #5) the rendering camera's world axes, live from the camera's world matrix:
              // right = the +X column, up = the +Y column, forward = the -Z column in three's world frame, then the
              // same source-world .xzy conversion view and position use (SourceTransform's UE (X, Y, Z) = three (x, z, y)).
              // In that frame right x up = forward (UE's left-handed camera basis under the standard cross product).
              ${worldCameraBasis.includes('cameraRight')
                ? 'recoveredGeometry.cameraRight = (transpose(mat3(viewMatrix)) * vec3(1.0, 0.0, 0.0)).xzy;' : ''}
              ${worldCameraBasis.includes('cameraUp')
                ? 'recoveredGeometry.cameraUp = (transpose(mat3(viewMatrix)) * vec3(0.0, 1.0, 0.0)).xzy;' : ''}
              ${worldCameraBasis.includes('cameraForward')
                ? 'recoveredGeometry.cameraForward = (transpose(mat3(viewMatrix)) * vec3(0.0, 0.0, -1.0)).xzy;' : ''}
` : ''}
            ` : ""}
            ReconstructedSurface recovered = recoveredSurface(vRecoveredUv0, vRecoveredUv1${manifest.viewDependentCloth ? ", recoveredViewTangent" : ""}${usesGeometry ? ", recoveredGeometry" : ""});
            diffuseColor.rgb = recovered.baseColor;
            ${masked || parametric || (glass && view === 'lit') || thinPass ? "diffuseColor.a *= clamp(recovered.opacity, 0.0, 1.0);" : ""}
            ${manifest.skinSurface && skinOptions?.preserveAlpha && !neckFade ? `
              #ifdef USE_MAP
                diffuseColor.a *= texture2D(map, vMapUv).a;
              #endif
            ` : ""}
            // recovered_surface_ready
          `);
          fragment = replaceChunk(fragment, "roughnessmap_fragment", "float roughnessFactor = recovered.roughness;");
          fragment = replaceChunk(fragment, "metalnessmap_fragment", "float metalnessFactor = recovered.metalness;");
          if (manifest.recoveredEmissive || thin) fragment = replaceChunk(fragment, "emissivemap_fragment", hueKeeping ? `
            #include <emissivemap_fragment>
            float recoveredEmissivePeak = max(max(recovered.emissive.r, recovered.emissive.g), recovered.emissive.b);
            totalEmissiveRadiance += recoveredEmissivePeak > 1.0 ? recovered.emissive / recoveredEmissivePeak : recovered.emissive;
          ` : `
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
              #endif${thin ? `
              #ifdef FLIP_SIDED
                // A back-side pass (w122): three negated the tangent and normal but rebuilt the same bitangent; UE
                // negates the whole tangent-to-world normal on a back face (TwoSidedSign), as the DOUBLE_SIDED path does.
                recoveredFrame[1] *= -1.0;
              #endif` : ""}
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
          if (thinPass === 'multiply') {
            // o1 (thin_translucent_contract POLICY): exp(log T / NoV) (1 - F)^2 (1 - opacity), NoV = min(|N.V| + 1e-5, 1),
            // F = F0 (1 - Fc) + saturate(50 F0.g) Fc, Fc = (1 - NoV)^5, F0 = lerp(0.08 Specular, BaseColor, Metallic);
            // fog excluded. pow(T, 1/NoV) is exp(log T / NoV) for T >= 0, including T = 0.
            fragment = replaceChunk(fragment, "opaque_fragment", `
              float recoveredNoV = min(abs(dot(normal, geometryViewDir)) + 1e-5, 1.0);
              vec3 recoveredF0 = mix(vec3(0.08 * recovered.specular), recovered.baseColor, recovered.metalness);
              float recoveredFc = pow(1.0 - recoveredNoV, 5.0);
              vec3 recoveredInvF = 1.0 - (recoveredF0 * (1.0 - recoveredFc) + clamp(50.0 * recoveredF0.g, 0.0, 1.0) * recoveredFc);
              outgoingLight = pow(max(recovered.transmittance, vec3(0.0)), vec3(1.0 / recoveredNoV))
                * recoveredInvF * recoveredInvF * (1.0 - clamp(recovered.opacity, 0.0, 1.0));
              #include <opaque_fragment>`);
          } else if (thinPass === 'add') {
            // o0 under the preview lights: (diffuse + emissive) opacity + specular; fog and PreExposure excluded.
            fragment = replaceChunk(fragment, "opaque_fragment", `
              outgoingLight = (totalDiffuse + totalEmissiveRadiance) * clamp(recovered.opacity, 0.0, 1.0) + totalSpecular;
              #include <opaque_fragment>`);
          }
          if (view !== "lit") {
            const value = view === "baseColor" ? "recovered.baseColor"
              : view === "normal" ? "normalize(recovered.normal) * 0.5 + 0.5" : `vec3(recovered.${view})`;
            fragment = replaceChunk(fragment, "opaque_fragment", `outgoingLight = ${value};\n#include <opaque_fragment>`);
          }
          shader.fragmentShader = fragment;
        };
        if (release) {
          for (const value of Object.values(old)) if (value?.isTexture) value.dispose();
          old.dispose();
        }
        return material;
      };
      // (w122) a lit thin-translucent section: its passes in UE's per-fragment order, back faces before front faces
      // (Dest = o0 + Dest * o1 per layer). The section's own material is the first pass; the rest follow it in the same
      // render item (installThinPasses), exactly as three draws a DoubleSide transparent material's two sides.
      const makeSection = (old: THREE.Material) => {
        if (!(thin && view === 'lit')) return makeMaterial(old);
        const sides = manifest.twoSided ? [THREE.BackSide, THREE.FrontSide] : [THREE.FrontSide];
        const steps = sides.flatMap(side => (['multiply', 'add'] as const).map(pass => ({ side, pass })));
        const passes = steps.map((step, i) => makeMaterial(old, step.pass, step.side, i === steps.length - 1));
        const [first, ...rest] = passes;
        THIN_PASSES.set(first, rest);
        first.addEventListener('dispose', () => rest.forEach(pass => pass.dispose()));
        return first;
      };
      if (thin && view === 'lit') installThinPasses(mesh);
      if (Array.isArray(mesh.material)) {
        if (materialIndex !== undefined && !mesh.material[materialIndex]) throw new Error("Missing source material section");
        mesh.material = mesh.material.map((old, i) => materialIndex === undefined || i === materialIndex ? makeSection(old) : old);
      } else {
        if (materialIndex !== undefined && materialIndex !== 0) throw new Error("Missing source material section");
        mesh.material = makeSection(mesh.material);
      }
      if (masked) {
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const patchShadow = (shadow: THREE.MeshDepthMaterial | THREE.MeshDistanceMaterial) => {
          shadow.alphaHash = true;
          shadow.side = material.side;
          shadow.defines = { ...shadow.defines, ...(needsUv1 ? { USE_UV1: "" } : {}) };
          shadow.userData.recoveredCoverage = true;
          shadow.userData.recoveredSamplers = planReport;
          shadow.customProgramCacheKey = () => `recovered-coverage-v3:${manifest.coverageShaderSha256}:${plan.cacheKey}:${needsUv1}:${hair}:${maskedClip}${hairMetallic ? ":hair-metallic" : ""}${coverageLocal ? ":local" : ""}${vertexOffset ? `:offset:${vertexOffset}` : ""}`;
          shadow.onBeforeCompile = shader => {
            // Shadow maps redraw for every accumulator sample, so the shadow's coverage converges the same way.
            installSampledAlphaHash(shader, shadow);
            // Same plan, same uniform mapping as the surface pass.
            for (const binding of uniformBindings) shader.uniforms[binding.name] = { value: textures.get(binding.resource) };
            shader.vertexShader = 'varying vec2 vRecoveredUv0;\nvarying vec2 vRecoveredUv1;\n' + shader.vertexShader;
            // The metallic kind's coverage may read the vertex colour, so the shadow pass always supplies it.
            if (hairMetallic) shader.vertexShader = 'attribute vec4 color;\nvarying vec4 vRecoveredColor;\n' + shader.vertexShader;
            if (coverageLocal) shader.vertexShader = 'varying vec3 vRecoveredLocalPosition;\n' + shader.vertexShader;
            shader.vertexShader = replaceChunk(shader.vertexShader, 'uv_vertex', `#include <uv_vertex>
              vRecoveredUv0 = uv; vRecoveredUv1 = ${needsUv1 ? 'uv1' : 'vec2(0.0)'};${hairMetallic ? ' vRecoveredColor = color;' : ''}${coverageLocal ? ' vRecoveredLocalPosition = position;' : ''}`);
            if (vertexOffset) {
              // The depth materials compute the skinned normal only with a displacement map; the offset needs it.
              shader.vertexShader = offsetColorAttribute + replaceChunk(shader.vertexShader, 'skinning_vertex', `#include <skinning_vertex>
                #ifndef USE_DISPLACEMENTMAP
                  #include <beginnormal_vertex>
                  #include <morphnormal_vertex>
                  #include <skinnormal_vertex>
                #endif${offsetVertex}`);
            }
            shader.fragmentShader = SURFACE_STRUCT + coverageShader + '\n'
              + (hairMetallic ? 'varying vec4 vRecoveredColor;\n' : '')
              + (coverageLocal ? 'varying vec3 vRecoveredLocalPosition;\n' : '') + shader.fragmentShader;
            shader.fragmentShader = replaceChunk(shader.fragmentShader, 'map_fragment', maskedClip ? `
              // Masked clip coverage was emitted as a UV-only function${coverageLocal ? ", plus the source local position (w115)" : ""}.
              diffuseColor.a *= clamp(recoveredSurface(vRecoveredUv0, vRecoveredUv1${coverageLocal
                ? ", ReconstructedCoverageGeometry(vRecoveredLocalPosition.xzy * 100.0)" : ""}).opacity, 0.0, 1.0);
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
