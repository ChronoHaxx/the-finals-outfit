// The single source of truth for "which asset files does this app need".
//
// This exists because it was got wrong once, expensively. The staging script and the
// catalog validator each enumerated the schema fields they knew about — imageUrl,
// gltfPath, regionMapPath, decal layers — and both missed bakedSet, emissiveMap,
// bodySkin.texPath and underLayerUrl. Staging published 4,549 of the 10,794 files the
// rig actually requests, and the validator agreed everything was fine, because it was
// asking the same wrong question. A check that shares its blind spot with the thing it
// checks is not a check.
//
// So: no field list. Walk the catalog and take every string that looks like an asset
// path. A new material field added to the schema is picked up automatically; the only
// way to reintroduce the old failure is to reference an asset from source code without
// adding it to HARDCODED below.

// Paths the app requests from code rather than from the catalog. Grep for modelUrl(" /
// assetUrl(" in src/ when touching this.
export const HARDCODED = [
  "models/body/SK_Body_M.glb",
  "models/decals/_shared/nailmask.webp",
  "models/decals/_shared/bodyhide-face.webp",
  "models/reconstructed-coverage-legacy-singlet-v1/streetwear-tight-singlet.bodymask.png",
];

const ASSET_PATH = /^(models|items|textures)\/[\w./-]+\.(webp|png|jpg|jpeg|glb|gltf|ktx2|bin)$/i;

/** Every asset path the app can request, deep-walked from the catalog plus HARDCODED. */
export function collectAssetRefs(items) {
  const refs = new Set(HARDCODED);

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    for (const value of Object.values(node)) {
      if (typeof value === "string") {
        const clean = value.replace(/^\/+/, "");
        if (ASSET_PATH.test(clean)) refs.add(clean);
      } else {
        walk(value);
      }
    }
  };

  for (const item of items) {
    walk(item);
    // imageUrl is the one field that may legitimately be an absolute remote URL, which
    // the pattern above rejects; anything base-relative is caught by the walk.
  }

  return refs;
}
