import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { clone as cloneHierarchy } from "three/examples/jsm/utils/SkeletonUtils.js";
import { dilate, linearToSrgb, uvTiles } from "../lib/bake-image";

// Developer export: the composed outfit as one binary glTF (.glb), the interchange format Blender imports natively,
// Unity reads through glTFast and Unreal through its glTF importer.
//
// The preview's materials are three standard/physical materials whose real surface is injected at compile time
// (recovered UE shaders, body decals, body-hide discards), so an exporter reading material fields would write blank
// grey PBR. Each visible section is baked in its own UV0 space instead: the live material is drawn once with
// gl_Position = UV, and one multi-target pass captures the base colour, tangent-space normal, AO/roughness/
// metalness/opacity and emissive the preview shades with. View-dependent terms use the current camera. Fitting
// morphs are applied to the exported vertices, so engines that ignore default morph weights still get fitted clothes.
// A section whose UV islands sit in several whole UV tiles (most garments) bakes one image per tile and exports one
// primitive per tile, each with its own material, so every tile keeps the full texture size (bake-image uvTiles).

export type ExportPose = "bind" | "preview";
export interface OutfitExportOptions { textureSize: number; pose: ExportPose; onProgress?: (message: string) => void }
export interface OutfitExportResult { glb: ArrayBuffer; bakedSections: number; keptSections: number; warnings: string[] }

const BAKE_KEY = "uv-bake-v1";
// xy = offset, zw = scale (bakeRect): the baked square position of a UV.
const BAKE_RECT = { value: new THREE.Vector4(0, 0, 1, 1) };
const UV_POSITION = "gl_Position = vec4((uv * uBakeUvRect.zw + uBakeUvRect.xy) * 2.0 - 1.0, 0.0, 1.0);";
const PADDING_PASSES = 16;
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
// Which texels the section's triangles cover, regardless of discards; the live pass then tells what was cut out.
const COVERAGE = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: { uBakeUvRect: BAKE_RECT },
  vertexShader: `precision highp float;\nin vec2 uv;\nuniform vec4 uBakeUvRect;\nvoid main() { ${UV_POSITION} }`,
  fragmentShader: "precision highp float;\nlayout(location = 0) out highp vec4 coverage;\nvoid main() { coverage = vec4(1.0); }",
  side: THREE.DoubleSide, depthTest: false, depthWrite: false,
});

type CompileParameters = Parameters<THREE.Material["onBeforeCompile"]>[0];
interface Section { materialIndex: number; ranges: [number, number][] }
type NormalSource = "recovered" | "projected" | "flat";

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

function visibleInTree(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    if (!o.visible) return false;
    if (o === root) return true;
  }
  return true;
}

function sectionsOf(mesh: THREE.Mesh): Section[] {
  const geometry = mesh.geometry;
  const total = geometry.index ? geometry.index.count : geometry.getAttribute("position").count;
  if (!Array.isArray(mesh.material)) return [{ materialIndex: 0, ranges: [[0, total]] }];
  const sections = new Map<number, [number, number][]>();
  for (const group of geometry.groups) {
    const index = group.materialIndex ?? 0;
    sections.set(index, [...(sections.get(index) ?? []), [group.start, Math.min(group.count, total - group.start)]]);
  }
  return [...sections].map(([materialIndex, ranges]) => ({ materialIndex, ranges }));
}

// The section's whole triangles (3 vertex indices each, range by range) and every vertex's UV0, for uvTiles.
// exportGeometry numbers a split section's triangles the same way.
function sectionLayout(geometry: THREE.BufferGeometry, ranges: [number, number][]) {
  const uv = geometry.getAttribute("uv"), index = geometry.index;
  const indices = new Uint32Array(ranges.reduce((n, [, count]) => n + count - count % 3, 0));
  let k = 0;
  for (const [start, count] of ranges) for (let i = start; i < start + count - count % 3; i++) indices[k++] = index ? index.getX(i) : i;
  const uvs = new Float32Array(uv.count * 2);
  for (let v = 0; v < uv.count; v++) { uvs[v * 2] = uv.getX(v); uvs[v * 2 + 1] = uv.getY(v); }
  return { indices, uvs };
}

// The bake program: the material's own compile chain, then UV-space positions, a forced front face (a UV-space
// triangle's winding says nothing about the surface) and four outputs in place of the lit colour.
function injectBake(shader: CompileParameters, normal: NormalSource, reconstructed: boolean) {
  shader.uniforms.uBakeUvRect = BAKE_RECT;
  if (!/\}\s*$/.test(shader.vertexShader)) throw new Error("Export bake: vertex shader has no closing brace");
  shader.vertexShader = "uniform vec4 uBakeUvRect;\n" + shader.vertexShader.replace(/\}\s*$/, `\t${UV_POSITION}\n}\n`);
  const begin = "#include <normal_fragment_begin>", opaque = "#include <opaque_fragment>";
  let fragment = shader.fragmentShader;
  if (!fragment.includes(begin) || !fragment.includes(opaque)) throw new Error("Export bake: three shader chunk changed");
  fragment = fragment.replace(begin, THREE.ShaderChunk.normal_fragment_begin).replaceAll("gl_FrontFacing", "true");
  const tangentNormal = normal === "flat" ? "vec3 bakeTangentNormal = vec3(0.0, 0.0, 1.0);"
    : normal === "recovered" ? "vec3 bakeTangentNormal = normalize(recovered.normal);" : `
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
  mat3 bakeFrame = tbn;
#elif defined( USE_TANGENT )
  mat3 bakeFrame = mat3(vTangent, vBitangent, vNormal);
#else
  mat3 bakeFrame = mat3(0.0);
#endif
  vec3 bakeTangentNormal = vec3(0.0, 0.0, 1.0);
  if (dot(bakeFrame[2], bakeFrame[2]) > 0.0) bakeTangentNormal = normalize(vec3(dot(normal, normalize(bakeFrame[0])),
    dot(normal, normalize(bakeFrame[1])), dot(normal, normalize(bakeFrame[2]))));`;
  fragment = fragment.replace(opaque, `
  float bakeAo = 1.0;
  ${reconstructed ? "bakeAo = recovered.ao;" : "\n#ifdef USE_AOMAP\n  bakeAo = ambientOcclusion;\n#endif\n"}
  ${tangentNormal}
  gl_FragColor = vec4(diffuseColor.rgb, 1.0);
  bakeNormal = vec4(bakeTangentNormal * 0.5 + 0.5, 1.0);
  bakeSurface = vec4(bakeAo, roughnessFactor, metalnessFactor, diffuseColor.a);
  bakeEmissive = vec4(totalEmissiveRadiance, 1.0);
`);
  shader.fragmentShader = "layout(location = 1) out highp vec4 bakeNormal;\nlayout(location = 2) out highp vec4 bakeSurface;\n"
    + "layout(location = 3) out highp vec4 bakeEmissive;\n" + fragment;
}

// Patch the live material for one synchronous render and restore it before any preview frame can draw. Three keeps
// the preview program cached under the original key, and every uniform the compile chain captures is rebuilt from the
// same closures, so restoring the fields restores the preview exactly.
function withBakePatch<T>(material: THREE.MeshStandardMaterial, normal: NormalSource, run: () => T): T {
  const saved = {
    side: material.side, transparent: material.transparent, alphaHash: material.alphaHash, alphaTest: material.alphaTest,
    alphaToCoverage: material.alphaToCoverage, depthTest: material.depthTest, depthWrite: material.depthWrite,
    blending: material.blending, onBeforeCompile: material.onBeforeCompile, customProgramCacheKey: material.customProgramCacheKey,
  };
  const reconstructed = material.userData.reconstructed === true;
  material.onBeforeCompile = (shader, renderer) => {
    saved.onBeforeCompile.call(material, shader, renderer);
    injectBake(shader, normal, reconstructed);
  };
  material.customProgramCacheKey = () => `${saved.customProgramCacheKey.call(material)}:${BAKE_KEY}:${normal}`;
  Object.assign(material, { side: THREE.DoubleSide, transparent: false, alphaHash: false, alphaTest: 0, alphaToCoverage: false,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  material.needsUpdate = true;
  try {
    return run();
  } finally {
    Object.assign(material, saved);
    material.needsUpdate = true;
  }
}

function proxyFor(source: THREE.Mesh, material: THREE.Material | THREE.Material[], skinned: boolean): THREE.Mesh {
  let proxy: THREE.Mesh;
  if (skinned && (source as THREE.SkinnedMesh).isSkinnedMesh) {
    const skin = source as THREE.SkinnedMesh, mesh = new THREE.SkinnedMesh(source.geometry, material);
    mesh.bind(skin.skeleton, skin.bindMatrix);
    mesh.bindMode = skin.bindMode;
    proxy = mesh;
  } else proxy = new THREE.Mesh(source.geometry, material);
  if (source.morphTargetInfluences) proxy.morphTargetInfluences = source.morphTargetInfluences.slice();
  proxy.matrixAutoUpdate = false;
  proxy.matrix.copy(source.matrixWorld);
  proxy.frustumCulled = false;
  return proxy;
}

class BakeTargets {
  readonly surface: THREE.WebGLRenderTarget;
  readonly coverage: THREE.WebGLRenderTarget;
  constructor(readonly size: number) {
    this.surface = new THREE.WebGLRenderTarget(size, size, { count: 4, type: THREE.FloatType, depthBuffer: false });
    this.coverage = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false });
  }
  dispose() { this.surface.dispose(); this.coverage.dispose(); }
}

function render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, object: THREE.Object3D, camera: THREE.Camera) {
  const scene = new THREE.Scene();
  scene.add(object);
  const previous = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear };
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget(previous.target);
    renderer.setClearColor(previous.color, previous.alpha);
    renderer.autoClear = previous.autoClear;
    scene.remove(object);
  }
}

function imageTexture(size: number, srgb: boolean, mime: "image/png" | "image/jpeg", fill: (data: Uint8ClampedArray) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const image = new ImageData(size, size);
  fill(image.data);
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  // Readback row 0 is v = 0, which is also glTF's first image row: no flip on either side.
  texture.flipY = false;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.userData.mimeType = mime;
  return texture;
}

// One baked image set: the section drawn into the UV rectangle `rect` (uv * scale + offset), so only the triangles
// that land inside it are written.
function bakeTile(renderer: THREE.WebGLRenderer, camera: THREE.Camera, targets: BakeTargets, mesh: THREE.Mesh,
  live: THREE.MeshStandardMaterial, section: Section, rect: { offset: [number, number]; scale: [number, number] },
  name: string): THREE.MeshStandardMaterial {
  const { size } = targets, count = size * size;
  BAKE_RECT.value.set(rect.offset[0], rect.offset[1], rect.scale[0], rect.scale[1]);
  const only = (material: THREE.Material) => Array.isArray(mesh.material)
    ? mesh.material.map((_, i) => i === section.materialIndex ? material : HIDDEN) : material;
  const hair = live.userData.surfaceKind === "hair";
  const normal: NormalSource = hair ? "flat"
    : live.userData.reconstructed === true && live.userData.normalSpace !== "world" ? "recovered" : "projected";
  withBakePatch(live, normal, () => render(renderer, targets.surface, proxyFor(mesh, only(live), true), camera));
  render(renderer, targets.coverage, proxyFor(mesh, only(COVERAGE), false), camera);

  const [base, tangentNormal, surface, emissive] = [0, 1, 2, 3].map(i => {
    const pixels = new Float32Array(count * 4);
    renderer.readRenderTargetPixels(targets.surface, 0, 0, size, size, pixels, undefined, i);
    return pixels;
  });
  const coverage = new Uint8Array(count * 4);
  renderer.readRenderTargetPixels(targets.coverage, 0, 0, size, size, coverage);

  const written = new Uint8Array(count), covered = new Uint8Array(count);
  let coveredCount = 0, cut = 0, partial = 0, maxEmissive = 0;
  for (let i = 0; i < count; i++) {
    written[i] = base[i * 4 + 3] > 0.5 ? 1 : 0;
    covered[i] = coverage[i * 4] > 127 ? 1 : 0;
    if (!covered[i]) continue;
    coveredCount++;
    const alpha = surface[i * 4 + 3];
    if (!written[i] || alpha < 0.5) cut++;
    else if (alpha < 0.98) partial++;
    if (written[i]) maxEmissive = Math.max(maxEmissive, emissive[i * 4], emissive[i * 4 + 1], emissive[i * 4 + 2]);
  }
  const padded = written.slice();
  dilate([base, tangentNormal, surface, emissive], padded, size, size, PADDING_PASSES);
  for (let i = 0; i < count; i++) if (!padded[i]) tangentNormal.set([0.5, 0.5, 1, 1], i * 4);

  // Glass blends; cut-outs (body hidden under clothes, lashes, masked prints) clip; soft coverage blends unless it is
  // hair, whose cards read better clipped in engines without hashed alpha.
  // (w122) a thin-translucent section exports like glass: its source opacity alpha-blended (glTF has no dual-source
  // transmittance; the export loop records that in its warnings).
  const glass = !!live.userData.glassOpacityPolicy || !!live.userData.thinTranslucentPolicy;
  const alphaMode = glass || (!hair && partial > 0.25 * coveredCount) ? "BLEND"
    : hair || cut > 0.001 * coveredCount ? "MASK" : "OPAQUE";
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const map = imageTexture(size, true, alphaMode === "OPAQUE" ? "image/jpeg" : "image/png", data => {
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) data[i * 4 + c] = byte(linearToSrgb(base[i * 4 + c]));
      data[i * 4 + 3] = alphaMode === "OPAQUE" ? 255 : covered[i] && !written[i] ? 0 : byte(surface[i * 4 + 3]);
    }
  });
  const normalMap = imageTexture(size, false, "image/jpeg", data => {
    for (let i = 0; i < count; i++) { for (let c = 0; c < 3; c++) data[i * 4 + c] = byte(tangentNormal[i * 4 + c]); data[i * 4 + 3] = 255; }
  });
  // glTF packing: occlusion in R, roughness in G, metalness in B.
  const orm = imageTexture(size, false, "image/jpeg", data => {
    for (let i = 0; i < count; i++) { for (let c = 0; c < 3; c++) data[i * 4 + c] = byte(surface[i * 4 + c]); data[i * 4 + 3] = 255; }
  });
  // Emissive is HDR; the image holds the normalised colour and emissiveIntensity (KHR_materials_emissive_strength) the peak.
  const emissiveMap = maxEmissive > 1 / 255 ? imageTexture(size, true, "image/jpeg", data => {
    for (let i = 0; i < count; i++) { for (let c = 0; c < 3; c++) data[i * 4 + c] = byte(linearToSrgb(emissive[i * 4 + c] / maxEmissive)); data[i * 4 + 3] = 255; }
  }) : null;
  const textures = [map, normalMap, orm, ...(emissiveMap ? [emissiveMap] : [])];
  for (const texture of textures) { texture.repeat.set(rect.scale[0], rect.scale[1]); texture.offset.set(rect.offset[0], rect.offset[1]); }
  return new THREE.MeshStandardMaterial({
    name,
    map, normalMap, roughnessMap: orm, metalnessMap: orm, aoMap: orm, roughness: 1, metalness: 1, side: live.side,
    ...(emissiveMap ? { emissive: 0xffffff, emissiveMap, emissiveIntensity: maxEmissive } : {}),
    transparent: alphaMode === "BLEND", depthWrite: alphaMode !== "BLEND", alphaTest: alphaMode === "MASK" ? (hair ? 0.3 : 0.5) : 0,
  });
}

// A baked section: one material per UV tile image, and which image each triangle uses (null: one image).
interface BakedSection { materials: THREE.MeshStandardMaterial[]; tileOf: Uint16Array | null }
// A split section in the exported geometry: its triangles' image ordinals and the material slot of each ordinal.
interface SectionSplit { tileOf: Uint16Array; slots: number[] }

// Keep a finished bake image as an encoded PNG behind an <img> instead of a live 2048² canvas: a garment can now
// bake five image sets, and holding them all as canvases until the .glb is written could exhaust memory. The PNG is
// lossless; GLTFExporter draws the <img> and encodes the image's final format once, exactly as it did the canvas.
async function compactImage(texture: THREE.Texture): Promise<void> {
  const canvas = texture.image as HTMLCanvasElement;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("Export bake: could not encode an image")), "image/png"));
  const url = URL.createObjectURL(blob), image = new Image();
  image.src = url;
  try { await image.decode(); } catch (e) { URL.revokeObjectURL(url); throw e; }
  texture.image = image;
  texture.userData.objectUrl = url;
  canvas.width = canvas.height = 0; // release the backing store
}

function bakedTextures(material: THREE.MeshStandardMaterial): THREE.Texture[] {
  return [...new Set([material.map, material.normalMap, material.roughnessMap, material.emissiveMap])]
    .filter((t): t is THREE.Texture => !!t);
}

async function bakeSection(renderer: THREE.WebGLRenderer, camera: THREE.Camera, targets: BakeTargets, mesh: THREE.Mesh,
  live: THREE.MeshStandardMaterial, section: Section, warnings: string[], onTile: (message: string) => void): Promise<BakedSection> {
  const name = String(live.userData.sourceInstance ?? (live.name || mesh.name || "material"));
  const layout = sectionLayout(mesh.geometry, section.ranges);
  const { tiles, tileOf, note } = uvTiles(layout.indices, layout.uvs);
  if (note) warnings.push(`${mesh.name || "mesh"}[${section.materialIndex}]: ${note}`);
  const materials: THREE.MeshStandardMaterial[] = [];
  try {
    for (const [j, tile] of tiles.entries()) {
      if (tiles.length > 1) { onTile(`UV tile ${j + 1}/${tiles.length}`); await nextFrame(); }
      const material = bakeTile(renderer, camera, targets, mesh, live, section, tile,
        tiles.length > 1 ? `${name} (UV tile ${tile.tile[0]},${tile.tile[1]})` : name);
      materials.push(material);
      for (const texture of bakedTextures(material)) await compactImage(texture);
    }
  } catch (e) {
    disposeBaked({ materials, tileOf });
    throw e;
  }
  return { materials, tileOf };
}

function disposeBaked(section: BakedSection) {
  for (const material of section.materials) {
    for (const texture of bakedTextures(material)) {
      if (texture.userData.objectUrl) URL.revokeObjectURL(texture.userData.objectUrl);
      texture.dispose();
    }
    material.dispose();
  }
}

function exportGeometry(mesh: THREE.Mesh, hidden: Set<number> | undefined, baked: boolean, splits: Map<number, SectionSplit>) {
  const geometry = mesh.geometry.clone();
  const influences = mesh.morphTargetInfluences;
  if (influences?.some(w => w !== 0)) for (const name of ["position", "normal"] as const) {
    const base = geometry.getAttribute(name), targets = geometry.morphAttributes[name];
    if (!base || !targets) continue;
    const out = new Float32Array(base.count * 3);
    for (let v = 0; v < base.count; v++) {
      let x = base.getX(v), y = base.getY(v), z = base.getZ(v);
      targets.forEach((target, t) => {
        const w = influences[t];
        if (!w) return;
        const relative = geometry.morphTargetsRelative;
        x += w * (target.getX(v) - (relative ? 0 : base.getX(v)));
        y += w * (target.getY(v) - (relative ? 0 : base.getY(v)));
        z += w * (target.getZ(v) - (relative ? 0 : base.getZ(v)));
      });
      if (name === "normal") { const length = Math.hypot(x, y, z) || 1; x /= length; y /= length; z /= length; }
      out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  geometry.morphAttributes = {};
  // Renderer aliases of the second influence set (SourceMesh): glTF already carries it as joints_1/weights_1.
  for (const [alias, name] of [["skinIndex1", "joints_1"], ["skinWeight1", "weights_1"]] as const) {
    const attribute = geometry.getAttribute(alias);
    if (!attribute) continue;
    if (!geometry.hasAttribute(name)) geometry.setAttribute(name, name === "joints_1"
      ? new THREE.BufferAttribute(Uint16Array.from(attribute.array as ArrayLike<number>), 4) : attribute);
    geometry.deleteAttribute(alias);
  }
  // Vertex colours here are material masks (hair) or already folded into the baked base colour.
  if (baked && geometry.hasAttribute("color")) geometry.deleteAttribute("color");
  if (hidden?.size || splits.size) {
    // Rebuild the index section by section, as sectionsOf reads them: a multi-material mesh's groups, otherwise the
    // whole index as section 0. Hidden sections are dropped; a split section is regrouped into one run of triangles
    // per UV tile image (numbered as sectionLayout numbers them), each its own glTF primitive and material slot.
    const source = geometry.index, total = source ? source.count : geometry.getAttribute("position").count;
    const vertex = (k: number) => source ? source.getX(k) : k;
    const sections = Array.isArray(mesh.material)
      ? geometry.groups.map(g => ({ start: g.start, count: Math.min(g.count, total - g.start), materialIndex: g.materialIndex ?? 0 }))
      : [{ start: 0, count: total, materialIndex: 0 }];
    const index: number[] = [], groups: THREE.GeometryGroup[] = [], consumed = new Map<number, number>();
    for (const group of sections) {
      if (hidden?.has(group.materialIndex)) continue;
      const split = splits.get(group.materialIndex);
      if (!split) {
        groups.push({ start: index.length, count: group.count, materialIndex: group.materialIndex });
        for (let k = group.start; k < group.start + group.count; k++) index.push(vertex(k));
        continue;
      }
      const first = consumed.get(group.materialIndex) ?? 0, triangles = Math.floor(group.count / 3);
      consumed.set(group.materialIndex, first + triangles);
      split.slots.forEach((slot, ordinal) => {
        const start = index.length;
        for (let t = 0; t < triangles; t++) if (split.tileOf[first + t] === ordinal)
          for (let c = 0; c < 3; c++) index.push(vertex(group.start + t * 3 + c));
        if (index.length > start) groups.push({ start, count: index.length - start, materialIndex: slot });
      });
    }
    geometry.setIndex(index);
    geometry.clearGroups();
    for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  return geometry;
}

export async function exportOutfit(root: THREE.Object3D, renderer: THREE.WebGLRenderer, camera: THREE.Camera,
  options: OutfitExportOptions): Promise<OutfitExportResult> {
  if (!renderer.extensions.has("EXT_color_buffer_float"))
    throw new Error("This browser cannot render to float textures (EXT_color_buffer_float), which the bake needs");
  const warnings: string[] = [];
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh && visibleInTree(o, root)) meshes.push(o as THREE.Mesh); });
  const jobs = meshes.flatMap(mesh => sectionsOf(mesh).map(section => ({ mesh, section })));
  const baked = new Map<THREE.Mesh, Map<number, BakedSection>>();
  const hidden = new Map<THREE.Mesh, Set<number>>();
  // Additive unlit holograms (ReconstructedMaterial userData.recoveredAdditive): glTF has no additive blend mode, and
  // baking their light as an opaque or alpha-blended emissive panel would occlude what is behind it. They are left
  // out of the .glb with a warning; the source-file export still packages their textures.
  const additive = new Set<THREE.Mesh>();
  let keptSections = 0;
  const targets = new BakeTargets(options.textureSize);
  try {
    for (const [k, { mesh, section }] of jobs.entries()) {
      options.onProgress?.(`Baking textures ${k + 1}/${jobs.length}`);
      await nextFrame(); // let the progress paint; each bake itself is synchronous
      const live = Array.isArray(mesh.material) ? mesh.material[section.materialIndex] : mesh.material;
      if (!live || !live.visible) {
        hidden.set(mesh, new Set([...(hidden.get(mesh) ?? []), section.materialIndex]));
        continue;
      }
      if (live.userData.recoveredAdditive === true) {
        warnings.push(`${mesh.name || "mesh"}[${section.materialIndex}]: additive hologram left out (glTF has no additive blending)`);
        // The runtime refuses holograms on multi-section meshes, so the whole mesh is the hologram.
        const all = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (all.every(m => m.userData.recoveredAdditive === true)) additive.add(mesh);
        else hidden.set(mesh, new Set([...(hidden.get(mesh) ?? []), section.materialIndex]));
        continue;
      }
      if (!(live as THREE.MeshStandardMaterial).isMeshStandardMaterial || !mesh.geometry.hasAttribute("uv")) {
        keptSections++;
        warnings.push(`${mesh.name || "mesh"}[${section.materialIndex}]: ${live.type} exported without a bake`);
        continue;
      }
      if (live.userData.thinTranslucentPolicy)
        warnings.push(`${mesh.name || "mesh"}[${section.materialIndex}]: thin-translucent transmittance not exported (alpha blend with source opacity)`);
      const bakedSection = await bakeSection(renderer, camera, targets, mesh, live as THREE.MeshStandardMaterial, section,
        warnings, tile => options.onProgress?.(`Baking textures ${k + 1}/${jobs.length} (${tile})`));
      if (!baked.has(mesh)) baked.set(mesh, new Map());
      baked.get(mesh)!.set(section.materialIndex, bakedSection);
    }
  } catch (e) {
    for (const sections of baked.values()) for (const section of sections.values()) disposeBaked(section);
    throw e;
  } finally {
    targets.dispose();
  }

  options.onProgress?.("Writing .glb");
  await nextFrame();
  const copy = cloneHierarchy(root);
  const sources: THREE.Object3D[] = [], copies: THREE.Object3D[] = [];
  root.traverse(o => sources.push(o));
  copy.traverse(o => copies.push(o));
  if (sources.length !== copies.length) throw new Error("Export copy does not match the preview hierarchy");
  const geometries: THREE.BufferGeometry[] = [];
  sources.forEach((source, i) => {
    const mesh = source as THREE.Mesh, target = copies[i] as THREE.Mesh;
    if (!mesh.isMesh || !meshes.includes(mesh)) return;
    if (additive.has(mesh)) { target.visible = false; return; } // onlyVisible drops it
    const sectionMaterials = baked.get(mesh);
    // Each section's first tile image takes the section's own slot; further tiles are appended as new slots.
    const own = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const slots = own.map((m, index) => sectionMaterials?.get(index)?.materials[0] ?? m);
    const splits = new Map<number, SectionSplit>();
    for (const [index, section] of [...(sectionMaterials ?? [])].sort(([a], [b]) => a - b)) {
      if (!section.tileOf) continue;
      splits.set(index, { tileOf: section.tileOf, slots: [index, ...section.materials.slice(1).map(m => slots.push(m) - 1)] });
    }
    target.geometry = exportGeometry(mesh, hidden.get(mesh), !!sectionMaterials, splits);
    geometries.push(target.geometry);
    if (sectionMaterials) target.material = Array.isArray(mesh.material) || splits.size ? slots : slots[0];
    target.morphTargetInfluences = undefined;
    target.morphTargetDictionary = undefined;
  });
  if (options.pose === "bind") {
    // One rest pose for the shared skeleton: the body's (most bones). Every skin keeps its own inverse binds.
    let body: THREE.SkinnedMesh | undefined;
    copy.traverse(o => {
      const skin = o as THREE.SkinnedMesh;
      if (skin.isSkinnedMesh && (!body || skin.skeleton.bones.length > body.skeleton.bones.length)) body = skin;
    });
    body?.skeleton.pose();
  }
  copy.updateMatrixWorld(true);
  try {
    const glb = await new GLTFExporter().parseAsync(copy, { binary: true, onlyVisible: true }) as ArrayBuffer;
    // bakedSections counts baked materials: one per UV tile image (the panel reports "N baked materials").
    const bakedSections = [...baked.values()].reduce((n, m) => n + [...m.values()].reduce((s, b) => s + b.materials.length, 0), 0);
    return { glb, bakedSections, keptSections, warnings };
  } finally {
    for (const geometry of geometries) geometry.dispose();
    for (const sections of baked.values()) for (const section of sections.values()) disposeBaked(section);
  }
}
