// Transform: is this mesh authored where the rig expects for its slot?
//
// Statics for socketed slots (earrings, eyewear, facewear, headwear, wrist) are authored at
// the ORIGIN and re-parented onto a bone at runtime. Body-authored statics already sit at
// their part. Getting this wrong renders a 0.35m helmet 2m tall, or puts glasses behind the
// face — both observed. The check is that the mesh sits in the half the rig assumes.
//
// Revised per spec: bounds are world-space via worldBounds(), because statics carry a
// compensating dequant scale on wrapper nodes that plain accessor bounds would miss.
import { worldBounds } from "./bounds.mjs";

const SOCKETED = new Set(["earrings", "eyewear", "facewear", "headwear", "wrist"]);
// Origin-authored means the mesh centre sits near y=0 rather than up at head height.
const ORIGIN_BAND_M = 0.35;
// A watch that lost its wrapper scale rendered 2.5m (CharacterRig).
const MAX_ACCESSORY_M = 0.5;

export async function check(absGlbPath, slot) {
  if (!SOCKETED.has(slot)) return { mark: "na", note: `slot '${slot}' is body-authored` };
  let b;
  try { b = await worldBounds(absGlbPath); } catch (e) { return { mark: "fail", note: `unreadable: ${e.message}` }; }
  if (!b) return { mark: "fail", note: "no scene" };
  if (!Number.isFinite(b.centreY)) return { mark: "fail", note: "non-finite bounds" };

  const biggest = Math.max(...b.extent);
  if (biggest > MAX_ACCESSORY_M) {
    return { mark: "fail", note: `accessory is ${biggest.toFixed(2)}m across — wrapper scale lost?` };
  }
  return Math.abs(b.centreY) <= ORIGIN_BAND_M
    ? { mark: "pass", note: `origin-authored, ${biggest.toFixed(3)}m across` }
    : { mark: "fail", note: `socketed but centre y=${b.centreY.toFixed(2)}m — not origin-authored` };
}
