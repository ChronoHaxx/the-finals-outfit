import * as THREE from "three";

// The game's deformation rig, ported (showcase animation, 5 Nov 2026).
//
// The body has 30 helper joints (*_vpj: forearm and upper-arm twist, elbow/knee/chest volume, thigh roll and
// front/back) that no animation clip keys. In the game a Control Rig, SK_CharacterMeshMergeTarget_CtrlRig (run by
// the merged character mesh's anim blueprint, MABP_CharacterMeshMerge), poses them every frame from the animated
// bones. Left at rest, a twisted hand puts the whole forearm twist at the wrist: linear blend skinning averages two
// rotations far apart and the wrist collapses ("candy wrapper"). This class reproduces that rig's "Forwards Solve"
// program, instruction for instruction where its units are standard UE ones. The program was read from the cooked
// rig with scripts/anim-export/disasm-rigvm.mjs (instruction numbers below refer to that listing).
//
// Space conventions. The rig works in UE space (left-handed, Z up, cm); the app's body came through Blender's UE
// importer, which mirrors Y and scales cm -> m per bone (see convert-clips.mjs). Positions and directions are
// computed directly in three's world space, with every bone-local constant mirrored: UE (x, y, z) cm -> (x, -y, z) m.
// Angles the rig reads out (a rotator's yaw, a YXZ Euler angle) are read from the UE form of the rotation,
// toUE(q) = (-x, y, -z, w), so the arithmetic is exactly UE's. "Initial" transforms are the bind pose, from the skin's
// inverse bind matrices: the viewer's still pose bends the arms ("idle" stance), the rig's initial pose does not.
//
// Not ported: the two optional branches (a lumbar-attachment pendulum and a clavicle-attachment fix, both off for a
// plain body) and Embark's own EmbarkSphericalAim unit (no source in the files), used for thigh_front/back_vpj: it is
// approximated as "swing from the rest direction toward the knee", which leaves the rest pose unchanged.

type Side = "l" | "r";
const SIDES: Side[] = ["l", "r"];
const EPS = 1e-8;

/** UE form of a three rotation under the per-bone mirror (and back: the map is its own inverse). */
function toUE(q: THREE.Quaternion, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.set(-q.x, q.y, -q.z, q.w);
}
/** UE FRotator yaw (degrees) of a UE quaternion: FQuat::Rotator. */
function ueYaw(q: THREE.Quaternion): number {
  return THREE.MathUtils.radToDeg(Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)));
}
/** UE MathDoubleRemap with clamping. */
function remap(value: number, sourceMin: number, sourceMax: number, targetMin: number, targetMax: number): number {
  const span = sourceMax - sourceMin;
  const ratio = Math.abs(span) < EPS ? 0 : THREE.MathUtils.clamp((value - sourceMin) / span, 0, 1);
  return targetMin + (targetMax - targetMin) * ratio;
}

interface Pose { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }

export class DeformationRig {
  /** Every joint this rig writes; restore() puts each back to its pose at construction (the still pose). */
  readonly driven: THREE.Bone[];
  private bones = new Map<string, THREE.Bone>();
  private bindWorld = new Map<string, THREE.Matrix4>(); // bind pose in the skin's bind space
  private bindLocal = new Map<string, Pose>();
  private still = new Map<THREE.Bone, Pose>();
  private armature: THREE.Object3D;
  // Scratch
  private q = new THREE.Quaternion(); private q2 = new THREE.Quaternion(); private q3 = new THREE.Quaternion();
  private v = new THREE.Vector3(); private v2 = new THREE.Vector3(); private v3 = new THREE.Vector3();
  private m = new THREE.Matrix4();

  /** The body's deformation rig, or null when its skeleton lacks the helper joints (another body, a test rig). */
  static find(root: THREE.Object3D): DeformationRig | null {
    let skin: THREE.SkinnedMesh | null = null;
    root.traverse(o => {
      const mesh = o as THREE.SkinnedMesh;
      if (!skin && mesh.isSkinnedMesh && mesh.skeleton.bones.some(b => b.name === "lowerarm_vpj_01_l")) skin = mesh;
    });
    return skin ? new DeformationRig(skin) : null;
  }

  private constructor(skin: THREE.SkinnedMesh) {
    const { bones, boneInverses } = skin.skeleton;
    bones.forEach((bone, i) => {
      this.bones.set(bone.name, bone);
      this.bindWorld.set(bone.name, boneInverses[i].clone().invert());
    });
    for (const bone of bones) {
      const parent = bone.parent as THREE.Bone;
      const world = this.bindWorld.get(bone.name)!;
      const local = parent?.isBone && this.bindWorld.has(parent.name)
        ? this.bindWorld.get(parent.name)!.clone().invert().multiply(world) : world.clone();
      const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() };
      local.decompose(pose.position, pose.quaternion, pose.scale);
      this.bindLocal.set(bone.name, pose);
    }
    const names = SIDES.flatMap(s => [1, 2, 3, 4].map(i => `lowerarm_vpj_0${i}_${s}`)
      .concat([1, 2, 3].map(i => `upperarm_vpj_0${i}_${s}`),
        [`elbow_vpj_${s}`, `knee_vpj_${s}`, `chest_vpj_${s}`, `thigh_roll_vpj_${s}`, `thigh_front_vpj_${s}`, `thigh_back_vpj_${s}`]));
    this.driven = names.map(n => this.bone(n));
    for (const bone of this.driven)
      this.still.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() });
    // The rig's thighs_forward control is the identity in component space: UE +Y, the character's forward. Under the
    // root's import frame that is +Z of the armature node (the root bone's parent).
    const top = this.bone("root");
    this.armature = top.parent ?? top;
  }

  private bone(name: string): THREE.Bone {
    const bone = this.bones.get(name);
    if (!bone) throw new Error(`Deformation rig: missing bone ${name}`);
    return bone;
  }
  private worldRot(o: THREE.Object3D, out: THREE.Quaternion) { o.matrixWorld.decompose(this.v3, out, this.v2); return out; }
  private worldPos(o: THREE.Object3D, out: THREE.Vector3) { return out.setFromMatrixPosition(o.matrixWorld); }
  /** Give `bone` this world rotation (its position stays), and bring its subtree's world matrices up to date. */
  private setWorldRot(bone: THREE.Bone, world: THREE.Quaternion) {
    this.worldRot(bone.parent!, this.q3);
    bone.quaternion.copy(this.q3.invert().multiply(world)).normalize();
    bone.updateMatrixWorld(true);
  }

  /**
   * FRigUnit_AimBoneMath / AimItem: turn `from`'s primary axis at a point, then its secondary axis toward a second
   * point within the plane normal to the primary. Axes are bone-local (three frame); targets are world points.
   */
  private aim(from: THREE.Matrix4, primary: THREE.Vector3, primaryTarget: THREE.Vector3, secondary: THREE.Vector3,
    secondaryTarget: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
    const position = new THREE.Vector3(), scale = new THREE.Vector3();
    from.decompose(position, out, scale);
    const axis = primary.clone().applyQuaternion(out).normalize();
    const target = primaryTarget.clone().sub(position);
    if (target.lengthSq() > EPS) out.premultiply(this.q.setFromUnitVectors(axis, target.normalize()));
    const primaryAxis = primary.clone().applyQuaternion(out).normalize();
    const axis2 = secondary.clone().applyQuaternion(out), target2 = secondaryTarget.clone().sub(position);
    axis2.addScaledVector(primaryAxis, -axis2.dot(primaryAxis));
    target2.addScaledVector(primaryAxis, -target2.dot(primaryAxis));
    if (axis2.lengthSq() > EPS && target2.lengthSq() > EPS) {
      axis2.normalize(); target2.normalize();
      if (axis2.dot(target2) + 1 < 1e-6) this.q.setFromAxisAngle(primaryAxis, Math.PI);
      else this.q.setFromUnitVectors(axis2, target2);
      out.premultiply(this.q);
    }
    return out.normalize();
  }

  /** Run the rig on the current pose (after the clip has been applied this frame). */
  apply(): void {
    // As in the game, every solve starts from a fresh pose with the helper joints at rest (there, the pose copied from
    // the body each frame). Solving on top of last frame's output gives the same answer only up to rounding, so a
    // paused frame would never be bit-identical and the still-view accumulator would restart every frame.
    this.restore();
    this.bone("root").parent?.updateMatrixWorld(true);
    const X = new THREE.Vector3(1, 0, 0);
    const I = new THREE.Quaternion();
    for (const s of SIDES) {
      // 2-51 Forearm twist: aim lowerarm_vpj_01 (X at the hand, UE +Y toward 10 cm along the hand's UE +Y), take
      // that rotation relative to vpj_01's bind placement under the current forearm, and spread it down the chain.
      const lower = this.bone(`lowerarm_${s}`), hand = this.bone(`hand_${s}`), v1 = this.bone(`lowerarm_vpj_01_${s}`);
      const handPos = this.worldPos(hand, new THREE.Vector3());
      const handY = new THREE.Vector3(0, -0.1, 0).applyMatrix4(hand.matrixWorld);
      const aimed = this.aim(v1.matrixWorld, X, handPos, new THREE.Vector3(0, -1, 0), handY, new THREE.Quaternion());
      const restWorld = this.worldRot(lower, new THREE.Quaternion()).multiply(this.bindLocal.get(v1.name)!.quaternion);
      const twist = restWorld.invert().multiply(aimed);
      for (const [i, weight] of [[4, 1], [3, 0.8], [2, 0.5], [1, 0.2]] as const) {
        const joint = this.bone(`lowerarm_vpj_0${i}_${s}`);
        joint.quaternion.copy(this.bindLocal.get(joint.name)!.quaternion).multiply(this.q2.copy(I).slerp(twist, weight));
      }
    }
    // 53-104 Elbow and knee volume: push the joint outward in proportion to the bend (the joint's rotator yaw against
    // bind, clamped), in its own local frame. Offsets are UE cm per degree, mirrored to three metres.
    const volume = (joint: string, driver: string, max: number, perDegree: [number, number]) => {
      const j = this.bone(joint), d = this.bone(driver), bind = this.bindLocal.get(j.name)!;
      const delta = this.q.copy(this.bindLocal.get(d.name)!.quaternion).invert().multiply(d.quaternion);
      const yaw = THREE.MathUtils.clamp(ueYaw(toUE(delta, this.q2)), 0, max);
      const offset = this.v.set(perDegree[0] * yaw, -perDegree[1] * yaw, 0).multiplyScalar(0.01).applyQuaternion(bind.quaternion);
      j.position.copy(bind.position).add(offset);
    };
    volume("elbow_vpj_l", "lowerarm_l", 180, [0.1, -0.1]);
    volume("elbow_vpj_r", "lowerarm_r", 180, [-0.1, 0.1]);
    volume("knee_vpj_l", "calf_l", 90, [-0.027, 0.025]);
    volume("knee_vpj_r", "calf_r", 90, [0.027, -0.025]);
    this.bone("root").parent?.updateMatrixWorld(true);
    for (const s of SIDES) {
      // 106-139 Upper arm: aim upperarm_vpj_01 (X at the elbow, UE -Y toward a point 10% of the way from the chest to
      // the bind-pose elbow, carried by the current chest).
      const lower = this.bone(`lowerarm_${s}`), spine = this.bone("spine_03"), u1 = this.bone(`upperarm_vpj_01_${s}`);
      const bindSpine = this.bindWorld.get("spine_03")!;
      const spineBindPos = this.v.setFromMatrixPosition(bindSpine).clone();
      const point = new THREE.Vector3().setFromMatrixPosition(this.bindWorld.get(lower.name)!).sub(spineBindPos).multiplyScalar(0.1).add(spineBindPos);
      point.applyMatrix4(this.m.copy(bindSpine).invert()).applyMatrix4(spine.matrixWorld);
      const elbow = this.worldPos(lower, new THREE.Vector3());
      this.setWorldRot(u1, this.aim(u1.matrixWorld, X, elbow, new THREE.Vector3(0, 1, 0), point, new THREE.Quaternion()));
      // 141-182 Upper-arm twist: aim upperarm_vpj_02 (X at the elbow, UE +Y toward 10 cm along the forearm's UE -Z),
      // relative to its bind placement under vpj_01; 60% to vpj_03, 30% to vpj_02.
      const u2 = this.bone(`upperarm_vpj_02_${s}`), u3 = this.bone(`upperarm_vpj_03_${s}`);
      const below = new THREE.Vector3(0, 0, -0.1).applyMatrix4(lower.matrixWorld);
      const aimed = this.aim(u2.matrixWorld, X, elbow, new THREE.Vector3(0, -1, 0), below, new THREE.Quaternion());
      const restWorld = this.worldRot(u1, new THREE.Quaternion()).multiply(this.bindLocal.get(u2.name)!.quaternion);
      const twist = restWorld.invert().multiply(aimed);
      u3.quaternion.copy(this.bindLocal.get(u3.name)!.quaternion).multiply(this.q2.copy(I).slerp(twist, 0.6));
      u2.quaternion.copy(this.bindLocal.get(u2.name)!.quaternion).multiply(this.q2.copy(I).slerp(twist, 0.3));
      // 184-185 Chest: aim chest_vpj (X at spine_03, UE -Y toward the clavicle).
      const chest = this.bone(`chest_vpj_${s}`);
      this.setWorldRot(chest, this.aim(chest.matrixWorld, X, this.worldPos(spine, new THREE.Vector3()),
        new THREE.Vector3(0, 1, 0), this.worldPos(this.bone(`clavicle_${s}`), new THREE.Vector3()), new THREE.Quaternion()));
    }
    // 187-263 Thighs. Forward = the rig's thighs_forward control (component +Y), +Z of the armature node.
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(this.armature.matrixWorld);
    for (const s of SIDES) {
      const thigh = this.bone(`thigh_${s}`), calf = this.bone(`calf_${s}`);
      const knee = this.worldPos(calf, new THREE.Vector3());
      const leg = knee.clone().sub(this.worldPos(thigh, new THREE.Vector3())).normalize();
      const dot = leg.dot(forward);
      // Back: weight 0.2..1 as the knee goes back; front: 0..1 as it comes forward to vertical and beyond.
      this.swingToward(this.bone(`thigh_back_vpj_${s}`), calf, remap(-dot, -1, 1, 0.2, 1));
      this.swingToward(this.bone(`thigh_front_vpj_${s}`), calf, remap(dot, -1, 0, 0, 1));
      // Thigh roll: the X angle of the thigh's rotation against bind, read as YXZ Euler (UE order: Z*X*Y, three's
      // "ZXY"), applied about X (left: negated and absolute; right: on top of its bind rotation).
      const delta = toUE(this.q.copy(this.bindLocal.get(thigh.name)!.quaternion).invert().multiply(thigh.quaternion), this.q2);
      const roll = new THREE.Euler().setFromQuaternion(delta, "ZXY").x;
      const rollJoint = this.bone(`thigh_roll_vpj_${s}`);
      const about = toUE(this.q3.setFromAxisAngle(X, s === "l" ? -roll : roll), this.q);
      if (s === "l") rollJoint.quaternion.copy(about);
      else rollJoint.quaternion.copy(this.bindLocal.get(rollJoint.name)!.quaternion).multiply(about);
    }
  }

  /** Approximation of EmbarkSphericalAim + weighted SetRotation: swing `joint` from its bind direction toward
   *  `target` (both seen from the joint's parent), by `weight`. Exact at rest. */
  private swingToward(joint: THREE.Bone, target: THREE.Bone, weight: number) {
    const parent = joint.parent as THREE.Bone;
    const bind = this.bindLocal.get(joint.name)!;
    const bindParent = this.bindWorld.get(parent.name)!, bindTarget = this.bindWorld.get(target.name)!;
    const restDir = this.v.setFromMatrixPosition(bindTarget).applyMatrix4(this.m.copy(bindParent).invert()).sub(bind.position).normalize();
    const nowDir = this.worldPos(target, this.v2).applyMatrix4(this.m.copy(parent.matrixWorld).invert()).sub(joint.position).normalize();
    this.q.setFromUnitVectors(restDir, nowDir);
    joint.quaternion.copy(this.q2.identity().slerp(this.q, weight).multiply(bind.quaternion));
  }

  /** Put every driven joint back to its pose from construction (the still pose), exactly. */
  restore(): void {
    for (const [bone, pose] of this.still) {
      bone.position.copy(pose.position); bone.quaternion.copy(pose.quaternion); bone.scale.copy(pose.scale);
    }
  }
}
