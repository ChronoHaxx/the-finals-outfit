// Body culling: does this mesh ship the body-hide mask the rig looks for?
//
// CharacterRig maps any equipped item to a `<name>.bodymask.png` sibling and discards the
// body texels it covers. 392 masks exist, covering 363 of 847 meshes — so the common case
// today is a garment with the whole body still rendering underneath it.
//
// Which slots ever get a mask registered is the RUNTIME's policy, not ours: it is
// `BODYMASK_SLOTS` in CharacterRig (five garment slots) plus `face`, handled separately.
// The shared module src/lib/body-mask-slots.json is the single source of truth — both the
// runtime and this check import it, so the two can never disagree. Anything outside it
// never gets a mask registered, so demanding one is meaningless.
//
// Presence and non-emptiness only. Whether the mask covers the RIGHT texels needs the
// coverage bake that generates them, and belongs with that work.
import { resolve } from "node:path";
import sharp from "sharp";
import BODY_MASK_SLOTS from "../../../../src/lib/body-mask-slots.json" with { type: "json" };

const MASK_SLOTS = new Set(BODY_MASK_SLOTS);

export async function check(item, root) {
  const glb = item.model?.gltfPath;
  if (!glb) return { mark: "na", note: "no mesh" };
  if (!MASK_SLOTS.has(item.slot)) return { mark: "na", note: `slot '${item.slot}' never registers a body mask` };

  const mask = resolve(root, "public", glb.replace(/\.glb$/, ".bodymask.png"));
  let pixels;
  try {
    // Drop the alpha channel EXPLICITLY (removeAlpha), then scan the raw colour bytes.
    // Slicing by index would keep alpha for a two-channel gray+alpha PNG — channels
    // [gray, alpha] — and pass an empty mask on its alpha (max [0, 255]).
    pixels = await sharp(mask).removeAlpha().raw().toBuffer();
  } catch {
    return { mark: "fail", note: "no bodymask — body renders through this garment" };
  }
  const covers = pixels.some((v) => v > 0);
  return covers
    ? { mark: "pass", note: "bodymask present and non-empty" }
    : { mark: "fail", note: "mask is empty — hides nothing" };
}
