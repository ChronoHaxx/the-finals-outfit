// Bindings: do the maps this item claims actually exist, and does the albedo carry data?
// This is the measurable half of "material" — "the albedo is the 1x1 white fallback" is a
// fact, not an opinion. Covers the census's `material-flat` and `emissive-missing` classes.
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

// An albedo with almost no tonal variation is the neutral fallback, not a garment.
const MIN_STDDEV = 2;

export async function check(item, root) {
  const set = item.model?.material?.bakedSet;
  if (!set) return { mark: "na", note: "no baked set — region-tint or plain path" };

  const rel = [set.albedo, set.normal, set.orm, set.cutout, item.model?.material?.emissiveMap].filter(Boolean);
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

  try {
    const stats = await sharp(resolve(root, "public", set.albedo)).stats();
    const flat = stats.channels.every((c) => c.stdev < MIN_STDDEV);
    if (flat) {
      // Not a failure: a solid plastic or metal surface can legitimately be near-uniform
      // (poker glasses, a wedding veil). Distinct mark so the report separates "broken"
      // from "possibly fine, needs a human eye".
      return { mark: "needs-human", note: "albedo is uniform — possible flat material, needs human review" };
    }
  } catch (e) {
    return { mark: "fail", note: `albedo unreadable: ${e.message}` };
  }
  return { mark: "pass", note: `${rel.length} maps resolved` };
}
