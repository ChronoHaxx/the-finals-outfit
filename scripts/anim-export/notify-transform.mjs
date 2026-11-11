// The emote spawn notify's RelativeTransform in the app's frame (10 Nov 2026). Shared by build-props.mjs (new props
// builds) and add-notify-transforms.mjs (adding it to a props.json that was built without it).
//
// The game: AnimNotifyState_DiscoverySpawnProp spawns a prop actor, attaches it to a socket, and its RelativeTransform
// (rotation, offset, scale) places the actor relative to that socket. The THE FINALS football is authored ~1.1 m and
// scaled 0.16 by its notify; office chairs and mirrors are turned 90 degrees. It was dropped until 10 Nov 2026, so those
// showed 6x too big or on their side.
//
// The conversion is the per-axis mirror every vertex and bone transform goes through (convert-clips.mjs,
// build-props.mjs): UE is left-handed Z-up in cm, the app right-handed with Y mirrored in m. A transform X becomes
// M X M with M = diag(1, -1, 1), which conjugates the factors separately: translation (x, -y, z) / 100, rotation
// (-x, y, -z, w), scale unchanged (a diagonal matrix commutes with M, so a non-uniform scale stays a plain scale).
// The app sets the result on each spawned copy, under its socket. It composes with the actor's own components, which
// the GLB bakes as child nodes (a root component's template scale included: whether the game multiplies a root scale
// or replaces it is unverified; this matches UE's default spawn scaling and the GLBs as built before).

/** RelativeTransform JSON ({Rotation:{X,Y,Z,W}, Translation:{X,Y,Z}, Scale3D:{X,Y,Z}}, any part missing) -> the app's
 *  { translation?, rotation?, scale? }, identity parts left out; undefined when the whole transform is the identity. */
export function notifyTransform(rt) {
  if (!rt) return undefined;
  const out = {};
  const t = rt.Translation ? [rt.Translation.X ?? 0, rt.Translation.Y ?? 0, rt.Translation.Z ?? 0] : [0, 0, 0];
  if (t.some(v => Math.abs(v) > 1e-4)) out.translation = [t[0] / 100, -t[1] / 100, t[2] / 100].map(v => +v.toFixed(6));
  const q = rt.Rotation ? [rt.Rotation.X ?? 0, rt.Rotation.Y ?? 0, rt.Rotation.Z ?? 0, rt.Rotation.W ?? 1] : null;
  const n = q ? Math.hypot(...q) : 0;
  if (q && n > 1e-6 && Math.abs(Math.abs(q[3] / n) - 1) > 1e-6) // a zero-length quaternion reads as the identity
    out.rotation = [-q[0] / n, q[1] / n, -q[2] / n, q[3] / n].map(v => +v.toFixed(7));
  const s = rt.Scale3D ? [rt.Scale3D.X ?? 1, rt.Scale3D.Y ?? 1, rt.Scale3D.Z ?? 1] : [1, 1, 1];
  if (s.some(v => Math.abs(v - 1) > 1e-6)) out.scale = s.map(v => +v.toFixed(6));
  return Object.keys(out).length ? out : undefined;
}
