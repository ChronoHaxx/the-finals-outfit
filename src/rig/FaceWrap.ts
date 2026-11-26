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

// Rest contact (26 Nov 2026). VIEWER-SIDE, NOT GAME DATA. On a few faces the game's own wrap leaves the still face
// through a head-wrapped part: those faces' _Wraps cages sit about 2.5 mm inside their own noses, so Balaclava Cotton
// Black and Leopard show the nose tip on Faces 23 and 30, and the nose, lips and cheek edges on Face 32, at idle
// (_docs/balaclava-nose-2026-11-26/README.md). The game's data gives no rule that hides the face there: the balaclava
// activates no head hide, and M_Face's only opacity is the neck fade. On 22 Nov the owner chose to fix a lip coming
// through ("Fix it first", FaceContact above); this extends that choice to the still face.
//
// A head vertex of the still face is held where it pokes through the part: the part crosses the skin's own normal line
// inside the head (within REST_RANGE of the vertex), and the part triangle crossed first faces the way the skin does.
// That triangle is pushed out along its corners' normals until the vertex is REST_GAP inside it, with the same
// least-squares shares as FaceContact (a corner takes the largest push any vertex asks of it, refined over a few passes
// because neighbouring triangles share corners). Nothing else moves: a part the face pokes through nowhere gets no push
// at all, and the push is only ever outwards. The push is kept per part vertex and added along the part's normals after
// every wrap, still or moved, so FaceContact binds to the pushed part and keeps the face under it while it animates.
//
// The skin in an opening is meant to show, and the part's lining would otherwise claim it. The knit rolls in at the eye
// opening and at the hem, its rolled rim facing into the opening, and runs on inside the head (up to 10 cm, in the head
// by design). Against the game's own wrap those vertices lie inside the head cage or face away from it (HeadWrap.ts
// overHead), and a skin vertex whose normal line meets such a triangle first is left alone.
//
// Hair-card parts (beards, moustaches, brows) take no rest contact: their cards lie on the skin by design and the skin
// between them is meant to show.

export const REST_GAP = 0.0005; // the still face ends up at least this far inside the part
const REST_RANGE = 0.006; // how far into the head the skin's normal line is followed (and the most a part vertex moves)
const REST_PASSES = 8;
const HAIR_SURFACES = new Set(["hair", "hair-metallic", "eyelash"]);

/** Whether a head-wrapped part may take the rest contact: not a hair-card surface (see above). */
export function takesRestContact(part: THREE.Mesh): boolean {
  const materials = Array.isArray(part.material) ? part.material : [part.material];
  return !materials.some(m => HAIR_SURFACES.has(m?.userData?.surfaceKind));
}

/** The rest contact (see above) of a part on its still wrap against the worn head's sections: per part vertex, how far
 *  to push it out along its normal, or null when the still face pokes through it nowhere. `over` marks the part
 *  vertices that lie over the head (HeadWrap.ts overHead, nonzero); without it every vertex does. `maxPush` is the
 *  largest push, `held` how many head vertices it holds. */
export function restContact(part: THREE.Mesh, still: StillWrap, head: readonly THREE.Mesh[],
  over?: ArrayLike<number>): { push: Float32Array; maxPush: number; held: number } | null {
  const count = still.positions.length / 3, geometry = part.geometry;
  if (!Number.isInteger(count) || still.normals.length !== count * 3 || geometry.attributes.position.count !== count
    || (over && over.length !== count))
    throw new Error("invalid still wrap");
  const base = geometry.attributes.position.array, morphed = morphedPositions(part);
  const drawn = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) drawn[i] = still.positions[i] + morphed[i] - base[i];
  const normals = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const x = still.normals[v * 3], y = still.normals[v * 3 + 1], z = still.normals[v * 3 + 2], l = length3(x, y, z) || 1;
    normals[v * 3] = x / l; normals[v * 3 + 1] = y / l; normals[v * 3 + 2] = z / l;
  }
  const lining = (v: number) => !!over && !over[v];
  const triangles = geometry.index ? Array.from(geometry.index.array as ArrayLike<number>) : Array.from({ length: count }, (_, i) => i);
  const grid = new Map<number, number[]>();
  const cell = (x: number) => Math.floor(x / CELL);
  const cellKey = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); // +-5 m
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    const min = [0, 1, 2].map(j => Math.min(drawn[a + j], drawn[b + j], drawn[c + j]));
    const max = [0, 1, 2].map(j => Math.max(drawn[a + j], drawn[b + j], drawn[c + j]));
    for (let x = cell(min[0]); x <= cell(max[0]); x++) for (let y = cell(min[1]); y <= cell(max[1]); y++)
      for (let z = cell(min[2]); z <= cell(max[2]); z++) {
        const key = cellKey(x, y, z);
        let list = grid.get(key);
        if (!list) grid.set(key, list = []);
        list.push(t);
      }
  }
  const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const hit = new THREE.Vector3(), best = new THREE.Vector3(), end = new THREE.Vector3(), h = new THREE.Vector3();
  const n = new THREE.Vector3(), w = new THREE.Vector3(), ray = new THREE.Ray(), triangle = new THREE.Triangle();
  const corners: number[] = [], bary: number[] = [], flips: number[] = [], points: number[] = [];
  const tested = new Map<number, Set<number>>(); // per head vertex count, the vertices already tested (sections may
  // repeat one vertex buffer and draw different parts of it)
  for (const mesh of head) {
    const positions = morphedPositions(mesh), headNormals = mesh.geometry.attributes.normal, index = mesh.geometry.index;
    if (!headNormals) continue;
    const total = positions.length / 3;
    let done = tested.get(total);
    if (!done) tested.set(total, done = new Set());
    const drawnVertices = index ? new Set(Array.from(index.array as ArrayLike<number>)) : Array.from({ length: total }, (_, i) => i);
    for (const v of drawnVertices) {
      if (done.has(v)) continue;
      done.add(v);
      p.fromArray(positions, v * 3);
      h.fromBufferAttribute(headNormals, v);
      if (!(h.lengthSq() > 0)) continue;
      h.normalize();
      ray.origin.copy(p);
      ray.direction.copy(h).negate();
      end.copy(p).addScaledVector(h, -REST_RANGE);
      let first = REST_RANGE, bt = -1;
      for (let x = cell(Math.min(ray.origin.x, end.x)); x <= cell(Math.max(ray.origin.x, end.x)); x++)
        for (let y = cell(Math.min(ray.origin.y, end.y)); y <= cell(Math.max(ray.origin.y, end.y)); y++)
          for (let z = cell(Math.min(ray.origin.z, end.z)); z <= cell(Math.max(ray.origin.z, end.z)); z++) {
            const list = grid.get(cellKey(x, y, z));
            if (!list) continue;
            for (const t of list) {
              if (!ray.intersectTriangle(a.fromArray(drawn, triangles[t] * 3), b.fromArray(drawn, triangles[t + 1] * 3),
                c.fromArray(drawn, triangles[t + 2] * 3), false, hit)) continue;
              const d = hit.distanceTo(ray.origin);
              if (d <= first) { first = d; bt = t; best.copy(hit); }
            }
          }
      if (bt < 0) continue; // the vertex does not poke through the part
      if (lining(triangles[bt]) || lining(triangles[bt + 1]) || lining(triangles[bt + 2])) continue; // an opening's lining
      triangle.set(a.fromArray(drawn, triangles[bt] * 3), b.fromArray(drawn, triangles[bt + 1] * 3), c.fromArray(drawn, triangles[bt + 2] * 3));
      if (!triangle.getBarycoord(best, w)) continue; // a degenerate triangle
      w.set(Math.max(0, w.x), Math.max(0, w.y), Math.max(0, w.z)).divideScalar(w.x + w.y + w.z || 1);
      triangle.getNormal(n);
      let outward = 0; // the part's outward side: its vertex normals at the triangle's corners
      for (let k = 0; k < 3; k++) {
        const o = triangles[bt + k] * 3;
        outward += n.x * normals[o] + n.y * normals[o + 1] + n.z * normals[o + 2];
      }
      const flip = outward < 0 ? -1 : 1;
      n.multiplyScalar(flip);
      if (n.dot(h) < CONTACT_FACING) continue; // the part faces another way here (the far side of a fold)
      if (!(best.sub(p).dot(n) < 0)) continue; // on the part's surface, not through it
      for (let k = 0; k < 3; k++) corners.push(triangles[bt + k]);
      bary.push(w.x, w.y, w.z); flips.push(flip); points.push(p.x, p.y, p.z);
    }
  }
  if (!flips.length) return null;
  const push = new Float32Array(count), step = new Float32Array(count);
  const f = [0, 0, 0, 0, 0, 0, 0, 0, 0], share = [0, 0, 0];
  for (let pass = 0; pass < REST_PASSES; pass++) {
    step.fill(0);
    let short = false;
    for (let i = 0; i < flips.length; i++) {
      for (let k = 0; k < 3; k++) {
        const v = corners[i * 3 + k];
        for (let j = 0; j < 3; j++) f[k * 3 + j] = drawn[v * 3 + j] + push[v] * normals[v * 3 + j];
      }
      const ux = f[3] - f[0], uy = f[4] - f[1], uz = f[5] - f[2], vx = f[6] - f[0], vy = f[7] - f[1], vz = f[8] - f[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = length3(nx, ny, nz) * flips[i];
      if (!length) continue;
      nx /= length; ny /= length; nz /= length;
      let gap = 0;
      for (let j = 0; j < 3; j++) {
        const m = bary[i * 3] * f[j] + bary[i * 3 + 1] * f[3 + j] + bary[i * 3 + 2] * f[6 + j] - points[i * 3 + j];
        gap += m * (j === 0 ? nx : j === 1 ? ny : nz);
      }
      const need = REST_GAP - gap;
      if (!(need > 1e-7)) continue;
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        const v = corners[i * 3 + k];
        share[k] = bary[i * 3 + k] * Math.max(0, normals[v * 3] * nx + normals[v * 3 + 1] * ny + normals[v * 3 + 2] * nz);
        sum += share[k] * share[k];
      }
      if (sum < 1e-6) continue;
      for (let k = 0; k < 3; k++) {
        const v = corners[i * 3 + k], want = need * share[k] / sum;
        if (want > step[v]) step[v] = want;
      }
      short = true;
    }
    if (!short) break;
    for (let v = 0; v < count; v++) if (step[v] > 0) push[v] = Math.min(push[v] + step[v], REST_RANGE);
  }
  let maxPush = 0;
  for (let v = 0; v < count; v++) maxPush = Math.max(maxPush, push[v]);
  return maxPush > 0 ? { push, maxPush, held: flips.length } : null;
}

/** Adds a part's rest-contact push (restContact) along its normals (`stride` apart) to its wrapped positions. */
export function addRestPush(push: ArrayLike<number>, positions: Float32Array, normals: ArrayLike<number>, stride = 3): void {
  for (let v = 0; v < push.length; v++) {
    const s = push[v];
    if (!(s > 0)) continue;
    const ax = normals[v * stride], ay = normals[v * stride + 1], az = normals[v * stride + 2], l = length3(ax, ay, az) || 1;
    positions[v * 3] += s * ax / l; positions[v * 3 + 1] += s * ay / l; positions[v * 3 + 2] += s * az / l;
  }
}
