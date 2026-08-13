// Import the 239 existing census verdicts as a starting position for the human aspects.
//
// Only FAILURES are imported. A `good` verdict is not imported as a pass, because those
// judgements were made against assets that have since been re-baked — importing them as
// passes would manufacture exactly the stale green checkmarks this system exists to stop.
// A failure is safe to import: the worst case is re-checking something already fixed.
import { aspectKey, inputHash } from "./inputs.mjs";
import { setMark } from "./store.mjs";

const CATEGORY_TO_ASPECT = {
  "color-wrong": "colour",
  "color-too-light": "colour",
  "material-flat": "surface",
  "metal-grey": "surface",
  "emissive-missing": "effects",
};

export async function seedFromCensus(items, store, root, verdicts) {
  const byId = new Map(items.map((i) => [i.id, i]));
  let written = 0;
  for (const [id, v] of Object.entries(verdicts)) {
    const item = byId.get(id);
    if (!item?.model?.gltfPath) continue;

    if (v.category === "framing") {
      const { key } = aspectKey(item, "colour");
      setMark(store, key, "colour", {
        mark: "notCheckable", by: "human", at: v.at?.slice(0, 10) ?? "2026-07-05",
        inputs: await inputHash(item, "bindings", root),
        note: v.issue ?? "icon cannot be framed by the body camera",
      });
      written++;
      continue;
    }

    const aspect = CATEGORY_TO_ASPECT[v.category];
    if (!aspect) continue; // `good`, and the mesh-level categories the machine checks own

    const { key } = aspectKey(item, aspect);
    setMark(store, key, aspect, {
      mark: "fail", by: "human", at: v.at?.slice(0, 10) ?? "2026-07-05",
      inputs: await inputHash(item, "bindings", root),
      note: v.issue ?? `census: ${v.category}`,
    });
    written++;
  }
  return written;
}
