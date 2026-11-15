import * as THREE from "three";
import { FaceCage, nextWrapToken, type FaceWrapPart, type FaceWrapSkin } from "./FaceWrap";

// Facial animation (12 Nov 2026): the game's own face poses, driven by the clips' facial curves.
//
// How the game does it (scripts/anim-export/build-face.mjs has the asset trail): every body clip carries float curves
// named after face poses (Face_Blink, Face_LookLeft, Face_JawOpen, Face_Happy...). The head mesh runs its own
// post-process AnimBlueprint, which copies the body's pose and curves, then a PoseBlendNode turns each curve into the
// weight of the same-named pose in the head's additive PoseAsset. A pose is a set of small local-space deltas on the
// head's ~300 FACIAL_* bones (eyelids, eyes, jaw, lips, brows, cheeks). There are no expression morph targets: the
// face moves by bones alone. In the game this runs in a "FacialAnimation" layer that a distance LOD switches off away
// from the camera, which is why faces only animate up close; the viewer is always close, so it always runs here.
//
// The maths, exactly as UE 5.7 evaluates it (read from the engine source, not guessed):
//  * weight = clamp(curve, 0, 1)   AnimNode_PoseBlendNode remaps every curve with its Linear blend option, which
//                                  clamps. Negative look values (they mirror the opposite look) therefore do nothing.
//  * per bone, from identity, for each influencing pose in pose order:   UPoseAsset::GetAnimationPose, additive path
//      D = nlerp(identity, delta, w)    (the delta itself at full weight)
//      R = D * R,  T = T + w * delta.t  (BlendFromIdentityAndAccumulateAdditively_Custom; scale deltas are all zero)
//    No normalisation across poses: Blink at 1 plus EyesClosed at 1 rotate an eyelid by both.
//  * bone = R * rest rotation, rest position + T    (AccumulateAdditivePose, local space, weight 1)
//
// Conventions. The deltas are stored in UE's bone-local convention (cm, left-handed). The app's bones are not all in
// one convention: a legacy head GLB (and the body) mirror Y, S: t' = (x, -y, z) / 100, q' = (-x, y, -z, w); a source
// head (reconstructed-meshes-v2) swaps Y and Z, P: t' = (x, z, y) / 100, q' = (-x, -z, -y, w). Its FACIAL roots hang from
// the body's head/neck bones (S) with P axes of their own (SourceSkeleton.ts). An additive delta lives in the PARENT's
// frame (R = D * R), so each delta converts with its parent bone's convention. Both maps are linear in the quaternion's
// components and keep w, so converting once at bind time commutes with the nlerp above. Before driving a head, every
// driven bone's rest local is checked against the head's own UE reference local under that rule; a head that does not
// match is left still (with a warning) rather than distorted.
//
// Masks. An item can damp the face under it (helmets keep only the eyes, a balaclava halves the lips and jaw): its
// definition sets bMaskOutFacialAnimation and names a bone weights asset (FaceAnimationWeights), which the head
// AnimBlueprint gives the FacialAnimation layer as its dynamic bone weights. That layer blends per bone in local space,
// so a bone with weight w keeps nlerp(identity, R, w) of its rotation and w * T of its translation. Several masked
// items: each bone takes the smallest weight among them (the game holds one mask; which one wins is in Angelscript we
// cannot read, and the smallest never lets a lip through any of the masks worn). A bone a mask does not list takes its
// nearest listed FACIAL ancestor's weight, else 1.
//
// Lifecycle (RigAnimator.ts owns the calls): bind() records the worn head's bones and their rest locals, while they are
// at rest (before any apply); apply() runs after the clip and the deformation rig, every frame and in every hold;
// restore() puts the rest back when the animation stops. Nothing runs while no clip plays, so still renders and the
// automated captures are unchanged. Head-wrapped parts (beards, balaclavas) ride on the face's wrap cage: FaceWrap.ts.

export interface FaceIndex {
  formatVersion: 1;
  heads: Record<string, string>; // head mesh name (SK_Head_Face_01_Base) -> head file, relative to the index
  curves: string[]; // clip sources (AnimSequence names) with a curves file
  wraps?: Record<string, string>; // wrap cage source -> its skin file (FaceWrap.ts), relative to the index
  masks?: Record<string, string>; // bone weights asset (soft object path) -> its mask file, relative to the index
}
interface MaskFile {
  formatVersion: 1;
  name: string;
  source: string;
  /** FACIAL bone -> [rotation weight, translation weight]: how much of its facial motion survives. */
  bones: Record<string, [number, number]>;
}
interface PoseFile {
  formatVersion: 1;
  name: string;
  poses: string[];
  bones: string[];
  /** Per pose: [bone index, qx, qy, qz, qw, tx, ty, tz (, sx, sy, sz)] in UE's bone-local convention, cm. */
  deltas: number[][][];
}
interface HeadFile {
  formatVersion: 1;
  mesh: string;
  pose: string; // pose file, relative to the index
  /** Driven bone -> [parent, tx, ty, tz, qx, qy, qz, qw]: the head's UE reference local. */
  ref: Record<string, [string | null, number, number, number, number, number, number, number]>;
}
export interface FaceCurves {
  formatVersion: 1;
  source: string;
  frames: number;
  frameTime: number;
  /** Pose name -> [frame keys, values], linear between keys, already clamped to [0, 1]. */
  curves: Record<string, [number[], number[]]>;
}

/** One clip's contribution to the face this frame: its source, where it is, and its blend weight. */
export interface FaceSample { source: string | undefined; time: number; weight: number }

type Convention = "S" | "P";
/** UE bone-local -> app bone-local, for a frame whose axes follow the convention. */
export function convertTranslation(c: Convention, x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return c === "S" ? out.set(x / 100, -y / 100, z / 100) : out.set(x / 100, z / 100, y / 100);
}
export function convertRotation(c: Convention, x: number, y: number, z: number, w: number, out = new THREE.Quaternion()): THREE.Quaternion {
  return c === "S" ? out.set(-x, y, -z, w) : out.set(-x, -z, -y, w);
}
/** The axis change from S to P child axes (rest(P child under S parent) = rest(S) * this): S * P = Rx(+90 deg). */
const S_TO_P = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const conventionOf = (bone: THREE.Object3D | null | undefined): Convention => bone?.userData?.sourceBoneExtension ? "P" : "S";

/** A curve's value at a time (seconds): linear between its frame keys, held at both ends. */
export function sampleCurve([keys, values]: [number[], number[]], frame: number): number {
  if (frame <= keys[0]) return values[0];
  const last = keys.length - 1;
  if (frame >= keys[last]) return values[last];
  let lo = 0, hi = last; // binary search: the key segment holding the frame
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid] <= frame) lo = mid; else hi = mid; }
  return values[lo] + (values[hi] - values[lo]) * (frame - keys[lo]) / (keys[hi] - keys[lo]);
}

/** Pose weights from the clips in play: each curve blended by the clips' weights as three blends the bones (a total
 *  below 1 leaves the rest, a total above 1 is normalised: PropertyMixer), then clamped as the game's node does. */
export function poseWeights(samples: FaceSample[], curves: ReadonlyMap<string, FaceCurves>): Map<string, number> {
  const sums = new Map<string, number>();
  let total = 0;
  for (const { source, time, weight } of samples) {
    if (!(weight > 0)) continue;
    total += weight;
    const data = source ? curves.get(source) : undefined;
    if (!data) continue; // a clip without face curves (or not loaded yet) holds the face at rest for its share
    const frame = time / data.frameTime;
    for (const [name, curve] of Object.entries(data.curves)) sums.set(name, (sums.get(name) ?? 0) + weight * sampleCurve(curve, frame));
  }
  const scale = 1 / Math.max(1, total);
  for (const [name, value] of sums) sums.set(name, THREE.MathUtils.clamp(value * scale, 0, 1));
  return sums;
}

interface DrivenBone {
  bone: THREE.Bone;
  restPosition: THREE.Vector3;
  restQuaternion: THREE.Quaternion;
  restScale: THREE.Vector3;
}
/** A head's poses, converted to its bones' conventions: per pose, [driven bone index, qx, qy, qz, qw, tx, ty, tz]. */
interface BoundHead {
  key: string;
  bones: DrivenBone[];
  poses: { name: string; deltas: Float64Array }[];
}

const ROT_TOLERANCE = THREE.MathUtils.degToRad(0.5), POS_TOLERANCE = 0.0005; // rest check: 0.5 degrees, 0.5 mm
const ZERO_WEIGHT = 0.00001; // UE's ZERO_ANIMWEIGHT_THRESH

/** The worn head's identity: a source head names its mesh; a legacy head GLB's sections are named after it. */
export function headKey(meshes: readonly THREE.SkinnedMesh[]): string | null {
  const source = meshes.find(m => typeof m.userData.sourceMesh === "string")?.userData.sourceMesh as string | undefined;
  if (source) return source.split(/[./]/).filter(Boolean).at(-1) ?? null;
  const name = meshes[0]?.name.replace(/_LOD\d+(?:_\d+)?$/i, "");
  return name ? (/^SK_/i.test(name) ? name : `SK_${name}`) : null;
}

export type RestRecord = ReadonlyMap<THREE.Bone, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>;
/** Every FACIAL_* bone's local as it is now (call while the head is at rest). */
export function recordRest(meshes: readonly THREE.SkinnedMesh[]): RestRecord {
  const rest = new Map<THREE.Bone, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();
  for (const mesh of meshes) for (const bone of mesh.skeleton.bones)
    if (/^FACIAL_/i.test(bone.name) && !rest.has(bone))
      rest.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() });
  return rest;
}

/** Bind a head: its driven bones (by identity, across all its sections), checked against the head's reference, and its
 *  poses converted per bone. `rest` (recordRest) is the bones' rest; without it, their current locals. Throws when a
 *  driven bone does not sit where the reference says it should. */
export function bindHead(key: string, meshes: readonly THREE.SkinnedMesh[], head: HeadFile, poses: PoseFile,
  rest: RestRecord = recordRest(meshes)): BoundHead {
  const byName = new Map<string, THREE.Bone>();
  for (const mesh of meshes) for (const bone of mesh.skeleton.bones) {
    if (!/^FACIAL_/i.test(bone.name)) continue;
    const name = bone.name.toLowerCase(), seen = byName.get(name);
    if (seen && seen !== bone) throw new Error(`head ${key} has two ${bone.name} bones`);
    byName.set(name, bone);
  }
  const refs = new Map(Object.entries(head.ref).map(([name, ref]) => [name.toLowerCase(), ref]));
  const driven: DrivenBone[] = [], slots = new Map<number, { slot: number; parent: Convention }>();
  const expectedP = new THREE.Vector3(), expectedQ = new THREE.Quaternion();
  let worst = { degrees: 0, mm: 0, bone: "" };
  poses.bones.forEach((name, index) => {
    const bone = byName.get(name.toLowerCase()), ref = refs.get(name.toLowerCase());
    if (!bone || !ref) return; // a pose bone this head lacks (older rigs carry ~100 more): the game skips it too
    const parent = conventionOf(bone.parent), child = conventionOf(bone);
    if (parent === "P" && child === "S") throw new Error(`head ${key}: ${bone.name} mixes conventions`);
    if ((ref[0] ?? "").toLowerCase() !== (bone.parent?.name ?? "").toLowerCase())
      throw new Error(`head ${key}: ${bone.name} hangs under ${bone.parent?.name}, the reference under ${ref[0]}`);
    const at = rest.get(bone);
    if (!at) throw new Error(`head ${key}: no rest recorded for ${bone.name}`);
    convertTranslation(parent, ref[1], ref[2], ref[3], expectedP);
    convertRotation(parent, ref[4], ref[5], ref[6], ref[7], expectedQ).normalize();
    if (parent !== child) expectedQ.multiply(S_TO_P);
    const degrees = THREE.MathUtils.radToDeg(at.quaternion.angleTo(expectedQ)), mm = at.position.distanceTo(expectedP) * 1000;
    if (degrees + mm > worst.degrees + worst.mm) worst = { degrees, mm, bone: bone.name };
    slots.set(index, { slot: driven.length, parent });
    driven.push({ bone, restPosition: at.position.clone(), restQuaternion: at.quaternion.clone(), restScale: at.scale.clone() });
  });
  if (!driven.length) throw new Error(`head ${key} has none of its pose asset's bones`);
  if (THREE.MathUtils.degToRad(worst.degrees) > ROT_TOLERANCE || worst.mm / 1000 > POS_TOLERANCE)
    throw new Error(`head ${key}: ${worst.bone} rests ${worst.degrees.toFixed(2)} deg / ${worst.mm.toFixed(2)} mm from its reference`);
  const q = new THREE.Quaternion(), t = new THREE.Vector3();
  const converted = poses.poses.map((name, p) => {
    const rows = (poses.deltas[p] ?? []).filter(row => slots.has(row[0]));
    const deltas = new Float64Array(rows.length * 8);
    rows.forEach((row, i) => {
      const { slot, parent } = slots.get(row[0])!;
      convertRotation(parent, row[1], row[2], row[3], row[4], q).normalize();
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      convertTranslation(parent, row[5], row[6], row[7], t);
      deltas.set([slot, q.x, q.y, q.z, q.w, t.x, t.y, t.z], i * 8);
    });
    return { name, deltas };
  });
  return { key, bones: driven, poses: converted.filter(p => p.deltas.length) };
}

/** Per bound bone, the [rotation, translation] weight its facial motion keeps under these masks (null: none). */
export function maskWeights(head: BoundHead, masks: readonly MaskFile[]): Float32Array | null {
  if (!masks.length) return null;
  const lookups = masks.map(mask => new Map(Object.entries(mask.bones).map(([name, w]) => [name.toLowerCase(), w])));
  const out = new Float32Array(head.bones.length * 2);
  head.bones.forEach(({ bone }, i) => {
    let rot = 1, trans = 1;
    for (const lookup of lookups) {
      let w: [number, number] | undefined;
      for (let b: THREE.Object3D | null = bone; !w && b && /^FACIAL_/i.test(b.name); b = b.parent) w = lookup.get(b.name.toLowerCase());
      if (w) { rot = Math.min(rot, THREE.MathUtils.clamp(w[0], 0, 1)); trans = Math.min(trans, THREE.MathUtils.clamp(w[1], 0, 1)); }
    }
    out[i * 2] = rot; out[i * 2 + 1] = trans;
  });
  return out;
}

/** Pose the bound bones: UE's additive pose-asset evaluation (see the top of this file), each bone's result then
 *  weighted by the worn masks (maskWeights). Returns whether any pose had weight (with none, every bone is at rest). */
export function poseHead(head: BoundHead, weights: ReadonlyMap<string, number>,
  scratch = { r: new Float64Array(0), t: new Float64Array(0) }, mask: Float32Array | null = null): boolean {
  const n = head.bones.length;
  if (scratch.r.length !== n * 4) { scratch.r = new Float64Array(n * 4); scratch.t = new Float64Array(n * 3); }
  const { r, t } = scratch;
  for (let i = 0; i < n; i++) { r[i * 4] = r[i * 4 + 1] = r[i * 4 + 2] = 0; r[i * 4 + 3] = 1; t[i * 3] = t[i * 3 + 1] = t[i * 3 + 2] = 0; }
  let any = false;
  for (const { name, deltas } of head.poses) {
    const w = weights.get(name) ?? 0;
    if (w <= ZERO_WEIGHT) continue;
    any = true;
    const full = w >= 1 - ZERO_WEIGHT;
    for (let k = 0; k < deltas.length; k += 8) {
      const b = deltas[k];
      // D = nlerp(identity, delta, w): the delta is in w >= 0's hemisphere, so FQuat::FastLerp's bias is +1.
      let dx = deltas[k + 1], dy = deltas[k + 2], dz = deltas[k + 3], dw = deltas[k + 4];
      if (!full) {
        dx *= w; dy *= w; dz *= w; dw = dw * w + (1 - w);
        const len = Math.hypot(dx, dy, dz, dw);
        dx /= len; dy /= len; dz /= len; dw /= len;
      }
      // R = D * R (then normalised, as UE does after each pose)
      const o = b * 4, rx = r[o], ry = r[o + 1], rz = r[o + 2], rw = r[o + 3];
      let x = dw * rx + dx * rw + dy * rz - dz * ry;
      let y = dw * ry - dx * rz + dy * rw + dz * rx;
      let z = dw * rz + dx * ry - dy * rx + dz * rw;
      let ww = dw * rw - dx * rx - dy * ry - dz * rz;
      const len = Math.hypot(x, y, z, ww);
      x /= len; y /= len; z /= len; ww /= len;
      r[o] = x; r[o + 1] = y; r[o + 2] = z; r[o + 3] = ww;
      const p = b * 3;
      t[p] += w * deltas[k + 5]; t[p + 1] += w * deltas[k + 6]; t[p + 2] += w * deltas[k + 7];
    }
  }
  const delta = new THREE.Quaternion();
  head.bones.forEach(({ bone, restPosition, restQuaternion, restScale }, i) => {
    delta.set(r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]);
    let kept = 1;
    if (mask) {
      // The layer's per-bone blend of rest and posed: nlerp(identity, delta, w) (shortest arc), w * T.
      const wr = mask[i * 2];
      kept = mask[i * 2 + 1];
      if (wr < 1) {
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        delta.set(delta.x * wr, delta.y * wr, delta.z * wr, delta.w * wr + (1 - wr)).normalize();
      }
    }
    bone.quaternion.multiplyQuaternions(delta, restQuaternion).normalize();
    bone.position.set(restPosition.x + kept * t[i * 3], restPosition.y + kept * t[i * 3 + 1], restPosition.z + kept * t[i * 3 + 2]);
    bone.scale.copy(restScale);
  });
  return any;
}

/** Loads the face data of an animations deployment and drives the worn head's FACIAL_* bones (see the top of this file). */
export class FaceAnimator {
  enabled: boolean;
  private index: Promise<FaceIndex | null> | null = null;
  private curves = new Map<string, FaceCurves>(); // by clip source, once loaded
  private curveRequests = new Map<string, Promise<void>>();
  private files = new Map<string, Promise<unknown>>(); // head and pose files by URL (heads share pose files)
  private meshes: readonly THREE.SkinnedMesh[] = [];
  private head: BoundHead | null = null;
  private pending: Promise<void> = Promise.resolve();
  private bindRequest = 0;
  private posed = false;
  private scratch = { r: new Float64Array(0), t: new Float64Array(0) };
  private rest: RestRecord | null = null;
  // Head-wrapped parts: the worn ones, their cages' skins by cage source (null: none or broken), the cage in use.
  private wraps: readonly FaceWrapPart[] = [];
  private skins = new Map<string, FaceWrapSkin | null>();
  private skinRequests = new Map<string, Promise<void>>();
  private cage: FaceCage | null = null;
  private wrapWeights: Map<string, number> | null = null; // the weights the parts were last wrapped for
  private wrapToken = 0;
  private wrapped = false; // a part sits on a moved cage
  // Face masks of the worn items: the loaded files, and the per-bone weights for the bound head (built at apply).
  private masks: MaskFile[] = [];
  private maskRequest = 0;
  private boneMask: { head: BoundHead; weights: Float32Array | null } | null = null;
  /** Called when a head's poses arrive after it was bound: a held (paused) frame must be drawn again. */
  onReady: (() => void) | null = null;

  constructor(private readonly indexUrl: string | null, options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  private base(): string { return this.indexUrl!.replace(/[^/]*$/, ""); }

  private loadIndex(): Promise<FaceIndex | null> {
    if (!this.index) {
      this.index = !this.indexUrl ? Promise.resolve(null) : fetch(this.indexUrl)
        .then(async response => {
          if (!response.ok) throw new Error(`faces index ${response.status}`);
          const index = await response.json() as FaceIndex;
          if (index?.formatVersion !== 1) throw new Error(`unsupported faces index ${index?.formatVersion}`);
          return index;
        })
        .catch(error => { console.warn("[face] no facial animation:", error); return null; });
    }
    return this.index;
  }

  private json<T>(url: string): Promise<T> {
    let pending = this.files.get(url) as Promise<T> | undefined;
    if (!pending) {
      pending = fetch(url).then(async response => {
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        return await response.json() as T;
      });
      pending.catch(() => this.files.delete(url)); // a failed download may be retried
      this.files.set(url, pending);
    }
    return pending;
  }

  /** Download a clip's face curves (resolves without them when the clip has none or they fail: the face then rests). */
  prepareClip(source: string | undefined): Promise<void> {
    if (!source || !this.enabled) return Promise.resolve();
    let request = this.curveRequests.get(source);
    if (!request) {
      request = this.loadIndex().then(async index => {
        if (!index?.curves.includes(source)) return;
        const data = await this.json<FaceCurves>(`${this.base()}curves/${source}.json`);
        if (data.formatVersion === 1) this.curves.set(source, data);
      }).catch(error => { this.curveRequests.delete(source); console.warn(`[face] curves for ${source}:`, error); });
      this.curveRequests.set(source, request);
    }
    return request;
  }

  /** The worn head's sections (CharacterRig.faceMeshes), head-wrapped parts (CharacterRig.faceWraps) and the face
   *  masks the worn items apply (bone weights asset paths, SourceAssembly.loadSourceFaceMask). Call while its bones are
   *  at rest: before anything poses them, i.e. before the first apply after a head change. Binding the same head again
   *  only takes the parts and masks. Resolves once the head's poses, its cage's skin and the masks are ready (or known
   *  unavailable). */
  bind(meshes: readonly THREE.SkinnedMesh[], wraps: readonly FaceWrapPart[] = [],
    masks: readonly string[] | Promise<readonly string[]> = []): Promise<void> {
    const parts = Promise.all([this.bindWraps(wraps), this.bindMasks(masks)]);
    if (meshes.length === this.meshes.length && meshes.every((m, i) => m === this.meshes[i]))
      return Promise.all([this.pending, parts]).then(() => undefined);
    this.restore();
    this.meshes = [...meshes];
    this.head = null;
    this.rest = null;
    this.cage = null;
    const request = ++this.bindRequest;
    const key = meshes.length ? headKey(meshes) : null;
    if (!key || !this.indexUrl) return this.pending = Promise.resolve();
    // The rest is recorded now, synchronously: by the time the files arrive the bones may have been posed.
    const rest = this.rest = recordRest(meshes);
    this.pending = this.loadIndex().then(async index => {
      const file = index?.heads[key];
      if (!file) return; // a head without a face rig (blank faces, statues, the skull): it stays still, as in the game
      const head = await this.json<HeadFile>(this.base() + file);
      const poses = await this.json<PoseFile>(this.base() + head.pose);
      if (request !== this.bindRequest) return;
      this.head = bindHead(key, meshes, head, poses, rest);
      this.onReady?.();
    }).catch(error => { if (request === this.bindRequest) console.warn("[face] this head stays still:", error); });
    return Promise.all([this.pending, parts]).then(() => undefined);
  }

  /** Take the worn items' face masks (an unknown mask leaves the face unmasked, with a warning). */
  private bindMasks(masks: readonly string[] | Promise<readonly string[]>): Promise<void> {
    const request = ++this.maskRequest;
    if (!this.indexUrl) return Promise.resolve();
    return Promise.resolve(masks).then(async sources => {
      const index = await this.loadIndex();
      const files = await Promise.all([...new Set(sources)].sort().map(async source => {
        const file = index?.masks?.[source];
        if (!file) { if (index) console.warn(`[face] no data for the face mask ${source}: the face moves unmasked`); return null; }
        const mask = await this.json<MaskFile>(this.base() + file);
        return mask?.formatVersion === 1 && mask.source === source ? mask : null;
      }));
      if (request !== this.maskRequest) return;
      const next = files.filter((m): m is MaskFile => !!m);
      if (next.length === this.masks.length && next.every((m, i) => m === this.masks[i])) return;
      this.masks = next;
      this.boneMask = null;
      this.wrapWeights = null; // the same weights now pose the face differently
      this.onReady?.();
    }).catch(error => { if (request === this.maskRequest) console.warn("[face] face masks:", error); });
  }

  /** The bound head's per-bone mask weights (built once per head and mask set). */
  private maskFor(head: BoundHead): Float32Array | null {
    if (this.boneMask?.head !== head) this.boneMask = { head, weights: maskWeights(head, this.masks) };
    return this.boneMask.weights;
  }

  /** Take the worn head-wrapped parts and fetch their cage's skin (a part whose cage has none stays on the still cage). */
  private bindWraps(wraps: readonly FaceWrapPart[]): Promise<void> {
    this.wraps = [...wraps];
    this.wrapWeights = null; // a new part has not been wrapped for this frame's pose yet
    if (!this.indexUrl || !this.enabled) return Promise.resolve();
    return Promise.all([...new Set(wraps.map(part => part.cage))].map(cage => {
      let request = this.skinRequests.get(cage);
      if (!request) {
        request = this.loadIndex().then(async index => {
          const file = index?.wraps?.[cage];
          const skin = file ? await this.json<FaceWrapSkin>(this.base() + file) : null;
          this.skins.set(cage, skin?.formatVersion === 1 && skin.cage === cage ? skin : null);
          if (skin) this.onReady?.();
        }).catch(error => { this.skinRequests.delete(cage); console.warn(`[face] wrapped parts stay still on ${cage}:`, error); });
        this.skinRequests.set(cage, request);
      }
      return request;
    })).then(() => undefined);
  }

  /** Move the worn head-wrapped parts with the face (after poseHead), or put them back on the still cage. */
  private applyWraps(weights: ReadonlyMap<string, number> | null): void {
    if (!weights) {
      if (this.wrapped) for (const part of this.wraps) part.rewrap(null, 0);
      this.wrapped = false;
      this.wrapWeights = null;
      return;
    }
    if (!this.wraps.length || !this.head || !this.rest) return;
    const same = !!this.wrapWeights && this.wrapWeights.size === weights.size
      && [...weights].every(([name, w]) => this.wrapWeights!.get(name) === w);
    if (!same) { this.wrapWeights = new Map(weights); this.wrapToken = nextWrapToken(); }
    let updated = false;
    for (const part of this.wraps) {
      const skin = this.skins.get(part.cage);
      if (!skin) continue; // not loaded yet, or none: the part stays on the still cage
      try {
        if (this.cage?.skin !== skin) {
          this.cage = new FaceCage(skin, this.meshes, this.rest);
          if (this.cage.missing.length) console.warn(`[face] ${this.head.key}: no bones for ${this.cage.missing.length} of the cage's`, this.cage.missing);
          this.wrapToken = nextWrapToken();
          updated = false;
        }
        const cage = this.cage;
        if (!updated) { cage.update(); updated = true; }
        part.rewrap(target => cage.displace(target), this.wrapToken);
        this.wrapped = true;
      } catch (error) {
        console.warn(`[face] wrapped part stays still on ${part.cage}:`, error);
        this.skins.set(part.cage, null);
        part.rewrap(null, 0);
      }
    }
  }

  /** The bound head's poses are being fetched or checked: resolves when that is over. */
  ready(): Promise<void> { return this.pending; }

  /** Pose the face for the clips in play (after the clips and the deformation rig have posed the body). */
  apply(samples: FaceSample[]): void {
    if (!this.head || !this.enabled) return;
    // With no pose weighted, poseHead writes every bone back to its rest: nothing is left to restore.
    const weights = poseWeights(samples, this.curves);
    this.posed = poseHead(this.head, weights, this.scratch, this.maskFor(this.head));
    this.applyWraps(this.posed ? weights : null);
  }

  /** Put the bound head's bones back to rest (animation stopped, face switched off, head replaced). */
  restore(): void {
    this.applyWraps(null);
    if (!this.posed || !this.head) { this.posed = false; return; }
    for (const { bone, restPosition, restQuaternion, restScale } of this.head.bones) {
      bone.position.copy(restPosition); bone.quaternion.copy(restQuaternion); bone.scale.copy(restScale);
    }
    this.posed = false;
  }

  /** Turn the face on or off (?face=0 compares); off puts the bones back to rest. */
  setEnabled(on: boolean): void {
    if (!on) this.restore();
    this.enabled = on;
  }

  /** Forget the bound head (its bones put back first): the body or the whole rig is going away. */
  unbind(): void {
    this.restore();
    this.meshes = [];
    this.wraps = [];
    this.head = null;
    this.rest = null;
    this.cage = null;
    ++this.bindRequest;
    this.pending = Promise.resolve();
  }
}
