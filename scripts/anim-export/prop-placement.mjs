// Where the game puts an emote prop, beyond its socket and spawn notify (11 Nov 2026). Shared by build-props.mjs and
// its tests. Two placement sources the prop pipeline ignored until now:
//
// 1. The prop's AnimBlueprint can end in a ModifyBone node (AnimGraphNode_ModifyBone, FAnimNode_ModifyBone). 25 of the
//    33 prop AnimBlueprints use one, always on their skeleton's root bone, always "Replace" in component space with a
//    constant: translation (0,0,0), and a rotation (mostly (0,0,0); the sensu fan rolls 90, the bear plushie (90,0,90),
//    the fencing foil yaws -30; the laptops leave rotation alone). For the root bone, component space IS its local
//    space (it has no parent bone), so the node simply throws away the sequence's keyed root and puts this constant in
//    its place. The prop then sits where its socket puts it: the emote clip's prop_01 / weapon_root carries it. The
//    animation packages key the root in character space instead (the statue at (0,20,120), the notepad on the path
//    prop_01 takes), which we used to bake, so those props hung from the character's origin or sat twice as far out.
//
// 2. A spawn notify with a CurveDrivenTransformPrefix (10 notifies in 5 emotes; none has a socket) is moved every frame
//    by the emote's own float curves <Prefix>_TranslateX/Y/Z (cm), _RotateX/Y/Z (degrees) and _ScaleX/Y/Z, in the
//    character's component space. The curve transform acts as a moving socket: the notify's RelativeTransform goes on
//    top of it (MonsterMan's two poles only land symmetric, and Rocking Chair's mirrored gun only lands opposite the
//    first, in that order). The rotation is a UE FRotator with Roll = RotateX, Pitch = RotateY, Yaw = RotateZ: of 49
//    readings it is the one that keeps PilotCheckList's pen rigid against the head (0.01 degrees) while it is tucked
//    behind the ear. Curve names vary in case (Prop01 / prop01); FNames are case-insensitive.
//
// Both convert to the app's frame with the per-axis mirror every transform goes through (notify-transform.mjs):
// translation (x, -y, z) / 100, rotation (-x, y, -z, w), scale unchanged.

/** UE FRotator::Quaternion (degrees) -> [x, y, z, w], in UE's frame. */
export function rotatorQuat({ Pitch = 0, Yaw = 0, Roll = 0 } = {}) {
  const h = Math.PI / 360;
  const [sp, cp, sy, cy, sr, cr] = [Math.sin(Pitch * h), Math.cos(Pitch * h), Math.sin(Yaw * h), Math.cos(Yaw * h), Math.sin(Roll * h), Math.cos(Roll * h)];
  return [cr * sp * sy - sr * cp * cy, -cr * sp * cy - sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy];
}
export const toAppTranslation = ([x, y, z]) => [x / 100, -y / 100, z / 100];
export const toAppQuat = q => { const n = Math.hypot(...q) || 1; return [-q[0] / n, q[1] / n, -q[2] / n, q[3] / n]; };

const enumTail = v => typeof v === "string" ? v.replace(/^.*::/, "") : v;

/** The ModifyBone nodes of an AnimBlueprint (its CUE4Parse JSON exports), as authored in the class default object.
 *  `bound`: the node has property copies feeding it (a pin bound to a variable), so the stored values may not be the
 *  ones the game uses. */
export function modifyBoneNodes(exports) {
  const cdo = exports.find(e => /RF_ClassDefaultObject/.test(e.Flags ?? ""));
  if (!cdo) return [];
  const sparse = cdo.SerializedSparseClassData ?? {};
  return Object.entries(cdo.Properties ?? {}).filter(([key]) => /^AnimGraphNode_ModifyBone(_\d+)?$/.test(key)).map(([key, n]) => ({
    node: key, bone: n.BoneToModify?.BoneName ?? null,
    translation: { mode: enumTail(n.TranslationMode), space: enumTail(n.TranslationSpace), value: [n.Translation?.X ?? 0, n.Translation?.Y ?? 0, n.Translation?.Z ?? 0] },
    rotation: { mode: enumTail(n.RotationMode), space: enumTail(n.RotationSpace), value: { Pitch: n.Rotation?.Pitch ?? 0, Yaw: n.Rotation?.Yaw ?? 0, Roll: n.Rotation?.Roll ?? 0 } },
    scale: { mode: enumTail(n.ScaleMode), space: enumTail(n.ScaleSpace), value: [n.Scale?.X ?? 1, n.Scale?.Y ?? 1, n.Scale?.Z ?? 1] },
    alpha: n.Alpha ?? 1, alphaInput: enumTail(n.AlphaInputType), alphaCurve: n.AlphaCurveName ?? "None",
    bound: (sparse[key]?.CopyRecords?.length ?? 0) > 0 || !!sparse[key]?.Function,
  }));
}

// For the root bone, its parent's space and component space are the same frame; any other space is not handled.
const ROOT_SPACES = new Set(["BCS_ComponentSpace", "BCS_ParentBoneSpace"]);

/** What an AnimBlueprint's ModifyBone nodes do to the skeleton root, in the app's frame:
 *  { bone, translation?, rotation?, notes } (a part is present when it is replaced), or null when nothing applies.
 *  Only what was verified is applied: one node, on the root bone, full constant alpha, no bound pins, Replace (or
 *  Ignore) in component space, scale ignored. Anything else is listed in `notes` and NOT applied. */
export function rootOverride(nodes, rootBone) {
  if (!nodes.length) return null;
  const notes = [];
  const lower = rootBone?.toLowerCase();
  const onRoot = nodes.filter(n => n.bone?.toLowerCase() === lower);
  for (const n of nodes.filter(n => !onRoot.includes(n))) notes.push(`${n.node} modifies ${n.bone}, not the root ${rootBone}: not applied`);
  if (onRoot.length !== 1) {
    if (onRoot.length > 1) notes.push(`${onRoot.length} ModifyBone nodes on the root: not applied`);
    return notes.length ? { bone: rootBone, notes } : null;
  }
  const n = onRoot[0];
  const refuse = reason => ({ bone: rootBone, notes: [...notes, `${n.node} on ${rootBone}: ${reason}; not applied`] });
  if (n.bound) return refuse("its values are bound to a variable");
  if (n.alphaInput !== "Float" || Math.abs(n.alpha - 1) > 1e-6 || (n.alphaCurve && n.alphaCurve !== "None")) return refuse(`alpha ${n.alpha} (${n.alphaInput}, curve ${n.alphaCurve})`);
  if (n.scale.mode !== "BMM_Ignore") return refuse(`scale mode ${n.scale.mode}`);
  const out = { bone: rootBone, notes };
  for (const part of ["translation", "rotation"]) {
    const p = n[part];
    if (p.mode === "BMM_Ignore") continue;
    if (p.mode !== "BMM_Replace") return refuse(`${part} mode ${p.mode}`);
    if (!ROOT_SPACES.has(p.space)) return refuse(`${part} space ${p.space}`);
    out[part] = part === "translation" ? toAppTranslation(p.value).map(v => +v.toFixed(6)) : toAppQuat(rotatorQuat(p.value)).map(v => +v.toFixed(7));
  }
  return out.translation || out.rotation ? out : (notes.length ? { bone: rootBone, notes } : null);
}

// --- Curve-driven transform -------------------------------------------------------------------------------------------
const PARTS = ["TranslateX", "TranslateY", "TranslateZ", "RotateX", "RotateY", "RotateZ", "ScaleX", "ScaleY", "ScaleZ"];

/** Greedy key reduction: keep a frame only where linear interpolation between the kept neighbours misses it. */
export function reduceKeys(count, error) {
  const keys = [0];
  let start = 0;
  for (let end = 2; end < count; end++) {
    let ok = true;
    for (let k = start + 1; k < end && ok; k++) ok = error(start, end, k);
    if (!ok) { keys.push(end - 1); start = end - 1; }
  }
  if (count > 1) keys.push(count - 1);
  return keys;
}
const slerp = (a, b, t) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1; d *= s;
  if (d > 0.9995) { const q = a.map((v, i) => v + (s * b[i] - v) * t), n = Math.hypot(...q); return q.map(v => v / n); }
  const th = Math.acos(d), sa = Math.sin((1 - t) * th) / Math.sin(th), sb = Math.sin(t * th) / Math.sin(th);
  return a.map((v, i) => v * sa + s * b[i] * sb);
};
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));

/** The per-frame transform a CurveDrivenTransformPrefix window gets from the emote's curves (an AnimExport record's
 *  `curveValues`, one value per frame), in the app's frame and key-reduced (0.1 mm, 0.1 degree, 1e-4 scale):
 *  { frameTime, frames, translation: [keys, xyz...], rotation: [keys, xyzw...], scale?: [keys, xyz...] }.
 *  null when the emote has none of the prefix's curves. */
export function curveTransform(curveValues, prefix, frameTime) {
  const byName = new Map(Object.entries(curveValues ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const series = Object.fromEntries(PARTS.map(p => [p, byName.get(`${prefix}_${p}`.toLowerCase()) ?? null]));
  const present = Object.values(series).filter(Boolean);
  if (!present.length) return null;
  const frames = present[0].length;
  if (present.some(v => v.length !== frames)) throw new Error(`Curves of ${prefix} differ in length`);
  const at = (p, f, fallback) => series[p]?.[f] ?? fallback;
  const t = [], r = [], s = [];
  for (let f = 0; f < frames; f++) {
    t.push(toAppTranslation([at("TranslateX", f, 0), at("TranslateY", f, 0), at("TranslateZ", f, 0)]));
    let q = toAppQuat(rotatorQuat({ Roll: at("RotateX", f, 0), Pitch: at("RotateY", f, 0), Yaw: at("RotateZ", f, 0) }));
    const prev = r[f - 1];
    if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) q = q.map(v => -v); // one hemisphere
    r.push(q);
    s.push([at("ScaleX", f, 1), at("ScaleY", f, 1), at("ScaleZ", f, 1)]);
  }
  const lerpErr = (arr, tol) => (a, b, k) => { const u = (k - a) / (b - a); return arr[k].every((v, i) => Math.abs(arr[a][i] + (arr[b][i] - arr[a][i]) * u - v) <= tol); };
  const pack = (arr, keys, digits) => [keys, keys.flatMap(k => arr[k].map(v => +v.toFixed(digits)))];
  const out = {
    frameTime, frames,
    translation: pack(t, reduceKeys(frames, lerpErr(t, 1e-4)), 5),
    rotation: pack(r, reduceKeys(frames, (a, b, k) => angle(slerp(r[a], r[b], (k - a) / (b - a)), r[k]) <= 0.1 * Math.PI / 180), 6),
  };
  if (s.some(v => v.some(x => Math.abs(x - 1) > 1e-4))) out.scale = pack(s, reduceKeys(frames, lerpErr(s, 1e-4)), 5);
  return out;
}
