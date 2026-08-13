// The queue is DERIVED, never maintained. "What should I work on" is a query, not a
// judgement call — which is what stops it rotting the way a hand-kept list does.
import { ASPECTS, aspectKey, inputHash } from "./inputs.mjs";
import { getMark } from "./store.mjs";

export async function deriveQueue(items, store, root, { aspects = ASPECTS } = {}) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item.model?.gltfPath) continue; // icon-only items have no mesh to check
    for (const aspect of aspects) {
      const { key, scope } = aspectKey(item, aspect);
      const dedupe = `${key}::${aspect}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const mark = getMark(store, key, aspect);
      let state = "absent";
      if (mark) {
        // inputs: null (seeded human marks) means the judgement was made against assets
        // with no declared inputs — it can never read as current, only stale.
        if (mark.inputs == null) {
          state = "stale";
        } else {
          const current = await inputHash(item, aspect, root);
          state = mark.inputs === current ? "current" : "stale";
        }
      }
      out.push({ itemId: item.id, key, aspect, state, scope });
    }
  }
  return out;
}
