import * as THREE from "three";

// Approximate secondary motion ("Sway", showcase animation stretch, 5 Nov 2026) for garment jiggle chains: bones named
// *_jj / *_JJ / *_jjr / *_JJRoot (tails, ponytails, braids, skirt panels, hat tips, ears, cables, charms). 354 of the
// 3,237 local cosmetic meshes carry such bones. In the game an AnimDynamics node in the character's post-process graph
// swings them (a pendulum/spring solve whose per-chain settings are not in the export); long coats and capes instead
// use cloth simulation on mesh sections without bones, which this does not touch.
//
// This is NOT that solver. It is the generic spring-bone model avatar formats use (VRM): each bone keeps a world-space
// tail point with inertia, is pulled back toward the direction its animated parent says it should point, gets a little
// gravity, and stays at its length. Collision is coarse: a sphere for the head and capsules along the spine and
// thighs, built from the driver bones each step. A chain only collides with shapes its rest tail starts outside of,
// so an item authored close to the body is never pushed away while standing still. Arms have no colliders.

export const JIGGLE_BONE = /jj/i; // every observed chain name carries jj/JJ (jj, jjr, rjj, JJRoot); facial bones excluded below

interface Params { stiffness: number; drag: number; gravity: number }
const DEFAULT: Params = { stiffness: 1.6, drag: 0.35, gravity: 0.35 };
// Skirt and dress panels sit against the thighs; a stiffer spring keeps them from swinging through the legs.
const STIFF: Params = { stiffness: 5, drag: 0.5, gravity: 0.15 };
// Hair hangs: a weaker pull to its authored direction than gravity, so a ponytail droops when the head bows
// (with DEFAULT it stayed level, still pointing where the upright head had aimed it; captured 5 Nov).
const HAIR: Params = { stiffness: 0.7, drag: 0.3, gravity: 1.0 };
const paramsFor = (name: string) => /skirt|backside|dress|mantle/i.test(name) ? STIFF
  : /pony|braid|hair|bun_/i.test(name) ? HAIR : DEFAULT;
const STEP = 1 / 60;
const TAIL_RADIUS = 0.02;

// Coarse body shapes on the driver skeleton (metres). A capsule runs from bone `a` to bone `b`; the head sphere sits
// 9 cm beyond the head joint along the neck direction.
const CAPSULES: [string, string, number][] = [
  ["pelvis", "spine_01", 0.13], ["spine_01", "spine_02", 0.14], ["spine_02", "spine_03", 0.14], ["spine_03", "neck_01", 0.12],
  ["thigh_l", "calf_l", 0.08], ["thigh_r", "calf_r", 0.08],
];
interface Shape { a: THREE.Vector3; b: THREE.Vector3; radius: number }

interface Spring {
  bone: THREE.Bone;
  rest: THREE.Quaternion; // local rotation before any sway
  axis: THREE.Vector3; // unit direction to the tail in the bone's own frame
  length: number; // world length of that tail
  tail: THREE.Vector3;
  previous: THREE.Vector3;
  params: Params;
  colliders: number[]; // indices into the shape list this chain started outside of
}

const tmpAB = new THREE.Vector3(), tmpAP = new THREE.Vector3(), tmpC = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
function closestOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3) {
  tmpAB.copy(b).sub(a);
  const len2 = tmpAB.lengthSq();
  const t = len2 > 0 ? THREE.MathUtils.clamp(tmpAP.copy(p).sub(a).dot(tmpAB) / len2, 0, 1) : 0;
  return out.copy(a).addScaledVector(tmpAB, t);
}

const tmp = { q: new THREE.Quaternion(), r: new THREE.Quaternion(), v: new THREE.Vector3(), p: new THREE.Vector3(), d: new THREE.Vector3() };

export class SpringBones {
  private springs = new Map<THREE.Bone, Spring>();
  private order: Spring[] = [];
  private pending = 0;
  private root: THREE.Object3D | null = null;
  private shapeBones: { a: THREE.Object3D; b: THREE.Object3D; radius: number; head: boolean }[] = [];
  private shapes: Shape[] = [];

  get count(): number { return this.order.length; }

  /** Collect the jiggle bones currently driven by the body (under `root`), keeping the state of bones already known. */
  rebuild(root: THREE.Object3D | null): void {
    const found: THREE.Bone[] = [];
    root?.traverse(o => { const b = o as THREE.Bone; if (b.isBone && JIGGLE_BONE.test(b.name) && !/^FACIAL_/i.test(b.name)) found.push(b); });
    const keep = new Set(found);
    for (const [bone, spring] of this.springs) if (!keep.has(bone)) { bone.quaternion.copy(spring.rest); this.springs.delete(bone); }
    this.root = root;
    const named = (name: string) => root?.getObjectByName(name);
    this.shapeBones = [
      ...CAPSULES.map(([a, b, radius]) => ({ a: named(a), b: named(b), radius, head: false })),
      { a: named("neck_01"), b: named("head"), radius: 0.11, head: true },
    ].filter((s): s is { a: THREE.Object3D; b: THREE.Object3D; radius: number; head: boolean } => !!s.a && !!s.b);
    root?.updateMatrixWorld(true);
    this.measureShapes();
    for (const bone of found) {
      if (this.springs.has(bone)) continue;
      // Aim at the first child bone; a leaf continues its parent segment's direction (UE bones run along +X).
      const child = bone.children.find(c => (c as THREE.Bone).isBone);
      const local = child ? child.position.clone() : new THREE.Vector3(Math.max(0.05, bone.position.length()), 0, 0);
      if (local.lengthSq() < 1e-8) continue;
      const scale = bone.getWorldScale(tmp.v).x;
      const tail = bone.localToWorld(local.clone());
      const colliders = this.shapes.map((shape, i) => [shape, i] as const)
        .filter(([shape]) => closestOnSegment(tail, shape.a, shape.b, tmp.v).distanceTo(tail) > shape.radius + TAIL_RADIUS)
        .map(([, i]) => i);
      this.springs.set(bone, { bone, rest: bone.quaternion.clone(), axis: local.clone().normalize(), length: local.length() * scale,
        tail, previous: tail.clone(), params: paramsFor(bone.name), colliders });
    }
    // Parents before children, so each child reads its parent's swung frame.
    this.order = found.map(b => this.springs.get(b)).filter((s): s is Spring => !!s);
  }

  private measureShapes(): void {
    this.shapes = this.shapeBones.map(({ a, b, radius, head }) => {
      const pa = a.getWorldPosition(new THREE.Vector3()), pb = b.getWorldPosition(new THREE.Vector3());
      // The head: one sphere 9 cm past the head joint, continuing the neck.
      if (head) { const c = pb.clone().addScaledVector(pb.clone().sub(pa).normalize(), 0.09); return { a: c, b: c.clone(), radius }; }
      return { a: pa, b: pb, radius };
    });
  }

  /** Advance at a fixed 60 Hz (frame-rate independent), at most a few steps per frame. */
  update(delta: number): void {
    if (!this.order.length) return;
    this.pending = Math.min(this.pending + delta, STEP * 4);
    if (this.pending < STEP) return;
    this.root?.updateMatrixWorld(true); // the mixer moved the body this frame
    this.measureShapes();
    while (this.pending >= STEP) {
      this.pending -= STEP;
      for (const s of this.order) this.step(s);
    }
  }

  private step(s: Spring): void {
    const { bone, params } = s;
    const parent = bone.parent;
    if (!parent) return; // its item was unequipped mid-pass; the next rebuild drops it
    parent.updateWorldMatrix(true, false);
    const parentWorld = parent.getWorldQuaternion(tmp.q);
    const restWorld = tmp.r.copy(parentWorld).multiply(s.rest);
    bone.updateWorldMatrix(false, false);
    const origin = bone.getWorldPosition(tmp.p);
    const restDir = tmp.d.copy(s.axis).applyQuaternion(restWorld);
    const next = tmp.v.copy(s.tail).sub(s.previous).multiplyScalar(1 - params.drag) // inertia
      .add(s.tail)
      .addScaledVector(restDir, params.stiffness * STEP) // pull back toward the animated rest direction
      .add({ x: 0, y: -params.gravity * STEP, z: 0 } as THREE.Vector3);
    next.sub(origin).normalize().multiplyScalar(s.length).add(origin); // keep the bone's length
    for (const i of s.colliders) { // push out of the body shapes this chain started outside of
      const shape = this.shapes[i];
      if (!shape) continue;
      const closest = closestOnSegment(next, shape.a, shape.b, tmpC.clone());
      const away = next.clone().sub(closest), reach = shape.radius + TAIL_RADIUS;
      if (away.lengthSq() < reach * reach && away.lengthSq() > 1e-12) next.copy(closest).addScaledVector(away.normalize(), reach);
    }
    next.sub(origin).normalize().multiplyScalar(s.length).add(origin); // and again after any push
    s.previous.copy(s.tail);
    s.tail.copy(next);
    // Local rotation that turns the rest axis toward the new tail.
    const dir = next.sub(origin).applyQuaternion(restWorld.invert()).normalize();
    bone.quaternion.copy(s.rest).multiply(new THREE.Quaternion().setFromUnitVectors(s.axis, dir));
    bone.updateWorldMatrix(false, false);
  }

  /** The viewer orbited `radians` around the character (camera azimuth change). In the game the character itself
   *  turns on the outfit screen and its physics simulates in world space (MABP_CharacterMeshMerge_Physics: a
   *  RigidBody node with SimulationSpace WorldSpace), so dangling parts lag behind the turn and swing back. Here the
   *  camera moves instead, so the turn is replayed in the character's frame: every tail point (and its previous
   *  position, keeping its velocity) is carried around the character's vertical axis by the same angle. */
  turn(radians: number): void {
    if (!this.order.length || !radians || !this.root) return;
    const pivot = this.root.getWorldPosition(tmp.p);
    const spin = tmp.q.setFromAxisAngle(UP, radians);
    for (const s of this.order) for (const point of [s.tail, s.previous]) point.sub(pivot).applyQuaternion(spin).add(pivot);
  }

  /** Put every bone back to its pre-sway rotation and forget the motion. */
  reset(): void {
    for (const s of this.order) s.bone.quaternion.copy(s.rest);
    this.springs.clear();
    this.order = [];
    this.pending = 0;
  }
}
