// Transform: is this mesh where the rig expects for its slot?
//
// CharacterRig routes per mesh, not per slot: `Math.abs(cy) < 0.4 ? staticBone(slot) : null`,
// and its own comment calls that "only a routing heuristic, not proof that the exported mesh
// has the game's socket offset." Both authoring conventions render correctly, so centreY
// cannot distinguish a defect from a convention — the diagnostic signals are scale (a lost
// wrapper scale balloons statics to metres) and placement off the body entirely. The
// convention is recorded in the note because the rig routes on it.
//
// Bounds are world-space via worldBounds(): statics carry a compensating dequant scale on
// wrapper nodes that plain accessor bounds would miss.
import { worldBounds } from "./bounds.mjs";

const SOCKETED = new Set(["earrings", "eyewear", "facewear", "headwear", "wrist"]);
const MAX_ACCESSORY_M = 0.5;   // a watch that lost its wrapper scale rendered 2.5m
const PLAUSIBLE_Y = [-0.5, 2.5]; // anywhere on or near a 2m body, either convention

export async function check(absGlbPath, slot) {
  if (!SOCKETED.has(slot)) return { mark: "na", note: `slot '${slot}' is body-authored` };
  let b;
  try { b = await worldBounds(absGlbPath); } catch (e) { return { mark: "fail", note: `unreadable: ${e.message}` }; }
  if (!b || !Number.isFinite(b.centreY)) return { mark: "fail", note: "non-finite bounds" };

  const biggest = Math.max(...b.extent);
  if (biggest > MAX_ACCESSORY_M) {
    return { mark: "fail", note: `accessory is ${biggest.toFixed(2)}m across — wrapper scale lost?` };
  }
  if (b.centreY < PLAUSIBLE_Y[0] || b.centreY > PLAUSIBLE_Y[1]) {
    return { mark: "fail", note: `centre y=${b.centreY.toFixed(2)}m is off-body` };
  }
  // Both conventions are valid; record which one, because the rig routes on it.
  const convention = Math.abs(b.centreY) < 0.4 ? "origin-authored" : "body-authored";
  return { mark: "pass", note: `${convention}, ${biggest.toFixed(3)}m across, centre y=${b.centreY.toFixed(2)}m` };
}
