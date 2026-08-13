// Body culling: does this mesh ship the body-hide mask the rig looks for?
//
// CharacterRig maps any equipped item to a `<name>.bodymask.png` sibling and discards the
// body texels it covers. 392 masks exist, covering 363 of 847 meshes — so the common case
// today is a garment with the whole body still rendering underneath it.
//
// Presence and non-emptiness only. Whether the mask covers the RIGHT texels needs the
// coverage bake that generates them, and belongs with that work.
import { resolve } from "node:path";
import sharp from "sharp";

// Slots that never occlude body skin, so a missing mask is correct rather than a gap.
const NO_BODY_CONTACT = new Set(["earrings", "eyewear", "facewear", "headwear", "hair", "emote"]);

export async function check(item, root) {
  const glb = item.model?.gltfPath;
  if (!glb) return { mark: "na", note: "no mesh" };
  if (NO_BODY_CONTACT.has(item.slot)) return { mark: "na", note: `slot '${item.slot}' does not occlude body skin` };

  const mask = resolve(root, "public", glb.replace(/\.glb$/, ".bodymask.png"));
  let stats;
  try {
    stats = await sharp(mask).stats();
  } catch {
    return { mark: "fail", note: "no bodymask — body renders through this garment" };
  }
  const covers = stats.channels.some((c) => c.max > 0);
  return covers
    ? { mark: "pass", note: "bodymask present and non-empty" }
    : { mark: "fail", note: "bodymask is entirely black — hides nothing" };
}
