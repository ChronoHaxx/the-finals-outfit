// Bindings: do the maps this item claims actually exist, and does the albedo carry data?
// This is the measurable half of "material" — "the albedo is the 1x1 white fallback" is a
// fact, not an opinion. Covers the census's `material-flat` and `emissive-missing` classes.
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { effectiveMaterials, materialMapPaths } from "../material-inputs.mjs";

// An albedo with almost no tonal variation is the neutral fallback, not a garment.
const MIN_STDDEV = 2;

export async function check(item, root) {
  const materials = effectiveMaterials(item);
  const rel = materialMapPaths(item);
  const missing = [];
  for (const r of rel) {
    try {
      await access(resolve(root, "public", r));
    } catch {
      missing.push(r);
    }
  }
  if (missing.length) return { mark: "fail", note: `missing: ${missing.join(", ")}` };

  // Existence is not readability: a zero-byte or corrupt map passes access() but will
  // never decode at runtime, so every referenced map must actually open.
  for (const r of rel) {
    try {
      await sharp(resolve(root, "public", r)).metadata();
    } catch {
      return { mark: "fail", note: `unreadable: ${r}` };
    }
  }

  if (item.model?.materialBindings) {
    try {
      const bytes = await readFile(resolve(root, "public", item.model.gltfPath));
      if (bytes.toString("utf8", 0, 4) !== "glTF") throw new Error("not a GLB");
      const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
      const used = new Set((gltf.meshes ?? []).flatMap((mesh) => (mesh.primitives ?? []).map((primitive) => primitive.material)));
      const names = new Set((gltf.materials ?? []).flatMap((material, index) => used.has(index) ? [material.name] : []));
      const declared = Object.keys(item.model.materialBindings);
      const absent = declared.filter((name) => !names.has(name));
      const unbound = [...names].filter((name) => !Object.hasOwn(item.model.materialBindings, name));
      if (absent.length || unbound.length) return { mark: "fail", note:
        `material slot mismatch: absent from GLB [${absent.join(", ")}]; unbound [${unbound.join(", ")}]` };
    } catch (error) {
      return { mark: "fail", note: `material slots unreadable: ${error.message}` };
    }
  }
  if (!rel.length) return { mark: "na", note: "no external material maps — plain path" };

  for (const material of materials) {
    const set = material.bakedSet;
    if (!set) continue;
    try {
      const stats = await sharp(resolve(root, "public", set.albedo)).stats();
      const flat = stats.channels.every((c) => c.stdev < MIN_STDDEV);
      if (flat) {
        // Solid plastic/metal can legitimately be near-uniform; require an eye check.
        return { mark: "needs-human", note: "albedo is uniform — possible flat material, needs human review" };
      }
    } catch (e) {
      return { mark: "fail", note: `albedo unreadable: ${e.message}` };
    }
  }
  return { mark: "pass", note: `${rel.length} maps resolved` };
}
