import * as THREE from "three";
import type { RestRecord } from "./FaceAnimator";

// Head-wrapped parts follow the face (12 Nov 2026). Beards, balaclavas and mouth scarves are wrapped by the head
// (HeadWrap.ts): in the game they follow the worn face's *_Wraps cage, a low-poly skinned mesh (439 vertices) that the
// head's skeleton deforms like the face itself, so a smile stretches the balaclava and an open jaw carries the beard.
// The viewer wraps them on the cage at rest; without this the facial animation pushes the cheeks through a balaclava
// and drops the lower lip through a beard.
//
// Here the cage is skinned on the CPU by the face's FACIAL_* bones only, relative to the bone they hang from (head,
// neck): the part's own skinning already carries it with the head and neck, so only the face's motion on top of that is
// added. For a FACIAL bone k with local chain P (from its first non-FACIAL ancestor down to k, P0 at rest) and bind
// world K = inverse(boneInverse), a cage point in the head's geometry space moves by
//     G = bindMatrix^-1 * K * P0^-1 * P * K^-1 * bindMatrix
// (the identity at rest), blended by the cage vertex's skin weights (build-face.mjs: all of them, up to eight; three's
// four-influence limit is a GPU one, and the top four alone let the lips through a balaclava; a weight on a non-FACIAL
// bone or a bone this head lacks leaves its share where it is). The part is then re-wrapped on
// the moved cage with the binding it was wrapped with, so it keeps its rest offset from every cage triangle.

/** A face cage's skin (build-face.mjs wraps/<cage>.json), in the published cage's vertex order. */
export interface FaceWrapSkin {
  formatVersion: 1;
  cage: string; // the cage's source path, as head-wraps.json names it
  positions: number[]; // the published (unmorphed) cage, for a consistency check
  bones: string[];
  influences?: number; // slots per vertex (4 when absent)
  joints: number[]; // per vertex, `influences` indices into bones
  weights: number[]; // per vertex, `influences` weights summing to 1 (zero-padded)
}

/** Maps the worn (morphed) cage at rest to the cage the face has moved. */
export type CageDisplace = (cage: ArrayLike<number>) => ArrayLike<number>;

/** A worn head-wrapped part (CharacterRig.faceWraps): the cage its head drives it with, and a re-wrap of the part on
 *  that cage moved by the face (null puts it back on the still cage). `token` names the displacement: the same token
 *  again changes nothing, so a held frame does not re-wrap every time it is drawn. */
export interface FaceWrapPart {
  cage: string;
  rewrap(displace: CageDisplace | null, token: number): void;
}

let tokens = 0;
/** A displacement token no other face pose has used (unique across animators: a part remembers the last one). */
export const nextWrapToken = (): number => ++tokens;

interface CageBone {
  chain: THREE.Bone[]; // the FACIAL bones from the first one under a non-FACIAL bone down to this bone
  before: THREE.Matrix4; // bindMatrix^-1 * K * P0^-1
  after: THREE.Matrix4; // K^-1 * bindMatrix
  matrix: THREE.Matrix4; // G, this frame
}

const FACIAL = /^FACIAL_/i;

/** The local chain of FACIAL bones above and including `bone`, top first. */
function facialChain(bone: THREE.Bone): THREE.Bone[] {
  const chain: THREE.Bone[] = [];
  for (let b: THREE.Object3D | null = bone; b && (b as THREE.Bone).isBone && FACIAL.test(b.name); b = b.parent) chain.unshift(b as THREE.Bone);
  return chain;
}

/** A worn face's cage, skinned by that face's FACIAL bones (see the top of this file). */
export class FaceCage {
  private readonly bones: (CageBone | null)[];
  private readonly width: number;
  private readonly local = new THREE.Matrix4();
  private readonly chain = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();
  private out = new Float32Array(0);
  /** Skin bones this head has no FACIAL bone for (their weight stays with the part's own skinning). */
  readonly missing: string[] = [];

  /** `meshes` are the worn head's sections, `rest` their FACIAL bones' rest locals (FaceAnimator records both). */
  constructor(readonly skin: FaceWrapSkin, meshes: readonly THREE.SkinnedMesh[], rest: RestRecord) {
    const n = skin.positions.length / 3, width = this.width = skin.influences ?? 4;
    if (skin.formatVersion !== 1 || !Number.isInteger(n) || !(width >= 1) || skin.joints.length !== n * width
      || skin.weights.length !== n * width
      || skin.joints.some(j => !Number.isInteger(j) || j < 0 || j >= skin.bones.length))
      throw new Error(`invalid face cage skin ${skin.cage}`);
    const found = new Map<string, { bone: THREE.Bone; mesh: THREE.SkinnedMesh; index: number }>();
    for (const mesh of meshes) mesh.skeleton.bones.forEach((bone, index) => {
      const name = bone.name.toLowerCase();
      if (FACIAL.test(name) && !found.has(name)) found.set(name, { bone, mesh, index });
    });
    const p0 = new THREE.Matrix4();
    this.bones = skin.bones.map(name => {
      if (!FACIAL.test(name)) return null; // head, neck: the part's own skinning moves it there
      const at = found.get(name.toLowerCase());
      if (!at) { this.missing.push(name); return null; }
      const chain = facialChain(at.bone);
      p0.identity();
      for (const b of chain) {
        const r = rest.get(b);
        if (!r) throw new Error(`face cage ${skin.cage}: no rest recorded for ${b.name}`);
        p0.multiply(this.local.compose(r.position, r.quaternion, r.scale));
      }
      const inverseBind = at.mesh.skeleton.boneInverses[at.index];
      const before = at.mesh.bindMatrixInverse.clone().multiply(inverseBind.clone().invert()).multiply(p0.clone().invert());
      const after = inverseBind.clone().multiply(at.mesh.bindMatrix);
      return { chain, before, after, matrix: new THREE.Matrix4() };
    });
  }

  /** Read the face bones' current locals (after the face is posed). */
  update(): void {
    for (const b of this.bones) {
      if (!b) continue;
      this.chain.identity();
      for (const bone of b.chain) this.chain.multiply(this.local.compose(bone.position, bone.quaternion, bone.scale));
      b.matrix.multiplyMatrices(b.before, this.chain).multiply(b.after);
    }
  }

  /** The worn cage (at rest, with its fitting morphs) moved by the face as last update() read it. */
  displace(cage: ArrayLike<number>): Float32Array {
    const { joints, weights } = this.skin, n = this.skin.positions.length / 3, width = this.width;
    if (cage.length !== n * 3) throw new Error(`face cage ${this.skin.cage}: ${cage.length / 3} vertices, the skin has ${n}`);
    if (this.out.length !== cage.length) this.out = new Float32Array(cage.length);
    const out = this.out, p = this.point;
    for (let v = 0; v < n; v++) {
      const x = cage[v * 3], y = cage[v * 3 + 1], z = cage[v * 3 + 2];
      let ox = 0, oy = 0, oz = 0, rest = 1;
      for (let k = 0; k < width; k++) {
        const w = weights[v * width + k], b = w > 0 ? this.bones[joints[v * width + k]] : null;
        if (!b) continue;
        p.set(x, y, z).applyMatrix4(b.matrix);
        ox += w * p.x; oy += w * p.y; oz += w * p.z; rest -= w;
      }
      out[v * 3] = ox + rest * x; out[v * 3 + 1] = oy + rest * y; out[v * 3 + 2] = oz + rest * z;
    }
    return out;
  }
}
