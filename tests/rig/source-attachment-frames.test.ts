import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { attachSourceStatic, sourceAttachmentRest, sourceAttachmentFrame } from "../../src/rig/SourceAttachment.ts";
import { resolveSourceRigParts, type AssemblyAssets, type SourceOutfit } from "../../src/rig/SourceAssembly.ts";

// Earrings and lumbar props are attached statics whose socket is NOT a body bone: the earrings name
// a socket the head skeleton defines on its own ear bones, the props name a bone an optional
// attachment mesh adds over the body's pelvis. The index therefore carries that component's own
// rest frames, and the resolver must bind each to its authoring component, or fail closed. Every
// right-hand ear socket also carries the source's own RelativeScale (-1, 1, 1); a socket may
// reflect, an authored part scale may not. Expected values are composed here from the source
// order (parent rest, socket transform, part local transform) and the (X, Z, Y) axis mapping.

type Vec3 = [number, number, number];
const MESH = "/Game/Test/SM_Earring.SM_Earring", MI = "/Game/Test/MI_Earring.MI_Earring";
const HEAD = "/Game/Test/SK_Head.SK_Head", OPTIONAL = "/Game/Test/SK_Lumbar.SK_Lumbar";
const BODY_HEAD = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.6, 0.01),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.1, -0.3)), new THREE.Vector3(1, 1, 1));
const PELVIS = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.95, -0.02),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.05, 0.2)), new THREE.Vector3(1, 1, 1));
const EAR_L = new THREE.Matrix4().compose(new THREE.Vector3(0.08, 1.7, 0),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -1.2, 0.4)), new THREE.Vector3(1, 1, 1));
const SOCKET_L = EAR_L.clone().multiply(new THREE.Matrix4().makeTranslation(0.002, -0.01, 0.003));
const SOCKET_R = SOCKET_L.clone().multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
const LUMBAR = PELVIS.clone().multiply(new THREE.Matrix4().makeTranslation(0.06, -0.14, -0.1));

const socket = (bone: string, parentRest: THREE.Matrix4, rest: THREE.Matrix4, restScale: Vec3 = [1, 1, 1]) =>
  ({ bone, parentRest: parentRest.toArray(), rest: rest.toArray(), restScale });

function assets(overrides: Partial<AssemblyAssets> = {}): AssemblyAssets {
  return {
    formatVersion: 1,
    meshes: { [MESH]: { url: "earring.glb", kind: "static", slots: [{ slot: "Earring", material: MI }] } },
    materials: { [MI]: "earring.json" },
    attachmentBody: { source: "body", url: "body.glb", restBones: { head: BODY_HEAD.toArray(), pelvis: PELVIS.toArray() } },
    attachmentFrames: {
      headComponents: { [HEAD]: { sourceSha256: "head-sha", sockets: {
        earring_01_l: socket("FACIAL_L_Ear", EAR_L, SOCKET_L),
        earring_01_r: socket("FACIAL_R_Ear", EAR_L, SOCKET_R, [-1, 1, 1]) } } },
      optionalMeshes: { [OPTIONAL]: { sourceSha256: "lumbar-sha", sockets: {
        lumbar_attachment_jj: socket("pelvis", PELVIS, LUMBAR) } } },
    },
    ...overrides,
  };
}

function item(definition: Record<string, unknown>): SourceOutfit["items"][string] {
  return { source: "DA_Earring", hidden: false, materialParameters: [], parts: [{ sourceIndex: 0, staticMesh: MESH,
    skeletalMesh: "", effect: "", hidden: false, rules: [], unresolved: [], materials: {},
    definition: { StaticMesh: { AssetPathName: MESH }, SkeletalMesh: { AssetPathName: "" }, Effect: { AssetPathName: "" },
      TagOverrides: [], bIsAttached: true, LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
      LocalScale: { X: 1, Y: 1, Z: 1 }, ...definition } as never }] };
}

const headPart = (socketName = "earring_01_l", extra: Record<string, unknown> = {}) =>
  item({ bAttachToHeadMesh: true, AttachmentSocket: socketName, ...extra });
const optionalPart = (extra: Record<string, unknown> = {}) =>
  item({ OptionalAttachmentMesh: { AssetPathName: OPTIONAL }, AttachmentSocket: "lumbar_attachment_jj", ...extra });

test("the resolver binds a head socket to every preserved head component and keeps no body rest", () => {
  const [part] = resolveSourceRigParts(headPart(), assets());
  const frame = part.attachment?.frame;
  assert.equal(part.attachment?.socket, "earring_01_l");
  assert.equal(part.attachment?.sourceRestMatrix, undefined, "a head socket is not a body bone");
  assert.equal(frame?.kind, "head-component");
  assert.equal(frame?.kind === "head-component" && frame.components.length, 1);
  const component = frame?.kind === "head-component" ? frame.components[0] : undefined;
  assert.equal(component?.source, HEAD);
  assert.equal(component?.sourceSha256, "head-sha");
  assert.equal(component?.bone, "FACIAL_L_Ear");
  assert.equal(component?.bodyBone, false, "an ear bone belongs to the head, not the body");
  assert.deepEqual(component?.rest, SOCKET_L.toArray());
  assert.deepEqual(component?.parentRest, EAR_L.toArray());
  assert.deepEqual(component?.restScale, [1, 1, 1]);
});

test("a head socket on a bone shared with the body is marked as the body's, at the body's own rest", () => {
  const shared = assets();
  shared.attachmentFrames!.headComponents![HEAD].sockets.nose_attachment =
    socket("head", BODY_HEAD, BODY_HEAD.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.1)));
  const [part] = resolveSourceRigParts(headPart("nose_attachment"), shared);
  const frame = part.attachment?.frame;
  assert.equal(frame?.kind === "head-component" && frame.components[0].bodyBone, true);
  // The same socket with a rest of its own, disagreeing with the body's, must not resolve.
  shared.attachmentFrames!.headComponents![HEAD].sockets.nose_attachment.parentRest =
    BODY_HEAD.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.002, 0)).toArray();
  assert.throws(() => resolveSourceRigParts(headPart("nose_attachment"), shared),
    /head component anchor is not the preserved body rest: head/);
});

test("the resolver carries a mirrored source socket scale through unchanged", () => {
  const [part] = resolveSourceRigParts(headPart("earring_01_r"), assets());
  const frame = part.attachment?.frame;
  assert.deepEqual(frame?.kind === "head-component" ? frame.components[0].restScale : null, [-1, 1, 1]);
  assert.deepEqual(frame?.kind === "head-component" ? frame.components[0].bone : null, "FACIAL_R_Ear");
});

test("the resolver binds an optional attachment mesh to its own body anchor", () => {
  const [part] = resolveSourceRigParts(optionalPart(), assets());
  const frame = part.attachment?.frame;
  assert.equal(part.attachment?.sourceRestMatrix, undefined);
  assert.equal(frame?.kind, "optional-mesh");
  const component = frame?.kind === "optional-mesh" ? frame.component : undefined;
  assert.equal(component?.source, OPTIONAL);
  assert.equal(component?.bone, "pelvis");
  assert.equal(component?.bodyBone, true, "an optional mesh is only ever driven through the body");
  assert.deepEqual(component?.rest, LUMBAR.toArray());
});

test("an ordinary body socket keeps the existing preserved-body binding", () => {
  const [part] = resolveSourceRigParts(item({ AttachmentSocket: "head" }), assets());
  assert.deepEqual(part.attachment?.sourceRestMatrix, BODY_HEAD.toArray());
  assert.equal(part.attachment?.frame, undefined);
  assert.equal(part.attachment?.bodyUrl, "body.glb");
});

test("missing, incomplete or unsupported frame evidence fails closed", () => {
  assert.throws(() => resolveSourceRigParts(headPart(), assets({ attachmentFrames: {} })),
    /Missing preserved head component frame: earring_01_l/);
  assert.throws(() => resolveSourceRigParts(headPart("earring_09_l"), assets()),
    /Missing preserved head component frame: earring_09_l/);
  assert.throws(() => resolveSourceRigParts(optionalPart(), assets({ attachmentFrames: { headComponents: {} } })),
    /Missing preserved optional attachment mesh frame: lumbar_attachment_jj/);
  // A second head that does not carry the socket must block the item rather than silently use the first.
  const twoHeads = assets();
  twoHeads.attachmentFrames!.headComponents!["/Game/Test/SK_Head2.SK_Head2"] = { sourceSha256: "x", sockets: {} };
  assert.throws(() => resolveSourceRigParts(headPart(), twoHeads), /Missing preserved head component frame/);
  for (const broken of [{ rest: [1, 2, 3] }, { parentRest: [Number.NaN, ...SOCKET_L.toArray().slice(1)] },
    { restScale: [0, 1, 1] }, { bone: "" }] as Record<string, unknown>[]) {
    const damaged = assets();
    Object.assign(damaged.attachmentFrames!.headComponents![HEAD].sockets.earring_01_l, broken);
    assert.throws(() => resolveSourceRigParts(headPart(), damaged), /Missing preserved head component frame/);
  }
  // An optional mesh whose anchor is not the body's own rest would silently shift the attachment.
  const moved = assets();
  moved.attachmentFrames!.optionalMeshes![OPTIONAL].sockets.lumbar_attachment_jj.parentRest =
    PELVIS.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.001, 0)).toArray();
  assert.throws(() => resolveSourceRigParts(optionalPart(), moved),
    /optional attachment mesh anchor is not the preserved body rest: pelvis/);
  // An optional mesh bone that is not the body's at all has no driver to ride.
  const detached = assets();
  detached.attachmentFrames!.optionalMeshes![OPTIONAL].sockets.lumbar_attachment_jj.bone = "lumbar_root_jj";
  assert.throws(() => resolveSourceRigParts(optionalPart(), detached),
    /Optional attachment mesh anchor is not the preserved body rest: lumbar_root_jj/);
});

test("a frame on a part that is not an attached static, or on both components at once, is unsupported", () => {
  assert.throws(() => resolveSourceRigParts(headPart("earring_01_l",
    { OptionalAttachmentMesh: { AssetPathName: OPTIONAL } }), assets()), /Unsupported source assembly part 0/);
  const skeletal = item({ bAttachToHeadMesh: true, AttachmentSocket: "earring_01_l", bIsAttached: false });
  skeletal.parts[0].staticMesh = "";
  skeletal.parts[0].skeletalMesh = "/Game/Test/SK_Thing.SK_Thing";
  assert.throws(() => resolveSourceRigParts(skeletal, assets()), /Unsupported source assembly part 0/);
});

test("an authored part scale still may not mirror or collapse, whatever the socket does", () => {
  for (const scale of [{ X: -1, Y: 1, Z: 1 }, { X: 1, Y: 0, Z: 1 }, { X: 1, Y: 1, Z: Number.NaN }])
    assert.throws(() => resolveSourceRigParts(headPart("earring_01_l", { LocalScale: scale }), assets()),
      /Unsupported source attachment transform/);
});

// ---- the rest arithmetic the rig applies -------------------------------------------------

const NORMALS = [[0.3, 0.5, 0.81], [-0.7, 0.1, 0.7], [0, -0.6, 0.8]].map(n => new THREE.Vector3(...n).normalize());
function section(): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0.05, 0.1, 0.02, -0.04, 0.12, 0.08, 0.01, -0.07, 0.1], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(NORMALS.flatMap(n => n.toArray()), 3));
  geometry.setAttribute("tangent", new THREE.Float32BufferAttribute(NORMALS.flatMap((n, i) =>
    [...new THREE.Vector3(1, 0, 0).cross(n).normalize().toArray(), i === 1 ? -1 : 1]), 4));
  geometry.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  new THREE.Group().add(mesh);
  return mesh;
}

function driver(rest: THREE.Matrix4) {
  const root = new THREE.Group(), bone = new THREE.Bone();
  bone.name = "FACIAL_R_Ear";
  rest.decompose(bone.position, bone.quaternion, bone.scale);
  root.add(bone); root.updateMatrixWorld(true);
  return { root, bone, inverse: bone.matrixWorld.clone().invert() };
}

const attachment = (frameSocket: { rest: number[]; restScale: Vec3 }, scale: Vec3 = [1, 1, 1]) => ({
  attachment: { bodyUrl: "body.glb", socket: "earring_01_r", position: [12.5, -3.25, 4.75] as Vec3,
    rotation: [18.5, -40.25, 6.75] as Vec3, scale },
  socket: frameSocket,
});

test("a mirrored socket rest factors into a rigid frame and one diagonal that includes the reflection", () => {
  const { attachment: a, socket: s } = attachment({ rest: SOCKET_R.toArray(), restScale: [-1, 1, 1] }, [1.5, 1.5, 1.5]);
  const { frame, scale } = sourceAttachmentFrame(a, s);
  assert.deepEqual(scale.toArray(), [-1.5, 1.5, 1.5]);
  assert.ok(Math.abs(frame.determinant() - 1) < 1e-9, `frame determinant ${frame.determinant()}`);
  const recomposed = frame.clone().multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z));
  const rest = sourceAttachmentRest(a, s);
  assert.ok(recomposed.elements.every((v, i) => Math.abs(v - rest.elements[i]) < 1e-12), "frame * scale is the rest");
  // Independently: the reflection is the socket's, so the rest is the unmirrored rest reflected in X
  // before the part's own local transform, not after it.
  const plain = attachment({ rest: SOCKET_L.toArray(), restScale: [1, 1, 1] }, [1.5, 1.5, 1.5]);
  const expected = SOCKET_L.clone().multiply(new THREE.Matrix4().makeScale(-1, 1, 1))
    .multiply(sourceAttachmentRest(plain.attachment, { rest: new THREE.Matrix4().toArray(), restScale: [1, 1, 1] }));
  assert.ok(rest.elements.every((v, i) => Math.abs(v - expected.elements[i]) < 1e-9), "mirror applies at the socket");
});

test("a mirrored attachment reflects its own vertices once, reverses winding and flips the bitangent sign", () => {
  const { bone, inverse } = driver(SOCKET_R.clone().multiply(new THREE.Matrix4().makeScale(-1, 1, 1)));
  const source = section();
  const original = { position: [...(source.geometry.getAttribute("position").array as Float32Array)],
    index: [...(source.geometry.getIndex()!.array as ArrayLike<number>)] };
  const { attachment: a, socket: s } = attachment({ rest: SOCKET_R.toArray(), restScale: [-1, 1, 1] });
  const mesh = attachSourceStatic(source, a, bone, inverse, s);
  assert.deepEqual(mesh.userData.sourceAttachmentScale, [-1, 1, 1]);
  assert.notEqual(mesh.geometry, source.geometry, "the shared source geometry is never reflected in place");
  assert.deepEqual([...(source.geometry.getAttribute("position").array as Float32Array)], original.position);
  assert.deepEqual([...(mesh.geometry.getIndex()!.array as ArrayLike<number>)],
    [original.index[0], original.index[2], original.index[1]], "reversed winding keeps front faces forward");
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), i);
    const q = new THREE.Vector3().fromBufferAttribute(source.geometry.getAttribute("position"), i);
    assert.ok(p.distanceTo(new THREE.Vector3(-q.x, q.y, q.z)) < 1e-6, `vertex ${i} reflected once`);
    const n = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("normal"), i);
    assert.ok(n.distanceTo(new THREE.Vector3(-NORMALS[i].x, NORMALS[i].y, NORMALS[i].z)) < 1e-6, `normal ${i}`);
    const t = mesh.geometry.getAttribute("tangent") as THREE.BufferAttribute;
    assert.equal(t.getW(i), i === 1 ? 1 : -1, `bitangent sign ${i}`);
  }
  // The drawn world transform stays rigid, so the reflected vertices are drawn exactly at the rest.
  const rest = sourceAttachmentRest(a, s);
  mesh.updateMatrixWorld(true);
  for (let i = 0; i < 3; i++) {
    const drawn = mesh.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), i))
      .applyMatrix4(mesh.matrixWorld);
    const expected = new THREE.Vector3().fromBufferAttribute(source.geometry.getAttribute("position"), i).applyMatrix4(rest);
    assert.ok(drawn.distanceTo(expected) < 1e-6, `drawn vertex ${i}: ${drawn.toArray()} != ${expected.toArray()}`);
  }
});

test("a socket rest that is not a rigid frame times its own diagonal is rejected", () => {
  const { bone, inverse } = driver(SOCKET_R);
  const sheared = SOCKET_L.clone().multiply(new THREE.Matrix4().set(1, 0.3, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
  const { attachment: a, socket: s } = attachment({ rest: sheared.toArray(), restScale: [1, 1, 1] });
  assert.throws(() => attachSourceStatic(section(), a, bone, inverse, s), /Invalid source attachment frame/);
  for (const restScale of [[0, 1, 1], [Number.NaN, 1, 1]] as Vec3[])
    assert.throws(() => attachSourceStatic(section(), attachment({ rest: SOCKET_R.toArray(), restScale }).attachment,
      bone, inverse, { rest: SOCKET_R.toArray(), restScale }), /Invalid source attachment frame/);
});
