// Which files each aspect depends on, and the identity its verdict is stored under.
//
// Most catalog items are colourways of a shared mesh (2,531 items over 847 meshes). Keying
// mesh-scoped aspects by the mesh means one verdict covers every colourway automatically —
// no dedupe logic, no "is this a variant of that" bookkeeping.
import { resolve } from "node:path";
import { hashFiles, hashValues } from "./hash.mjs";

export const ASPECTS = Object.freeze(["transform", "geometry", "uv", "bindings", "bodyCulling"]);

// Bump when a check's LOGIC changes, so improving a check re-runs it instead of silently
// inheriting verdicts made by the old one.
export const CHECK_VERSION = Object.freeze({
  transform: 3, geometry: 1, uv: 1, bindings: 1, bodyCulling: 1,
});

const MESH_SCOPED = new Set(["transform", "geometry", "uv", "bodyCulling"]);

export function aspectKey(item, aspect) {
  const mesh = item.model?.gltfPath ?? "";
  if (!MESH_SCOPED.has(aspect)) {
    const set = item.model?.material?.bakedSet;
    // Skin identity is the baked set when there is one, else the item itself.
    return { scope: "skin", key: set ? `${mesh}|${set.albedo}` : `${mesh}|${item.id}` };
  }
  // Transform depends on the slot it is equipped into (a mesh socketed to the ear behaves
  // differently from the same mesh on the wrist), so the slot joins the key.
  return { scope: "mesh", key: aspect === "transform" ? `${mesh}|${item.slot}` : mesh };
}

// Absolute paths of the files an aspect depends on. `root` is the repo root.
function inputPaths(item, aspect, root) {
  const pub = (rel) => resolve(root, "public", rel);
  const mesh = item.model?.gltfPath ? [pub(item.model.gltfPath)] : [];
  const set = item.model?.material?.bakedSet;
  switch (aspect) {
    case "geometry":
    case "uv":
    case "transform":
      return mesh;
    case "bodyCulling":
      return [
        ...mesh,
        pub("models/body/SK_Body_M.glb"),
        ...(item.model?.gltfPath ? [pub(item.model.gltfPath.replace(/\.glb$/, ".bodymask.png"))] : []),
      ];
    case "bindings":
      return [
        ...(set ? [pub(set.albedo), pub(set.normal), pub(set.orm)] : []),
        ...(set?.cutout ? [pub(set.cutout)] : []),
        ...(item.model?.material?.emissiveMap ? [pub(item.model.material.emissiveMap)] : []),
      ];
    default:
      throw new Error(`unknown aspect '${aspect}'`);
  }
}

export async function inputHash(item, aspect, root) {
  const files = await hashFiles(inputPaths(item, aspect, root));
  return hashValues([files, CHECK_VERSION[aspect], aspect]);
}
