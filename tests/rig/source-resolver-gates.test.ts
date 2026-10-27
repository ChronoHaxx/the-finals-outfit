import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { attachSourceStatic, sourceAttachmentRest } from "../../src/rig/SourceAttachment.ts";
import { assemblyResolveGates, attachmentMirroredScaleGate, activatedEffectPartsGate, inertMergedPartTransform,
  mergedPartTransformsGate, neutralSourceHeadFrame, resolveSourceOutfit, resolveSourceRigParts,
  type AssemblyAssets, type ResolvedPart, type SourceDefinition, type SourceOutfit } from "../../src/rig/SourceAssembly.ts";

// The two gated resolver relaxations (w45-resolver), each with its own index field and dev URL
// switch. Gate off (every index today) must be exactly today's behaviour; the tests below hold both
// sides to that. The authored values are the catalog's own: earring_05_r of
// bodycosmetics-earrings-angel-01 (LocalScale -1.141307, 0.861943, 1.141307) and the three helmet
// definitions' nonattached merged parts. Everything else here is synthetic index data.

const BODY = "/Game/Discovery/Characters/Body/SK_Body_M.SK_Body_M";
const MESH = "/Game/Discovery/Characters/Space/Assets/AstronautHelmet/SK_Space_AstronautHelmet_M.SK_Space_AstronautHelmet_M";
const SM = "/Game/Discovery/Characters/BodyCosmetics/Earrings/Test/SM_Earrings_Test_Single.SM_Earrings_Test_Single";
const MI = "/Game/Stub/MI_Helmet.MI_Helmet";

// SK_Body_M's `head` rest, converted (GLB) axes, as the neutral-frame tests record it.
const HEAD_REST = [
  2.5787347538459216e-07, 0.9662225716324597, -0.2577090825764894, 0,
  -1.0000001192089563, 1.1254719131705552e-07, -5.786674512118003e-07, 0,
  -5.301170100288239e-07, 0.25770914218134233, 0.966222512027538, 0,
  1.162334694454861e-06, 1.6811438197924242, -0.03551814923580808, 1,
];

const SOFT = (assetPath = "") => ({ AssetPathName: assetPath, SubPathString: "" });
const NEUTRAL_ROTATION = { Pitch: -90, Yaw: 159.44395, Roll: -144.5098 };

function placement(overrides: Record<string, unknown> = {}): ResolvedPart["definition"] {
  return {
    StaticMesh: SOFT(), SkeletalMesh: SOFT(MESH), Effect: SOFT(), TagOverrides: [],
    bVisibleInFirstPerson: false, bCanBeMerged: true, bIsHeadMesh: false, OptionalHeadWrapMesh: SOFT(),
    bIsAttached: false, bAttachToHeadMesh: false, OptionalAttachmentMesh: SOFT(),
    AttachmentSocket: "head", bLimitMergedLod: false, MaxMergedLodIndex: 3,
    LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
    LocalScale: { X: 1, Y: 1, Z: 1 }, LogicModules: [],
    WrapDeformation: { bIsWrapDeformed: false, bIsWrapDeformedByHeadComponent: false,
      DisabledByTags: [], OptionalWrapDeformerMesh: SOFT() },
    ...overrides,
  } as unknown as ResolvedPart["definition"];
}

function item(overrides: Record<string, unknown> = {},
  resolved: Partial<ResolvedPart> = {}): SourceOutfit["items"][string] {
  const part: ResolvedPart = { sourceIndex: 0, staticMesh: "", skeletalMesh: MESH, effect: "", hidden: false,
    rules: [], unresolved: [], materials: {}, definition: placement(overrides), ...resolved };
  return { source: "DA_Space_AstronautHelmet_Plastic", hidden: false, materialParameters: [], parts: [part] };
}

function assets(overrides: Partial<AssemblyAssets> = {}): AssemblyAssets {
  return {
    formatVersion: 1,
    meshes: { [MESH]: { url: "helmet.glb", kind: "skeletal", slots: [{ slot: "Helmet", material: MI }] },
      [SM]: { url: "earring.glb", kind: "static", slots: [{ slot: "Earring", material: MI }] } },
    materials: { [MI]: "helmet.json" },
    attachmentBody: { source: BODY, url: "body.glb", restBones: { head: HEAD_REST } },
    ...overrides,
  };
}

// Gate 2 fixtures: the authored nonattached merged transform of DA_Space_AstronautHelmet_Plastic
// (socket neck_01) — mergeable, own skeletal mesh, every other condition of the neutral route met.
const HELMET = { AttachmentSocket: "neck_01",
  LocalPosition: { X: -149.09001, Y: 39.916553, Z: -0.003087 },
  LocalRotation: { Pitch: -90.0, Yaw: 172.87498, Roll: 173.94353 }, LocalScale: { X: 1, Y: 1, Z: 1 } };
const INERT = { mergedPartTransforms: true };
const MIRRORED = { attachmentMirroredScale: true };

test("the gate spellings are refused rather than guessed, and absent means off", () => {
  for (const gate of [attachmentMirroredScaleGate, mergedPartTransformsGate, activatedEffectPartsGate]) {
    assert.equal(gate(undefined), false);
    assert.throws(() => gate("on"), /Unknown/);
    assert.throws(() => gate("Nonzero"), /Unknown/);
  }
  assert.equal(attachmentMirroredScaleGate("nonzero"), true);
  assert.equal(mergedPartTransformsGate("inert"), true);
  assert.equal(activatedEffectPartsGate("drop"), true);
  const off = { attachmentMirroredScale: false, mergedPartTransforms: false,
    facialHairForeignOverlays: false, activatedEffectParts: false };
  const index = assets();
  assert.deepEqual(assemblyResolveGates(index), off);
  assert.deepEqual(assemblyResolveGates(assets({ attachmentMirroredScale: "nonzero", mergedPartTransforms: "inert" })),
    { ...off, attachmentMirroredScale: true, mergedPartTransforms: true });
  assert.throws(() => assemblyResolveGates(assets({ mergedPartTransforms: "ignore" })), /Unknown merged part transforms/);
  // The facial-hair foreign-overlay gate (w50-hair-facial) follows the same spelling rule.
  assert.throws(() => assemblyResolveGates(assets({ facialHairForeignOverlays: "all-slots" })),
    /Unknown facial hair foreign overlays/);
  assert.equal(assemblyResolveGates(assets({ facialHairForeignOverlays: "own-slots" })).facialHairForeignOverlays, true);
  // The activated-effect-part gate (w61) follows it too, from the index field or the override.
  assert.throws(() => assemblyResolveGates(assets({ activatedEffectParts: "keep" })), /Unknown activated effect parts/);
  assert.equal(assemblyResolveGates(assets({ activatedEffectParts: "drop" })).activatedEffectParts, true);
  assert.deepEqual(assemblyResolveGates(assets(), { activatedEffectParts: "drop" }),
    { ...off, activatedEffectParts: true });
  // A capture-only override wins over the index for that capture only, when it is set at all;
  // an unset switch falls back to the index, exactly as the body-type and hair-precedence switches do.
  assert.deepEqual(assemblyResolveGates(assets(), { mergedPartTransforms: "inert" }),
    { ...off, mergedPartTransforms: true });
  assert.deepEqual(assemblyResolveGates(assets(), { facialHairForeignOverlays: "own-slots" }),
    { ...off, facialHairForeignOverlays: true });
});

test("the inert merged part is refused with the gate off and resolved with it on, from the index field or the override", () => {
  const selected = item(HELMET);
  assert.equal(neutralSourceHeadFrame(selected.parts[0], assets()), false);
  assert.equal(inertMergedPartTransform(selected.parts[0], assets()), true);
  // Gate off: exactly today's refusal.
  assert.throws(() => resolveSourceRigParts(selected, assets()), /Unsupported source assembly part 0/);
  // Gate on through the explicit gate...
  const [part] = resolveSourceRigParts(selected, assets(), path => path, INERT);
  assert.equal(part.inertMergedTransform, true);
  assert.equal(part.neutralHeadFrame, undefined);
  assert.equal(part.attachment, undefined); // identity placement, exactly as an identity-transform part
  assert.equal(part.sourceMesh, MESH);
  assert.deepEqual(part.materials, { Helmet: { url: "helmet.json", source: MI } });
  // ...and through the index field the preview sets.
  const [fromIndex] = resolveSourceRigParts(selected, assets({ mergedPartTransforms: "inert" }));
  assert.equal(fromIndex.inertMergedTransform, true);
});

test("the neutral compensated head frame route is unchanged by the inert gate", () => {
  const neutral = item({ LocalPosition: { X: -163.35124, Y: -39.89272, Z: 0 }, LocalRotation: NEUTRAL_ROTATION });
  assert.equal(neutralSourceHeadFrame(neutral.parts[0], assets()), true);
  const [off] = resolveSourceRigParts(neutral, assets());
  assert.equal(off.neutralHeadFrame, true);
  assert.equal(off.inertMergedTransform, undefined);
  const [on] = resolveSourceRigParts(neutral, assets(), path => path, INERT);
  assert.equal(on.neutralHeadFrame, true);
  assert.equal(on.inertMergedTransform, undefined);
});

for (const [name, overrides, resolved, refused] of [
  ["a non-mergeable part", { bCanBeMerged: false }, {}, /Unsupported source assembly part 0/],
  // An attached part keeps the attached route's own requirements: the inert gate never rescues it
  // with an identity placement (this one's socket is not preserved).
  ["an attached part", { StaticMesh: SOFT(SM), SkeletalMesh: SOFT(), bIsAttached: true },
    { staticMesh: SM, skeletalMesh: "" }, /Missing preserved source attachment frame/],
  ["a static mesh with bIsAttached false", { StaticMesh: SOFT(SM), SkeletalMesh: SOFT() },
    { staticMesh: SM, skeletalMesh: "" }, /Unsupported source assembly part 0/],
  ["a head mesh role", { bIsHeadMesh: true }, {}, /Unsupported source assembly part 0/],
  ["a head-component attachment", { bAttachToHeadMesh: true }, {}, /Unsupported source assembly part 0/],
  ["an optional attachment mesh", { OptionalAttachmentMesh: SOFT(SM) }, {}, /Unsupported source assembly part 0/],
  ["an effect part", { Effect: SOFT("/Game/Stub/NS_Effect.NS_Effect") },
    { effect: "/Game/Stub/NS_Effect.NS_Effect" }, /Unsupported source assembly part 0/],
  ["logic modules", { LogicModules: [{ Class: "Stub" }] }, {}, /Unsupported source assembly part 0/],
  ["an unresolved rule", {}, { unresolved: ["unsupported placement or logic override 0"] },
    /Unsupported source assembly part 0/],
  ["a wrap deformation", { WrapDeformation: { bIsWrapDeformed: true, bIsWrapDeformedByHeadComponent: false,
    DisabledByTags: [], OptionalWrapDeformerMesh: SOFT() } }, {}, /Unsupported source assembly part 0/],
] as [string, Record<string, unknown>, Partial<ResolvedPart>, RegExp][]) {
  test(`the inert gate still refuses: ${name}`, () => {
    const selected = item({ ...HELMET, ...overrides }, resolved);
    assert.equal(inertMergedPartTransform(selected.parts[0], assets()), false);
    assert.throws(() => resolveSourceRigParts(selected, assets(), path => path, INERT), refused);
  });
}

test("an ordinary identity placement is unchanged by the inert gate, whatever socket it names", () => {
  // Identity transform with a non-head socket resolves as an ordinary skinned part today; the gate
  // must neither refuse it nor mark it (a catalog example is the welding goggles' mouth scarf).
  for (const socket of ["head", "neck_01", undefined]) {
    const selected = item({ AttachmentSocket: socket });
    const [off] = resolveSourceRigParts(selected, assets());
    const [on] = resolveSourceRigParts(selected, assets(), path => path, INERT);
    assert.equal(on.inertMergedTransform, undefined, String(socket));
    assert.equal(on.neutralHeadFrame, undefined, String(socket));
    assert.deepEqual(on, off, String(socket));
  }
});

// Gate 1 fixtures: the authored mirrored scale of earring_05_r on the attached static route.
function earring(scale: { X: number; Y: number; Z: number }): SourceOutfit["items"][string] {
  return item({ StaticMesh: SOFT(SM), SkeletalMesh: SOFT(), bIsAttached: true, AttachmentSocket: "head",
    LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 }, LocalScale: scale },
    { staticMesh: SM, skeletalMesh: "" });
}

test("a mirrored authored attachment scale is refused with the gate off and admitted with it on", () => {
  const scale = { X: -1.141307, Y: 0.861943, Z: 1.141307 };
  const selected = earring(scale);
  assert.throws(() => resolveSourceRigParts(selected, assets()), /Unsupported source attachment transform/);
  const [part] = resolveSourceRigParts(selected, assets(), path => path, MIRRORED);
  assert.equal(part.attachment!.mirroredScale, true);
  assert.deepEqual(part.attachment!.scale, [-1.141307, 0.861943, 1.141307]);
  assert.equal(part.inertMergedTransform, undefined);
  // The index field carries the gate too.
  const [fromIndex] = resolveSourceRigParts(selected, assets({ attachmentMirroredScale: "nonzero" }));
  assert.equal(fromIndex.attachment!.mirroredScale, true);
});

test("zero and non-finite authored attachment scales stay refused under the mirrored gate", () => {
  for (const scale of [{ X: 0, Y: 1, Z: 1 }, { X: Number.NaN, Y: 1, Z: 1 },
    { X: Number.POSITIVE_INFINITY, Y: 1, Z: 1 }]) {
    assert.throws(() => resolveSourceRigParts(earring(scale), assets(), path => path, MIRRORED),
      /Unsupported source attachment transform/);
  }
});

test("a positive authored scale never carries the mirrored flag, with the gate on or off", () => {
  for (const gates of [undefined, MIRRORED]) {
    const [part] = resolveSourceRigParts(earring({ X: 0.861943, Y: 0.861943, Z: 0.861943 }), assets(), path => path, gates);
    assert.equal(part.attachment!.mirroredScale, undefined);
  }
});

// The rig side of the mirrored path (SourceAttachment): the existing reverseWinding and
// frame = rest * scale^-1 route applies unchanged; only the positive-scale refusal is gated.
const SOCKET = new THREE.Matrix4().compose(new THREE.Vector3(0.02, 1.61, -0.03),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.8, 0.2)), new THREE.Vector3(1, 1, 1));
type Vec3 = [number, number, number];

function indexedSection(): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(
    [0.05, 0.1, 0.02, -0.04, 0.12, 0.08, 0.01, -0.07, 0.1, 0.05, 0.05, 0.05, -0.04, 0.14, 0.06, 0.02, -0.05, 0.08], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(
    [0.3, 0.5, 0.81, -0.7, 0.1, 0.7, 0, -0.6, 0.8, 0.3, 0.5, 0.81, -0.7, 0.1, 0.7, 0, -0.6, 0.8], 3));
  const tangent = new THREE.Vector3(1, 0, 0).cross(new THREE.Vector3(0.3, 0.5, 0.81).normalize()).normalize();
  geometry.setAttribute("tangent", new THREE.Float32BufferAttribute(
    [tangent.x, tangent.y, tangent.z, 1, tangent.x, tangent.y, tangent.z, -1,
     tangent.x, tangent.y, tangent.z, 1, tangent.x, tangent.y, tangent.z, -1,
     tangent.x, tangent.y, tangent.z, 1, tangent.x, tangent.y, tangent.z, -1], 4));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  new THREE.Group().add(mesh);
  return mesh;
}

function driver() {
  const root = new THREE.Group(), bone = new THREE.Bone();
  bone.name = "head";
  SOCKET.decompose(bone.position, bone.quaternion, bone.scale);
  root.add(bone); root.updateMatrixWorld(true);
  return { root, bone, inverse: bone.matrixWorld.clone().invert() };
}

const mirroredAttachment = (scale: Vec3, mirroredScale?: true) => ({ bodyUrl: "body.glb", socket: "head",
  sourceRestMatrix: SOCKET.toArray() as number[], position: [0, 0, 0] as Vec3,
  rotation: [0, 0, 0] as Vec3, scale, ...(mirroredScale ? { mirroredScale } : {}) });

test("attachSourceStatic applies the existing mirrored path when the resolver gate admitted the scale", () => {
  const { bone, inverse } = driver(), source = indexedSection();
  const originalIndex = [...(source.geometry.getIndex()!.array as ArrayLike<number>)];
  const originalTangents = [...(source.geometry.getAttribute("tangent").array as ArrayLike<number>)];
  const a = mirroredAttachment([-1.141307, 0.861943, 1.141307], true);
  const mesh = attachSourceStatic(source, a, bone, inverse);
  // The frame stays a proper rotation: det(rest) and det(scale) are both negative.
  assert.ok(Math.abs(mesh.matrix.clone().multiply(new THREE.Matrix4().makeScale(-1.141307, 1.141307, 0.861943))
    .determinant() - sourceAttachmentRest(a).determinant()) < 1e-9);
  assert.deepEqual(mesh.userData.sourceAttachmentScale, [-1.141307, 1.141307, 0.861943]);
  // Mirrored: the private copy reverses the triangle order and the tangent sign, the source is untouched.
  const index = mesh.geometry.getIndex()!;
  assert.deepEqual([...(index.array as ArrayLike<number>)], [0, 2, 1, 3, 5, 4]);
  assert.deepEqual([...(source.geometry.getIndex()!.array as ArrayLike<number>)], originalIndex);
  const tangent = mesh.geometry.getAttribute("tangent") as THREE.BufferAttribute;
  for (let i = 0; i < tangent.count; i++)
    assert.equal(tangent.getW(i), -originalTangents[i * 4 + 3], `tangent w ${i}`);
  assert.deepEqual([...(source.geometry.getAttribute("tangent").array as ArrayLike<number>)], originalTangents);
});

test("attachSourceStatic refuses a non-positive scale without the gate flag, and zero or nonfinite with it", () => {
  const { bone, inverse } = driver();
  assert.throws(() => attachSourceStatic(indexedSection(), mirroredAttachment([-1.141307, 0.861943, 1.141307]), bone, inverse),
    /Invalid source attachment frame/);
  for (const scale of [[0, 1, 1], [Number.NaN, 1, 1], [1, Number.POSITIVE_INFINITY, 1]] as Vec3[])
    assert.throws(() => attachSourceStatic(indexedSection(), mirroredAttachment(scale, true), bone, inverse),
      /Invalid source attachment frame/);
});

test("the whole outfit path resolves the angel earring part with both routes of the catalog definition", () => {
  // earring_05_r as the source authors it: attached static, head-component socket, mirrored scale.
  const id = "bodycosmetics-earrings-angel-01";
  const definition = {
    formatVersion: 1, id, source: "DA_BodyCosmetics_Earrings_Angel_01", sourceSha256: "stub",
    properties: { Slots: ["Earrings"], VisualParts: [placement({ StaticMesh: SOFT(SM), SkeletalMesh: SOFT(),
      bIsAttached: true, bAttachToHeadMesh: true, AttachmentSocket: "earring_05_r",
      LocalPosition: { X: 0, Y: 8.881784e-16, Z: 0 }, LocalRotation: { Pitch: -15.954233, Yaw: 38.603218, Roll: 99.20922 },
      LocalScale: { X: -1.141307, Y: 0.861943, Z: 1.141307 } })] },
  } as unknown as SourceDefinition;
  const resolved = resolveSourceOutfit([definition], ["Customization.Archetype.Medium"]).items[id];
  const parts = { ...assets(), attachmentFrames: { headComponents: { "head-a": { sourceSha256: "stub",
    sockets: { earring_05_r: { bone: "head", parentRest: HEAD_REST, rest: HEAD_REST, restScale: [1, 1, 1] } } } } } };
  // Gate off: today's refusal.
  assert.throws(() => resolveSourceRigParts(resolved, parts), /Unsupported source attachment transform/);
  // Gate on: the mirrored part resolves through its head-component frame.
  const [part] = resolveSourceRigParts(resolved, parts, path => path, MIRRORED);
  assert.equal(part.attachment!.mirroredScale, true);
  assert.equal(part.attachment!.frame!.kind, "head-component");
});
