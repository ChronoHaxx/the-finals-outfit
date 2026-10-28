import * as THREE from "three";
import { strToU8 } from "three/examples/jsm/libs/fflate.module.js";
import { fetchAsset } from "../lib/asset-fetch";
import { meshBytes } from "../lib/mesh-bytes";
import { modelUrl } from "../lib/assets";
import { getItemById } from "../lib/catalog";
import { encodePng } from "../lib/png-encode";
import { packagePath, SAFE } from "../lib/package-path";
import { fetchRecoveredTexture } from "./ReconstructedMaterial";
import type { SamplerTextureSpec } from "./ReconstructedSamplers";

// Developer export, optional part: the source files behind the current outfit, laid out like an FModel export
// (<Game>/Content/<package path>). Everything comes from what the site already hosts for the preview: the converted
// source meshes, the authored textures (decoded mip 0), the decoded item definitions and the decal images.

type TextureSpec = SamplerTextureSpec & { source?: string; sourceFormat?: string };
interface Manifest { itemId: string; sourceInstance?: string; textures: TextureSpec[] }
export interface SourceExport { files: Record<string, Uint8Array>; notes: string[] }
/** An equipped item and the objects it added to the rig (its scene, under-layer and bone-parented statics). */
export interface ItemObjects { id: string; objects: THREE.Object3D[] }

// The body records only its hosted URL; this is its game object path (reconstructed-assemblies-v1/assets.json).
const SOURCE_BODY = "/Game/Discovery/Characters/Body/SK_Body_M.SK_Body_M";

const README = `THE FINALS outfit export - source files
=======================================

outfit.glb        The baked, ready-to-use outfit (Blender: File > Import > glTF 2.0; Unity: glTFast; Unreal 5: glTF import).
source/           The files behind it, laid out like an FModel export (Discovery/Content/<package path>):

  SK_* / SM_*.glb   Game skeletal/static meshes as converted for the site: geometry, UVs, skin weights and the original
                    material slot names, in glTF (one of FModel's mesh formats) rather than .psk/.uemodel.
  T_* / TA_*.png    Textures decoded from the game's compressed mip 0 at full resolution, exact RGBA. Half-float sources
                    become 16-bit PNGs clamped to 0-1, so their HDR range above 1 is lost. Texture arrays are written
                    one PNG per slice (_0, _1, ...), cubemaps per face.
                    BC5 normal maps carry X/Y in red/green; rebuild Z (blue) in your shader.
  MI_*.json         Each material instance's texture bindings (slot, source texture, format, sRGB, wrap) as used by the
                    site's recovered shader. Scalar/vector parameter values are compiled into that shader and are not
                    included.
  DA_*.json         The item definitions' decoded properties (visual parts, material overrides, slots, tags).
  Decals/<item>/    Images of 2D cosmetics (tattoos, paints, makeup) as prepared for the site, not raw game textures.

Fan-made export. THE FINALS and its assets belong to Embark Studios; keep it to personal use.
`;

function visible(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    if (!o.visible) return false;
    if (o === root) return true;
  }
  return true;
}

// Meshes are exported as the extraction's own GLB, even where the host published them gzipped.
async function bytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(/\.glb$/i.test(new URL(url, window.location.href).pathname)
    ? await meshBytes(url) : await (await fetchAsset(url)).arrayBuffer());
}

function texturePngs(spec: TextureSpec, data: ArrayBuffer, half: boolean): Uint8Array[] {
  const { width, height, offset } = spec.mips[0], texels = width * height, step = texels * (half ? 8 : 4);
  const layers = spec.cube ? 6 : spec.depth;
  return Array.from({ length: layers }, (_, layer) => {
    if (!half) return encodePng(width, height, new Uint8Array(data, offset + layer * step, texels * 4));
    const source = new Uint16Array(data, offset + layer * step, texels * 4), out = new Uint16Array(texels * 4);
    for (let i = 0; i < out.length; i++)
      out[i] = Math.round(Math.min(1, Math.max(0, THREE.DataUtils.fromHalfFloat(source[i]))) * 65535);
    return encodePng(width, height, out);
  });
}

export async function collectSourceFiles(root: THREE.Object3D, items: ItemObjects[],
  onProgress?: (message: string) => void): Promise<SourceExport> {
  const files: Record<string, Uint8Array> = {}, notes: string[] = [];
  const add = (path: string, data: Uint8Array) => { files[`source/${path}`] = data; };
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh && visible(o, root)) meshes.push(o as THREE.Mesh); });
  // Which item each mesh belongs to, so an item that contributes no mesh or texture can be reported.
  const owner = new Map<THREE.Object3D, string>(), covered = new Set<string>();
  for (const item of items) for (const object of item.objects) object.traverse(o => owner.set(o, item.id));

  // Meshes.
  const meshUrls = new Map<string, string>();
  for (const mesh of meshes) {
    const url = mesh.userData.sourceMeshUrl ?? mesh.userData.sourceBodyUrl;
    if (typeof url !== "string") continue;
    const objectPath = mesh.userData.sourceMesh ?? (mesh.userData.sourceBody ? SOURCE_BODY : undefined);
    const path = typeof objectPath === "string" ? packagePath(objectPath) : null;
    meshUrls.set(url, `${path ?? `Meshes/${url.split("/").pop()!.replace(/\.glb$/, "")}`}.glb`);
    if (owner.has(mesh)) covered.add(owner.get(mesh)!);
  }
  for (const [url, path] of meshUrls) {
    onProgress?.(`Packing source meshes`);
    try { add(path, await bytes(url)); } catch (error) { notes.push(`mesh ${path}: ${String(error)}`); }
  }

  // Materials and their authored textures.
  const materials = new Map<string, string>(); // manifest URL -> material instance object path
  for (const mesh of meshes) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    if (material.visible && typeof material.userData.recoveredManifest === "string") {
      materials.set(material.userData.recoveredManifest, String(material.userData.sourceMaterial ?? ""));
      if (owner.has(mesh)) covered.add(owner.get(mesh)!);
    }
  // Encoded once per texture; written under every source path that names it (shared textures have several).
  const encoded = new Map<string, Uint8Array[] | null>(), written = new Map<string, string[]>();
  let done = 0;
  for (const [manifestUrl, instance] of materials) {
    onProgress?.(`Packing source textures ${++done}/${materials.size}`);
    const manifest: Manifest = await (await fetchAsset(manifestUrl)).json();
    const bindings = [];
    for (const spec of manifest.textures) {
      const base = (spec.source && packagePath(spec.source)) || `Textures/${spec.id}`;
      let paths = written.get(`${spec.sha256}:${base}`);
      if (!paths) {
        if (!encoded.has(spec.sha256)) {
          try {
            const { data, half } = await fetchRecoveredTexture(spec, manifestUrl);
            encoded.set(spec.sha256, texturePngs(spec, data, half));
          } catch (error) {
            notes.push(`texture ${base}: ${String(error)}`);
            encoded.set(spec.sha256, null);
          }
        }
        const pngs = encoded.get(spec.sha256) ?? [];
        const suffix = (i: number) => pngs.length === 1 ? "" : spec.cube ? `_face${i}` : `_${i}`;
        paths = pngs.map((png, i) => { const path = `${base}${suffix(i)}.png`; add(path, png); return path; });
        written.set(`${spec.sha256}:${base}`, paths);
      }
      bindings.push({ slot: spec.slot, source: spec.source, sourceFormat: spec.sourceFormat, srgb: spec.srgb,
        wrap: [spec.wrapS, spec.wrapT], array: spec.array, cube: !!spec.cube, layers: spec.cube ? 6 : spec.depth,
        size: [spec.mips[0].width, spec.mips[0].height], files: paths.map(p => `source/${p}`) });
    }
    const path = (instance && packagePath(instance)) || `Materials/${manifest.sourceInstance ?? manifest.itemId}`;
    add(`${path}.json`, strToU8(JSON.stringify({ materialInstance: instance || manifest.sourceInstance,
      note: "Texture bindings of the recovered material; parameter values are compiled into its shader.", textures: bindings }, null, 2)));
  }

  // Item definitions and 2D cosmetic images.
  const missing: string[] = [];
  for (const { id } of items) {
    const layers = getItemById(id)?.decal?.layers ?? [];
    if (!covered.has(id) && !layers.length) missing.push(id);
    try {
      const definition = await (await fetchAsset(modelUrl(`models/reconstructed-assembly-v2/items/${id}.json`))).json();
      const path = typeof definition.source === "string" ? definition.source.replace(/\.uasset$/, "") : `Definitions/${id}`;
      if (SAFE.test(path) && !path.includes(".."))
        add(`${path}.json`, strToU8(JSON.stringify({ Name: path.split("/").pop(), Source: definition.source,
          SourceSha256: definition.sourceSha256, Properties: definition.properties }, null, 2)));
    } catch (error) { notes.push(`definition ${id}: ${String(error)}`); }
    for (const layer of layers) for (const file of [layer.colorPath, layer.maskPath, layer.surfacePath]) {
      if (!file) continue;
      try { add(`Decals/${id}/${file.split("/").pop()}`, await bytes(modelUrl(file))); }
      catch (error) { notes.push(`decal ${file}: ${String(error)}`); }
    }
  }
  for (const id of missing) notes.push(`${id}: no source mesh or textures in this preview; only its definition is included`);
  files["README.txt"] = strToU8(README + (missing.length ? `
Not included: these items are not on the recovered source path in this preview (not reconstructed yet, or the
page was opened with ?reconstructed=0), so source/ holds only their definitions. outfit.glb has them as the preview draws them.
${missing.map(id => `  ${id}\n`).join("")}` : ""));
  return { files, notes };
}
