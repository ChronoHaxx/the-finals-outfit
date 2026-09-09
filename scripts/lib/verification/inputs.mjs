// Which files each aspect depends on, and the identity its verdict is stored under.
//
// Most catalog items are colourways of a shared mesh (2,531 items over 847 meshes). Keying
// mesh-scoped aspects by the mesh means one verdict covers every colourway automatically —
// no dedupe logic, no "is this a variant of that" bookkeeping.
import { resolve } from "node:path";
import { hashFiles, hashValues } from "./hash.mjs";
import { materialMapPaths } from "./material-inputs.mjs";

export const ASPECTS = Object.freeze(["transform", "geometry", "uv", "bindings", "bodyCulling"]);

// Bump when a check's LOGIC changes, so improving a check re-runs it instead of silently
// inheriting verdicts made by the old one.
export const CHECK_VERSION = Object.freeze({
  transform: 4, geometry: 2, uv: 1, bindings: 3, bodyCulling: 2,
});

const MESH_SCOPED = new Set(["transform", "geometry", "uv", "bodyCulling"]);

export function aspectKey(item, aspect) {
  const mesh = item.model?.gltfPath ?? "";
  if (!MESH_SCOPED.has(aspect)) {
    // Two skins may share their shell albedo but have different glass/LED slots.
    // Keep the item identity stable when a secondary binding is added or repaired.
    if (item.model?.materialBindings) return { scope: "skin", key: `${mesh}|${item.id}` };
    const set = item.model?.material?.bakedSet;
    // Skin identity is the baked set when there is one, else the item itself.
    return { scope: "skin", key: set ? `${mesh}|${set.albedo}` : `${mesh}|${item.id}` };
  }
  // Transform depends on the slot it is equipped into (a mesh socketed to the ear behaves
  // differently from the same mesh on the wrist), so the slot joins the key. Body culling
  // does too: the CHECK branches on item.slot (the runtime's mask policy is per-slot), so
  // keying on the mesh alone would let the first catalogue occurrence decide for all of
  // them — and reordering the catalogue would change the answer.
  const slotSensitive = aspect === "transform" || aspect === "bodyCulling";
  return { scope: "mesh", key: slotSensitive ? `${mesh}|${item.slot}` : mesh };
}

// Absolute paths of the files an aspect depends on. `root` is the repo root.
function inputPaths(item, aspect, root) {
  const pub = (rel) => resolve(root, "public", rel);
  const mesh = item.model?.gltfPath ? [pub(item.model.gltfPath)] : [];
  switch (aspect) {
    case "geometry":
    case "uv":
      return mesh;
    case "transform":
      // The rig's routing heuristic, per-slot bones and ancestor-scale handling all live
      // in CharacterRig.ts — any edit to it can invalidate transform verdicts, so the rig
      // joins the input set. This over-approximates (any rig edit expires every transform
      // mark); that is the correct trade — a mark that fails to expire is a silent wrong
      // answer, one that expires too eagerly costs a re-run.
      return [...mesh, resolve(root, "src", "rig", "CharacterRig.ts")];
    case "bodyCulling":
      // The body mesh is NOT an input: the check never reads it, so hashing it only
      // expires marks on unrelated body edits. The slot-policy module IS — the check's
      // allowlist comes from it, so a policy change must expire every mark.
      return [
        ...mesh,
        resolve(root, "src", "lib", "body-mask-slots.json"),
        ...(item.model?.gltfPath ? [pub(item.model.gltfPath.replace(/\.glb$/, ".bodymask.png"))] : []),
      ];
    case "bindings":
      return [...(item.model?.materialBindings ? mesh : []), ...materialMapPaths(item).map(pub)];
    default:
      throw new Error(`unknown aspect '${aspect}'`);
  }
}

export async function inputHash(item, aspect, root) {
  const files = await hashFiles(inputPaths(item, aspect, root));
  // Paths/bytes alone miss a slot being reassigned, or a TwoSided/opacity change.
  if (aspect === "bindings") {
    const bindings = item.model?.materialBindings ?? item.model?.material ?? null;
    return hashValues([files, CHECK_VERSION[aspect], aspect, bindings]);
  }
  return hashValues([files, CHECK_VERSION[aspect], aspect]);
}
