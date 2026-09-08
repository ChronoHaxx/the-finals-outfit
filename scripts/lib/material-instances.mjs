// Resolve authored UE material instances, including master defaults and base-property
// overrides. A missing parent is unknown; it must never become a guessed single-sided
// material. Cooked masters retain parameter defaults even when their graph is stripped.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();
const objectName = (ref) => /'([^']+)'/.exec(ref?.ObjectName ?? "")?.[1] ?? "";
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const textureName = (name) => ({ TextureArray_C: "TextureArray_Colors", TextureArray_N: "TextureArray_Normals", TextureArray_M: "TextureArray_Masks" })[name] ?? name;

export function materialObjectFile(objectPath, dumpRoot) {
  if (typeof objectPath !== "string" || !/^\/Game\//i.test(objectPath)) return null;
  const content = resolve(dumpRoot, "..", "..");
  const relative = objectPath.replace(/^\/Game\//i, "").replace(/\.[^./]+$/, "");
  const file = resolve(content, relative + ".json");
  return existsSync(file) ? file : null;
}

function readObjects(file) {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [data];
  } catch { return []; }
}

function masterDefaults(obj) {
  const result = { scalars: {}, vectors: {}, textures: {} };
  const e = obj.CachedExpressionData ?? {};
  for (const [entry, values, target] of [
    ["RuntimeEntries", "ScalarValues", "scalars"],
    ["RuntimeEntries[1]", "VectorValues", "vectors"],
    ["RuntimeEntries[3]", "TextureValues", "textures"],
  ]) {
    (e[entry]?.ParameterInfoSet ?? []).forEach((param, i) => {
      const name = param.Key?.Name;
      const value = e[values]?.[i];
      if (!name || value == null) return;
      result[target][name] = target === "textures" ? value.AssetPathName : value;
    });
  }
  return result;
}

export function resolveMaterialInstance(file, dumpRoot, ancestors = new Set()) {
  if (!file) return null;
  const key = resolve(file);
  if (ancestors.has(key)) return null;
  if (cache.has(key)) return cache.get(key);
  const obj = readObjects(file).find((o) => /^(?:Material|MaterialInstanceConstant)$/.test(o.Type));
  if (!obj) return null;
  const props = obj.Properties ?? {};
  const master = obj.Type === "Material";
  const next = new Set(ancestors).add(key);
  const parentFile = materialObjectFile(props.Parent?.ObjectPath, dumpRoot);
  const parent = master ? null : resolveMaterialInstance(parentFile, dumpRoot, next);
  const defaults = master ? masterDefaults(obj) : { scalars: {}, vectors: {}, textures: {} };
  const scalars = { ...(parent?.scalars ?? {}), ...defaults.scalars };
  const vectors = { ...(parent?.vectors ?? {}), ...defaults.vectors };
  const textures = { ...(parent?.textures ?? {}), ...Object.fromEntries(Object.entries(defaults.textures).map(([name, value]) => [textureName(name), value])) };
  for (const e of props.ScalarParameterValues ?? []) {
    if (typeof e.ParameterValue === "number") scalars[e.ParameterInfo.Name] = e.ParameterValue;
  }
  for (const e of props.VectorParameterValues ?? []) {
    if (e.ParameterValue) vectors[e.ParameterInfo.Name] = e.ParameterValue;
  }
  for (const e of props.TextureParameterValues ?? []) {
    // Explicit null means clear the inherited binding, not fall through to the parent.
    textures[textureName(e.ParameterInfo.Name)] = e.ParameterValue?.ObjectPath ?? null;
  }
  const overrides = props.BasePropertyOverrides ?? {};
  let doubleSided = master ? props.TwoSided === true : parent?.doubleSided;
  if (!master && overrides.bOverride_TwoSided === true) doubleSided = overrides.TwoSided === true;
  const names = [obj.Name, ...(parent?.chain ?? [])];
  const masterName = master ? obj.Name : parent?.masterName;
  const family = /LEDScreen/i.test(masterName ?? "") ? "led"
    : /Glass/i.test(masterName ?? "") ? "glass"
    : /Layered|\dLayers/i.test(masterName ?? "") || [...Object.keys(scalars), ...Object.keys(vectors)].some((name) => /^[1-8]_(?:BaseColorOverlay|BaseMetallicity|DetailNormalTiling)$/.test(name)) ? "layered"
    : /CharacterAttachment/i.test(masterName ?? "") || (textures.CR && (textures.NOM || textures.NOH)) ? "attachment"
    : "unknown";
  const layerMatch = names.map((n) => /Layered_(\d+)/i.exec(n) ?? /(\d+)\s*Layers/i.exec(n)).find(Boolean);
  const result = {
    name: obj.Name, file: key, parentName: props.Parent?.ObjectName ?? "", masterName,
    chain: names, complete: master || parent?.complete === true,
    family, doubleSided, nLayers: layerMatch ? Math.max(1, Math.min(8, +layerMatch[1])) : 8,
    scalars, textures,
    // Keep the lowercase linear-vector contract used by the existing layered baker.
    vectors: Object.fromEntries(Object.entries(vectors).map(([name, v]) => [name,
      { r: v.R ?? v.r, g: v.G ?? v.g, b: v.B ?? v.b, a: v.A ?? v.a ?? 1 }])),
  };
  cache.set(key, result);
  return result;
}

export function readMeshMaterialSlots(meshJson, dumpRoot) {
  const mesh = readObjects(meshJson).find((o) => o.Type === "SkeletalMesh" || o.Type === "StaticMesh");
  const slots = mesh?.SkeletalMaterials ?? mesh?.Properties?.StaticMaterials ?? mesh?.StaticMaterials ?? [];
  const parsed = slots.flatMap((slot) => {
    const ref = slot.Material ?? slot.MaterialInterface;
    const materialName = objectName(ref);
    if (!materialName) return [];
    const materialPath = materialObjectFile(ref.ObjectPath, dumpRoot);
    return [{ materialName, slotName: slot.MaterialSlotName ?? materialName, materialPath,
      mi: resolveMaterialInstance(materialPath, dumpRoot), resolution: "embedded" }];
  });
  // UE can reference one material in several sections. A binding is keyed by
  // material identity, so those sections must share one resolved skin assignment.
  return [...new Map(parsed.map((slot) => [slot.materialName, slot])).values()];
}

// The cooked customization DA omits its slot assignment fields. Match a skin only
// where its identity/ancestry or unique authored slot token disambiguates it; never
// spray the first MI over unassigned slots. The final one-to-one remainder is safe
// only after every other candidate and every other slot has been accounted for.
export function resolveSkinMaterialSlots(meshJson, skinDir, dumpRoot) {
  const slots = readMeshMaterialSlots(meshJson, dumpRoot);
  let candidates = [];
  try {
    candidates = readdirSync(skinDir).filter((n) => /^MI_.*\.json$/i.test(n)).sort()
      .map((n) => resolveMaterialInstance(join(skinDir, n), dumpRoot)).filter(Boolean);
  } catch { return slots; }
  const assigned = new Map();
  const used = new Set();
  const assignUnique = (predicate, resolution) => {
    for (const [i, slot] of slots.entries()) {
      if (assigned.has(i)) continue;
      const matches = candidates.filter((mi) => !used.has(mi) && predicate(slot, mi));
      if (matches.length !== 1) continue;
      const candidate = matches[0];
      // A candidate matching two source slots is ambiguous as well.
      if (slots.filter((other, j) => !assigned.has(j) && predicate(other, candidate)).length !== 1) continue;
      assigned.set(i, { ...slot, mi: candidate, resolution }); used.add(candidate);
    }
  };
  assignUnique((slot, mi) => mi.chain.some((name) => normalize(name) === normalize(slot.materialName)), "source-identity");
  assignUnique((slot, mi) => {
    const token = normalize(slot.slotName);
    const suffix = mi.name.split("_").at(-1);
    // Both `_Visor` and `_VisorDissun` encode the Visor slot. A camel-case
    // boundary is required; arbitrary substring matching is not sufficient.
    const suffixHead = suffix.replace(/([a-z0-9])([A-Z])/g, "$1_$2").split("_")[0];
    return token.length > 2 && (normalize(suffix) === token || normalize(suffixHead) === token);
  }, "slot-suffix");
  assignUnique((slot, mi) => {
    const slotToken = normalize(slot.slotName);
    const tokens = mi.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return slotToken.length > 2 && tokens.includes(slotToken);
  }, "slot-name");
  const remainingSlots = slots.map((slot, i) => ({ slot, i })).filter(({ i }) => !assigned.has(i));
  const remainingMIs = candidates.filter((mi) => !used.has(mi));
  if (remainingSlots.length === 1 && remainingMIs.length === 1) {
    const { slot, i } = remainingSlots[0];
    assigned.set(i, { ...slot, mi: remainingMIs[0], resolution: "unique-remainder" });
  }
  return slots.map((slot, i) => assigned.get(i) ?? { ...slot, resolution: used.size < candidates.length ? "unresolved-skin" : "embedded" });
}

let sources;
export function findSourceMeshForGlb(gltfPath, dumpRoot) {
  if (!sources) {
    const generated = join(SCRIPT_DIR, "asset-sources.generated.json");
    const file = existsSync(generated) ? generated : join(SCRIPT_DIR, "asset-sources.json");
    sources = JSON.parse(readFileSync(file, "utf8")).assets ?? [];
  }
  const dst = gltfPath.replace(/^models\//, "");
  const source = sources.find((s) => s.dst === dst);
  return source ? resolve(dumpRoot, source.src.replace(/\.uemodel$/i, ".json")) : null;
}

export function resolveMaterialBindings({ gltfPath, skinDir, dumpRoot }) {
  const source = findSourceMeshForGlb(gltfPath, dumpRoot);
  return source ? resolveSkinMaterialSlots(source, skinDir, dumpRoot) : [];
}
