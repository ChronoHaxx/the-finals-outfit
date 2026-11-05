import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { sourceAttachmentRest } from "../../src/rig/SourceAttachment.ts";
import { resolveSourceRigParts, type AssemblyAssets, type SourceOutfit } from "../../src/rig/SourceAssembly.ts";

// Backpacks, gun bags and back swords name AttachmentSocket upperback_attachment with no optional mesh. That socket is
// neither a body bone nor a bone of an optional mesh: the mesh-merge target skeleton defines it as a SkeletalMeshSocket
// on the body bone spine_03 (wave 38, _docs/goal-100-2026-10-11/upperback-frames). The index records it under
// attachmentFrames.bodySockets; the resolver binds it as a frame anchored on that body bone, and an index without the
// record keeps the old refusal byte for byte.

const MESH = "/Game/Test/SM_Backpack.SM_Backpack", MI = "/Game/Test/MI_Backpack.MI_Backpack";
const SKELETON = "/Game/Test/SK_MergeTarget_Skeleton.SK_MergeTarget_Skeleton";
const SPINE = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.25, -0.007),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, 0, -1.5707963)), new THREE.Vector3(1, 1, 1));
const SOCKET = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.41, -0.134),
  new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
const socket = (bone: string, parentRest: THREE.Matrix4, rest: THREE.Matrix4) =>
  ({ bone, parentRest: parentRest.toArray(), rest: rest.toArray(), restScale: [1, 1, 1] as [number, number, number] });

function assets(withSocket = true, overrides: Partial<NonNullable<AssemblyAssets["attachmentFrames"]>> = {}): AssemblyAssets {
  return {
    formatVersion: 1,
    meshes: { [MESH]: { url: "backpack.glb", kind: "static", slots: [{ slot: "Backpack", material: MI }] } },
    materials: { [MI]: "backpack.json" },
    attachmentBody: { source: "body", url: "body.glb", restBones: { spine_03: SPINE.toArray() } },
    attachmentFrames: { headComponents: {}, optionalMeshes: {},
      ...(withSocket ? { bodySockets: { [SKELETON]: { sourceSha256: "skeleton-sha", sockets: {
        upperback_attachment: socket("spine_03", SPINE, SOCKET) } } } } : {}),
      ...overrides },
  };
}

function item(definition: Record<string, unknown>): SourceOutfit["items"][string] {
  return { source: "DA_Backpack", hidden: false, materialParameters: [], parts: [{ sourceIndex: 0, staticMesh: MESH,
    skeletalMesh: "", effect: "", hidden: false, rules: [], unresolved: [], materials: {},
    definition: { StaticMesh: { AssetPathName: MESH }, SkeletalMesh: { AssetPathName: "" }, Effect: { AssetPathName: "" },
      TagOverrides: [], bIsAttached: true, AttachmentSocket: "upperback_attachment",
      LocalPosition: { X: 50.98, Y: 19.03, Z: -134.83 }, LocalRotation: { Pitch: 22.99, Yaw: 3.68, Roll: -0.19 },
      LocalScale: { X: 1, Y: 1, Z: 1 }, ...definition } as never }] };
}

test("an index without bodySockets keeps refusing a non-bone body socket exactly as before", () => {
  assert.throws(() => resolveSourceRigParts(item({}), assets(false)), /^Error: Missing preserved source attachment frame$/);
});

test("a recorded body skeleton socket binds as a body-socket frame anchored on the preserved body bone", () => {
  const [part] = resolveSourceRigParts(item({}), assets());
  const frame = part.attachment?.frame;
  assert.equal(part.attachment?.socket, "upperback_attachment");
  assert.equal(part.attachment?.sourceRestMatrix, undefined, "the socket is not a body bone");
  assert.equal(frame?.kind, "body-socket");
  const component = frame?.kind === "body-socket" ? frame.component : undefined;
  assert.equal(component?.source, SKELETON);
  assert.equal(component?.sourceSha256, "skeleton-sha");
  assert.equal(component?.bone, "spine_03");
  assert.equal(component?.bodyBone, true);
  assert.deepEqual(component?.rest, SOCKET.toArray());
  // The rig composes socket rest x authored local transform, as for every other frame kind.
  const rest = sourceAttachmentRest(part.attachment!, { rest: component!.rest, restScale: component!.restScale });
  assert.ok(rest.elements.every(Number.isFinite));
});

test("a body bone named like the socket still wins: the frame is only a fallback", () => {
  const bone = assets();
  bone.attachmentBody!.restBones.upperback_attachment = SOCKET.toArray();
  const [part] = resolveSourceRigParts(item({}), bone);
  assert.deepEqual(part.attachment?.sourceRestMatrix, SOCKET.toArray());
  assert.equal(part.attachment?.frame, undefined);
});

test("the body socket fails closed: anchor off the body rest, a non-body anchor, two owners, a damaged record", () => {
  const moved = assets();
  moved.attachmentFrames!.bodySockets![SKELETON].sockets.upperback_attachment.parentRest =
    new THREE.Matrix4().makeTranslation(0, 0.01, 0).multiply(SPINE).toArray();
  assert.throws(() => resolveSourceRigParts(item({}), moved), /anchor is not the preserved body rest: spine_03/);
  const foreign = assets();
  foreign.attachmentFrames!.bodySockets![SKELETON].sockets.upperback_attachment.bone = "backpack_root";
  assert.throws(() => resolveSourceRigParts(item({}), foreign), /Body skeleton socket anchor is not the preserved body rest: backpack_root/);
  const twice = assets();
  twice.attachmentFrames!.bodySockets!["/Game/Test/Other.Other"] = twice.attachmentFrames!.bodySockets![SKELETON];
  assert.throws(() => resolveSourceRigParts(item({}), twice), /^Error: Missing preserved source attachment frame$/);
  const damaged = assets();
  (damaged.attachmentFrames!.bodySockets![SKELETON].sockets.upperback_attachment as { rest: unknown }).rest = [1, 2];
  assert.throws(() => resolveSourceRigParts(item({}), damaged), /Missing preserved body skeleton socket frame: upperback_attachment/);
});

test("a body socket never serves a head-attached or optional-mesh part", () => {
  assert.throws(() => resolveSourceRigParts(item({ bAttachToHeadMesh: true }), assets()),
    /Missing preserved head component frame: upperback_attachment/);
  assert.throws(() => resolveSourceRigParts(item({ OptionalAttachmentMesh: { AssetPathName: "/Game/Test/SK_Opt.SK_Opt" } }), assets()),
    /Missing preserved optional attachment mesh frame: upperback_attachment/);
});
