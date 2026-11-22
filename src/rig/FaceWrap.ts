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
 *  again changes nothing, so a held frame does not re-wrap every time it is drawn. rewrap returns whether it wrote the
 *  part's geometry. `contact` (when given) is what the face contact needs: the part's mesh, whose geometry the re-wrap
 *  writes, and the part as wrapped on the still cage. */
export interface FaceWrapPart {
  cage: string;
  rewrap(displace: CageDisplace | null, token: number): boolean | void;
  contact?: { mesh: THREE.Mesh; still(): StillWrap | null };
}

/** A head-wrapped part on the still cage, in its geometry space, before its morphs and skinning. */
export interface StillWrap { positions: Float32Array; normals: Float32Array }

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
    const out = this.out;
    for (let v = 0; v < n; v++) {
      const x = cage[v * 3], y = cage[v * 3 + 1], z = cage[v * 3 + 2];
      let ox = 0, oy = 0, oz = 0, rest = 1;
      for (let k = 0; k < width; k++) {
        const w = weights[v * width + k], b = w > 0 ? this.bones[joints[v * width + k]] : null;
        if (!b) continue;
        const e = b.matrix.elements; // G is affine: its bottom row is (0, 0, 0, 1)
        ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
        rest -= w;
      }
      out[v * 3] = ox + rest * x; out[v * 3 + 1] = oy + rest * y; out[v * 3 + 2] = oz + rest * z;
    }
    return out;
  }
}

// Face contact (22 Nov 2026). The cage is coarse: 439 vertices for the whole head, a handful around the mouth. A part
// wrapped on it follows the face's broad motion but not a bulge between cage vertices. Balaclava Cotton Black rests
// 1.6 mm above Face 01's lips; where Face_Surprise and Face_BlueSteel peak together (Chinals' Unrivaled Master at 3.2 s)
// the pouting upper lip came 0.6 mm through it, even at the face mask's half motion. Unreal's own mesh-to-mesh formula
// (position = sum of b_i (X_i + h N_i) over the proxy triangle, N_i its smooth vertex normals) moves the fabric the same
// way to within 0.05 mm, so the game most likely shows it too (_docs/chinals-faces-2026-11-21/README.md).
//
// The viewer adds a one-sided contact on top of the game's wrap. At rest, each head vertex that a part covers (a part
// triangle within CONTACT_RANGE above it, facing the same way as the head) is bound to the nearest point of that triangle.
// While the face moves, the head vertex moves with the head's own skinning by its FACIAL bones (a FaceCage over the head's
// vertices, all eight influences). Where it has come closer to its point than min(rest gap, CONTACT_GAP), along the
// triangle's normal, the triangle's corners are pushed out along their normals, each by its share of the shortfall
// (least squares over the point's barycentric weights; a corner several head vertices push takes the largest push). The
// part is low-poly where the face is dense (about 1,000 vertices for a balaclava), so it is the head's vertices that test
// the part's triangles, not the other way round. The face may push the part out; it never pulls it in, so over an opening
// mouth the fabric still spans the gap as the cage carries it, and a still face changes nothing.

const CONTACT_RANGE = 0.005; // a head vertex within 5 mm below a part triangle at rest is covered by it (deeper, the face
// would have to move it by 4 mm or more towards the part; the masked lips of Unrivaled Master move 2.2 mm)
const CONTACT_GAP = 0.001; // the least a moving face leaves between itself and the part over it (or the rest gap, if smaller)
const CONTACT_FACING = 0.5; // the part triangle and the head's normal agree within 60 degrees
const CONTACT_PUSH = 0.006; // the most the contact moves a part vertex
const CELL = 0.01; // grid cell for the nearest-triangle search
const length3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z); // Math.hypot is slow in V8

/** A mesh's vertices with its morph targets applied as the GPU applies them, in geometry space before skinning. */
export function morphedPositions(mesh: THREE.Mesh): Float32Array {
  const geometry = mesh.geometry, position = geometry.attributes.position, n = position.count;
  const plain = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): a is THREE.BufferAttribute =>
    !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !a.normalized && a.itemSize === 3;
  const out = new Float32Array(n * 3);
  if (plain(position)) out.set(position.array as ArrayLike<number>);
  else for (let i = 0; i < n; i++) { out[i * 3] = position.getX(i); out[i * 3 + 1] = position.getY(i); out[i * 3 + 2] = position.getZ(i); }
  const targets = geometry.morphAttributes.position, influences = mesh.morphTargetInfluences;
  if (targets && influences) targets.forEach((target, k) => {
    const w = influences[k];
    if (!w) return;
    if (geometry.morphTargetsRelative && plain(target)) {
      const d = target.array as ArrayLike<number>;
      for (let i = 0; i < n * 3; i++) out[i] += w * d[i];
      return;
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++)
      out[i * 3 + j] += w * (geometry.morphTargetsRelative ? target.getComponent(i, j) : target.getComponent(i, j) - position.getComponent(i, j));
  });
  return out;
}

/** The part's face contact for one worn head (see above). */
export class FaceContact {
  private readonly push: Float32Array; // per part vertex, this frame's push (scratch)
  private readonly touched: Uint32Array; // the part vertices any constraint can push

  private constructor(
    private readonly corners: Uint32Array, // per covered head vertex, the three part vertices of the triangle above it
    private readonly bary: Float32Array, // its nearest point's weights on them
    private readonly gap: Float32Array, // the gap the contact keeps there: min(rest gap, CONTACT_GAP)
    private readonly flip: Int8Array, // +1 when the triangle's winding normal points away from the head, else -1
    private readonly offsets: Float32Array, // per part vertex, its morph offset (drawn = wrapped + offset)
    private readonly points: Float32Array, // the covered head vertices at rest (morphed), the head's geometry space
    private readonly surface: FaceCage,
  ) {
    this.push = new Float32Array(offsets.length / 3);
    this.touched = Uint32Array.from(new Set(corners));
  }

  /** How many head vertices the contact tests. */
  get size(): number { return this.gap.length; }

  /** Bind a part (its mesh, for its triangles and morphs; `still`, its wrap on the still cage) to the worn head's
   *  sections, whose FACIAL bones' rest is `rest`. The part's geometry space is the head's, as for the cage (FaceCage).
   *  Null when the part covers none of the face. */
  static bind(part: THREE.Mesh, still: StillWrap, head: readonly THREE.SkinnedMesh[], rest: RestRecord): FaceContact | null {
    const count = still.positions.length / 3, geometry = part.geometry;
    if (!Number.isInteger(count) || still.normals.length !== count * 3 || geometry.attributes.position.count !== count)
      throw new Error("invalid still wrap");
    const base = geometry.attributes.position.array, morphed = morphedPositions(part);
    const drawn = new Float32Array(count * 3), offsets = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) { offsets[i] = morphed[i] - base[i]; drawn[i] = still.positions[i] + offsets[i]; }
    const triangles = geometry.index ? Array.from(geometry.index.array as ArrayLike<number>) : Array.from({ length: count }, (_, i) => i);
    // The part's triangles, gridded by their bounds.
    const grid = new Map<number, number[]>();
    const cell = (x: number) => Math.floor(x / CELL);
    const cellKey = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); // +-5 m
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const boxes = new Float32Array(triangles.length * 2); // per triangle: min xyz, max xyz
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
      const min = [0, 1, 2].map(j => Math.min(drawn[a + j], drawn[b + j], drawn[c + j]));
      const max = [0, 1, 2].map(j => Math.max(drawn[a + j], drawn[b + j], drawn[c + j]));
      boxes.set(min, t * 2); boxes.set(max, t * 2 + 3);
      for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], min[j]); hi[j] = Math.max(hi[j], max[j]); }
      for (let x = cell(min[0]); x <= cell(max[0]); x++) for (let y = cell(min[1]); y <= cell(max[1]); y++)
        for (let z = cell(min[2]); z <= cell(max[2]); z++) {
          const key = cellKey(x, y, z);
          let list = grid.get(key);
          if (!list) grid.set(key, list = []);
          list.push(t);
        }
    }
    const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const q = new THREE.Vector3(), best = new THREE.Vector3(), h = new THREE.Vector3(), n = new THREE.Vector3(), w = new THREE.Vector3();
    const triangle = new THREE.Triangle();
    const corners: number[] = [], bary: number[] = [], gaps: number[] = [], flips: number[] = [];
    const points: number[] = [], joints: number[] = [], skinWeights: number[] = [], bones: string[] = [], boneIds = new Map<string, number>();
    const width = head.some(mesh => mesh.geometry.hasAttribute("skinWeight1")) ? 8 : 4;
    for (const mesh of head) {
      const positions = morphedPositions(mesh), normals = mesh.geometry.attributes.normal, headGeometry = mesh.geometry;
      if (!normals) continue;
      for (let v = 0; v < positions.length / 3; v++) {
        p.fromArray(positions, v * 3);
        if (p.x < lo[0] - CONTACT_RANGE || p.x > hi[0] + CONTACT_RANGE || p.y < lo[1] - CONTACT_RANGE || p.y > hi[1] + CONTACT_RANGE
          || p.z < lo[2] - CONTACT_RANGE || p.z > hi[2] + CONTACT_RANGE) continue;
        let nearest = CONTACT_RANGE * CONTACT_RANGE, bt = -1;
        // the cells within CONTACT_RANGE of the vertex (one to eight of them)
        for (let x = cell(p.x - CONTACT_RANGE); x <= cell(p.x + CONTACT_RANGE); x++)
          for (let y = cell(p.y - CONTACT_RANGE); y <= cell(p.y + CONTACT_RANGE); y++)
            for (let z = cell(p.z - CONTACT_RANGE); z <= cell(p.z + CONTACT_RANGE); z++) {
              const list = grid.get(cellKey(x, y, z));
              if (!list) continue;
              for (const t of list) {
                // the triangle's box first: no nearer than the current nearest, no closer look (a repeat across cells is cheap)
                const o = t * 2, dx = Math.max(boxes[o] - p.x, 0, p.x - boxes[o + 3]);
                const dy = Math.max(boxes[o + 1] - p.y, 0, p.y - boxes[o + 4]), dz = Math.max(boxes[o + 2] - p.z, 0, p.z - boxes[o + 5]);
                if (dx * dx + dy * dy + dz * dz >= nearest) continue;
                triangle.set(a.fromArray(drawn, triangles[t] * 3), b.fromArray(drawn, triangles[t + 1] * 3), c.fromArray(drawn, triangles[t + 2] * 3));
                triangle.closestPointToPoint(p, q);
                const d = q.distanceToSquared(p);
                if (d < nearest) { nearest = d; bt = t; best.copy(q); }
              }
            }
        if (bt < 0) continue;
        triangle.set(a.fromArray(drawn, triangles[bt] * 3), b.fromArray(drawn, triangles[bt + 1] * 3), c.fromArray(drawn, triangles[bt + 2] * 3));
        if (!triangle.getBarycoord(best, w)) continue; // a degenerate triangle
        triangle.getNormal(n);
        // The part's outward side: its vertex normals at the triangle's corners.
        let outward = 0;
        for (let k = 0; k < 3; k++) {
          const o = triangles[bt + k] * 3;
          outward += n.x * still.normals[o] + n.y * still.normals[o + 1] + n.z * still.normals[o + 2];
        }
        const flip = outward < 0 ? -1 : 1;
        n.multiplyScalar(flip);
        h.fromBufferAttribute(normals, v).normalize();
        const gap = best.sub(p).dot(n);
        if (!(gap > 0) || n.dot(h) < CONTACT_FACING) continue; // the head is over the part here, or not beneath it
        for (let k = 0; k < 3; k++) corners.push(triangles[bt + k]);
        bary.push(w.x, w.y, w.z); gaps.push(Math.min(gap, CONTACT_GAP)); flips.push(flip);
        points.push(p.x, p.y, p.z);
        for (let set = 0; set < width / 4; set++) {
          const index = headGeometry.getAttribute(set ? "skinIndex1" : "skinIndex"), weight = headGeometry.getAttribute(set ? "skinWeight1" : "skinWeight");
          for (let k = 0; k < 4; k++) {
            const wk = index && weight ? weight.getComponent(v, k) : 0, name = wk > 0 ? mesh.skeleton.bones[index.getComponent(v, k)]?.name : undefined;
            let bone = name ? boneIds.get(name) : undefined;
            if (name && bone === undefined) { bone = bones.length; bones.push(name); boneIds.set(name, bone); }
            joints.push(bone ?? 0); skinWeights.push(name ? wk : 0);
          }
        }
      }
    }
    if (!gaps.length) return null;
    if (!bones.length) bones.push("head");
    const skin: FaceWrapSkin = { formatVersion: 1, cage: `${part.name} contact`, positions: points, bones, influences: width,
      joints, weights: skinWeights };
    return new FaceContact(Uint32Array.from(corners), Float32Array.from(bary), Float32Array.from(gaps), Int8Array.from(flips),
      offsets, Float32Array.from(points), new FaceCage(skin, head, rest));
  }

  /** Push the part's re-wrapped positions (geometry space, before its morphs; `normals` its re-wrapped normals, `stride`
   *  apart) out where the posed face has come closer than the contact's gap. Returns whether any vertex moved. */
  apply(positions: Float32Array, normals: ArrayLike<number>, stride = 3): boolean {
    this.surface.update();
    const moved = this.surface.displace(this.points), { corners, bary, gap, flip, offsets, push, touched } = this;
    for (const v of touched) push[v] = 0;
    const f = [0, 0, 0, 0, 0, 0, 0, 0, 0], m = [0, 0, 0], share = [0, 0, 0];
    for (let i = 0; i < gap.length; i++) {
      for (let k = 0; k < 3; k++) {
        const v = corners[i * 3 + k];
        for (let j = 0; j < 3; j++) f[k * 3 + j] = positions[v * 3 + j] + offsets[v * 3 + j];
      }
      // the triangle's outward normal now
      const ux = f[3] - f[0], uy = f[4] - f[1], uz = f[5] - f[2], vx = f[6] - f[0], vy = f[7] - f[1], vz = f[8] - f[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = length3(nx, ny, nz) * flip[i];
      if (!length) continue;
      nx /= length; ny /= length; nz /= length;
      const w0 = bary[i * 3], w1 = bary[i * 3 + 1], w2 = bary[i * 3 + 2];
      for (let j = 0; j < 3; j++) m[j] = w0 * f[j] + w1 * f[3 + j] + w2 * f[6 + j] - moved[i * 3 + j];
      const short = Math.min(gap[i] - (m[0] * nx + m[1] * ny + m[2] * nz), CONTACT_PUSH);
      if (!(short > 1e-7)) continue;
      // Each corner moves along its own normal: its share c_k = w_k (n_k . n), least squares over sum c_k p_k = short.
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        const v = corners[i * 3 + k], ax = normals[v * stride], ay = normals[v * stride + 1], az = normals[v * stride + 2];
        share[k] = bary[i * 3 + k] * Math.max(0, (ax * nx + ay * ny + az * nz) / (length3(ax, ay, az) || 1));
        sum += share[k] * share[k];
      }
      if (sum < 1e-6) continue;
      for (let k = 0; k < 3; k++) {
        const v = corners[i * 3 + k], want = Math.min(short * share[k] / sum, CONTACT_PUSH);
        if (want > push[v]) push[v] = want;
      }
    }
    let any = false;
    for (const v of touched) {
      const s = push[v];
      if (!(s > 1e-7)) continue;
      const ax = normals[v * stride], ay = normals[v * stride + 1], az = normals[v * stride + 2], l = length3(ax, ay, az) || 1;
      positions[v * 3] += s * ax / l; positions[v * 3 + 1] += s * ay / l; positions[v * 3 + 2] += s * az / l;
      any = true;
    }
    return any;
  }
}
