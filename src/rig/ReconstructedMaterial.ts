import * as THREE from "three";
import { fetchAsset as checkedFetch } from "../lib/asset-fetch";
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
  skinCoverage?: 'neck-fade';
  worldSurface?: boolean;
  surfaceKind?: "eye" | "teeth" | "eyelash" | "hair";
  normalSpace?: "world" | "tangent" | "strand-tangent";
  twoSided?: boolean;
  requiresVertexColor?: boolean;
  parameterOverrides?: string[];
}

async function verifyHash(data: ArrayBuffer, expected: string): Promise<void> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  const actual = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  if (actual !== expected.toLowerCase()) throw new Error("Recovered material asset hash mismatch");
}

// Every sampler resource starts from the authored bytes: fetch, decompress and
// hash-check the original file before anything is uploaded or regrouped.
async function fetchTextureData(spec: TextureSpec, base: string): Promise<ArrayBuffer> {
  const response = await checkedFetch(new URL(spec.file, base).href);
  if (!response.body) throw new Error("Empty recovered texture response");
  const data = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  await verifyHash(data, spec.sha256);
  return data;
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
  const worldSurface = !!manifest.skinSurface || !!manifest.worldSurface;
  const usesGeometry = !!manifest.geometryDependentNormals || worldSurface;
  const hair = manifest.surfaceKind === 'hair';
  if (manifest.skinCoverage && (manifest.skinCoverage !== 'neck-fade' || !manifest.skinSurface))
    throw new Error('Unsupported recovered skin coverage');
  const neckFade = manifest.skinCoverage === 'neck-fade';
  const masked = manifest.surfaceKind === "eyelash" || hair || neckFade;
  const shaderBytes = await (await checkedFetch(new URL(manifest.shader, base).href)).arrayBuffer();
  await verifyHash(shaderBytes, manifest.shaderSha256);
  let recoveredShader = new TextDecoder().decode(shaderBytes);
  let coverageShader: string | undefined;
  if (masked) {
    if (!manifest.coverageShader || !manifest.coverageShaderSha256 || manifest.coverageGeometryFields?.length !== 0)
      throw new Error("Recovered masked shadows require validated UV-only coverage");
    const bytes = await (await checkedFetch(new URL(manifest.coverageShader, base).href)).arrayBuffer();
    await verifyHash(bytes, manifest.coverageShaderSha256);
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
  return {
    dispose,
    apply(mesh: THREE.Mesh, materialIndex?: number, skinOptions?: { boundsOrigin: [number, number, number]; preserveAlpha?: boolean }) {
      if (hair && (manifest.normalSpace !== 'strand-tangent' || !manifest.requiresVertexColor ||
          mesh.geometry.getAttribute('color')?.itemSize !== 4 || !worldSurface))
        throw new Error('Recovered hair requires the original RGBA vertex masks and strand tangent');
      if (masked && Array.isArray(mesh.material) && mesh.material.length !== 1)
        throw new Error("Recovered lash shadows require a separate source section");
      if (worldSurface && (!skinOptions || skinOptions.boundsOrigin.length !== 3 || !skinOptions.boundsOrigin.every(Number.isFinite)))
        throw new Error("Recovered world surface requires source bounds");
      if (usesGeometry && !mesh.geometry.hasAttribute("tangent")) {
        dispose();
        throw new Error("Geometry-dependent surface requires original tangents");
      }
      if (!mesh.geometry.hasAttribute("uv") || (needsUv1 && !mesh.geometry.hasAttribute("uv1"))) {
        dispose();
        throw new Error("Recovered surface is missing a required original UV set");
      }
      const makeMaterial = (old: THREE.Material) => {
        const material = new THREE.MeshPhysicalMaterial({
          name: `${manifest.itemId}:recovered`, roughness: 1, metalness: 1,
          side: manifest.twoSided === undefined ? old.side : manifest.twoSided ? THREE.DoubleSide : THREE.FrontSide,
        });
        // Spatial alpha hashing consumes the raw material coverage. Native UE
        // temporal dithering is still pending; texture alpha alone is not coverage.
        material.alphaHash = masked;
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
        material.userData.parameterOverrides = manifest.parameterOverrides;
        material.userData.hairLightingPolicy = hair ? 'Karis 2016 R/TT/TRT preview; native lighting, volume shadows and TAA pending' : undefined;
        material.userData.coveragePolicy = masked ? "raw material coverage with Three alpha hashing; native TAA pending" : undefined;
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
        material.customProgramCacheKey = () => `recovered-v10:${manifest.shaderSha256}:${plan.cacheKey}:${view}:${mesh.geometry.hasAttribute("tangent")}:${needsUv1}:${!!skinOptions?.preserveAlpha}:${worldSurface}:${manifest.normalSpace}:${neckFade}`;
        material.onBeforeCompile = (shader) => {
          for (const binding of uniformBindings) shader.uniforms[binding.name] = { value: textures.get(binding.resource) };
          shader.vertexShader = "varying vec2 vRecoveredUv0;\nvarying vec2 vRecoveredUv1;\n" + shader.vertexShader;
          // These channels are material masks, not diffuse vertex colours.
          if (hair) shader.vertexShader = 'attribute vec4 color;\nvarying vec4 vRecoveredColor;\n' + shader.vertexShader;
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
            ${hair ? 'vRecoveredColor = color;' : ''}
            ${usesGeometry ? "vRecoveredHandedness = tangent.w;" : ""}
            ${worldSurface ? "vRecoveredObjectPosition = (modelMatrix * vec4(uRecoveredBoundsOrigin, 1.0)).xyz;" : ""}
          `);
          let fragment = SURFACE_STRUCT + recoveredShader + "\n" + shader.fragmentShader;
          if (hair) {
            fragment = 'varying vec4 vRecoveredColor;\n' + fragment;
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
            ${manifest.geometryDependentNormals ? `
              // Differentiate a reflected view-space surface in source centimetres.
              // Positions and tangent vectors share one frame; retain interpolated
              // vector lengths, since the source differentiates their curvature.
              ReconstructedGeometry recoveredGeometry;
              recoveredGeometry.position = vec3(-vViewPosition.x, vViewPosition.y, -vViewPosition.z) * 100.0;
              recoveredGeometry.tangent = vec3(vTangent.x, -vTangent.y, vTangent.z);
              recoveredGeometry.normal = vec3(vNormal.x, -vNormal.y, vNormal.z);
              recoveredGeometry.view = -recoveredGeometry.position;
              recoveredGeometry.handedness = -vRecoveredHandedness;
            ` : ""}
            ${worldSurface ? `
              // Skin and facial materials need source world axes for their view,
              // bounds and reflection terms.
              vec3 skinWorldView = transpose(mat3(viewMatrix)) * vViewPosition;
              vec3 skinWorldPosition = cameraPosition - skinWorldView;
              vec3 skinWorldNormal = transpose(mat3(viewMatrix)) * vNormal;
              vec3 skinWorldTangent = transpose(mat3(viewMatrix)) * vTangent;
              ReconstructedGeometry recoveredGeometry;
              recoveredGeometry.position = skinWorldPosition.xzy * 100.0;
              recoveredGeometry.view = skinWorldView.xzy * 100.0;
              recoveredGeometry.normal = skinWorldNormal.xzy;
              recoveredGeometry.tangent = skinWorldTangent.xzy;
              recoveredGeometry.handedness = -vRecoveredHandedness;
              recoveredGeometry.objectPosition = vRecoveredObjectPosition.xzy * 100.0;
              ${hair ? 'recoveredGeometry.color = vRecoveredColor;' : ''}
            ` : ""}
            ReconstructedSurface recovered = recoveredSurface(vRecoveredUv0, vRecoveredUv1${manifest.viewDependentCloth ? ", recoveredViewTangent" : ""}${usesGeometry ? ", recoveredGeometry" : ""});
            diffuseColor.rgb = recovered.baseColor;
            ${masked ? "diffuseColor.a *= clamp(recovered.opacity, 0.0, 1.0);" : ""}
            ${manifest.skinSurface && skinOptions?.preserveAlpha && !neckFade ? `
              #ifdef USE_MAP
                diffuseColor.a *= texture2D(map, vMapUv).a;
              #endif
            ` : ""}
            // recovered_surface_ready
          `);
          fragment = replaceChunk(fragment, "roughnessmap_fragment", "float roughnessFactor = recovered.roughness;");
          fragment = replaceChunk(fragment, "metalnessmap_fragment", "float metalnessFactor = recovered.metalness;");
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
          shadow.customProgramCacheKey = () => `recovered-coverage-v3:${manifest.coverageShaderSha256}:${plan.cacheKey}:${needsUv1}:${hair}`;
          shadow.onBeforeCompile = shader => {
            // Same plan, same uniform mapping as the surface pass.
            for (const binding of uniformBindings) shader.uniforms[binding.name] = { value: textures.get(binding.resource) };
            shader.vertexShader = 'varying vec2 vRecoveredUv0;\nvarying vec2 vRecoveredUv1;\n' + shader.vertexShader;
            shader.vertexShader = replaceChunk(shader.vertexShader, 'uv_vertex', `#include <uv_vertex>
              vRecoveredUv0 = uv; vRecoveredUv1 = ${needsUv1 ? 'uv1' : 'vec2(0.0)'};`);
            shader.fragmentShader = SURFACE_STRUCT + coverageShader + '\n' + shader.fragmentShader;
            shader.fragmentShader = replaceChunk(shader.fragmentShader, 'map_fragment', `
              // Coverage was sliced independently and has no live geometry inputs.
              ReconstructedGeometry g = ReconstructedGeometry(vec3(0.0), vec3(1.0,0.0,0.0), vec3(0.0,0.0,1.0),
                vec3(0.0,0.0,1.0), 1.0, vec3(0.0)${hair ? ', vec4(1.0)' : ''});
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
