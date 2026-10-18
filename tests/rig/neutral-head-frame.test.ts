import { test } from "node:test";
import assert from "node:assert/strict";
import { neutralSourceHeadFrame, resolveSourceOutfit, resolveSourceRigParts,
  type AssemblyAssets, type ResolvedPart, type SourceDefinition, type SourceOutfit } from "../../src/rig/SourceAssembly.ts";
import { multiplySourceMatrices, sourceIdentityDeviation, sourceLocalMatrix } from "../../src/rig/SourceTransform.ts";

// A nonattached, mergeable skeletal hair part is supported only when its authored local transform
// is exactly the inverse of the preserved body's own `head` rest, so that rest * local is the
// identity and the mesh is drawn where an identity placement would draw it. The rest and both
// authored rotators below are the source metadata the evidence packet records; everything else
// here is synthetic index data, and none of it claims native or browser verification.

const BODY = "/Game/Discovery/Characters/Body/SK_Body_M.SK_Body_M";
const MESH = "/Game/Discovery/Characters/Hairs/BobCurly/SK_BobCurly_M.SK_BobCurly_M";
const MI = "/Game/Stub/MI_Hair.MI_Hair";
const MI_OVERRIDE = "/Game/Stub/MI_Hair_Black.MI_Hair_Black";
const SM = "/Game/Stub/SM_Pin.SM_Pin";
const NS = "/Game/Stub/NS_Effect.NS_Effect";

// SK_Body_M's `head` rest, converted (GLB) axes, exactly as the packet records it.
const HEAD_REST = [
  2.5787347538459216e-07, 0.9662225716324597, -0.2577090825764894, 0,
  -1.0000001192089563, 1.1254719131705552e-07, -5.786674512118003e-07, 0,
  -5.301170100288239e-07, 0.25770914218134233, 0.966222512027538, 0,
  1.162334694454861e-06, 1.6811438197924242, -0.03551814923580808, 1,
];
// The largest identity deviation the packet reports over all 48 rows, in any of the 16 elements.
const MEASURED_IDENTITY_ERROR = 9.5257327e-7;

// Two differently written rotators from the packet. At pitch -90 the yaw and roll axes coincide,
// and 159.44395 - 144.5098 is the same 14.934155 frame; the Z the packet records is a literal 0 in
// some groups and a float32 zero in others.
const NEUTRAL = [
  { name: "BobCurly/LongCurly rotator, float32 zero Z",
    LocalPosition: { X: -163.35124, Y: -39.89272, Z: -5.684342e-14 },
    LocalRotation: { Pitch: -90, Yaw: 159.44395, Roll: -144.5098 } },
  { name: "DoubleBunHangingBraids rotator, exact zero Z",
    LocalPosition: { X: -163.35124, Y: -39.89272, Z: 0 },
    LocalRotation: { Pitch: -90, Yaw: 159.44395, Roll: -144.5098 } },
  { name: "FrontBraids/Goth rotator, yaw folded into roll",
    LocalPosition: { X: -163.35124, Y: -39.89272, Z: 0 },
    LocalRotation: { Pitch: -90, Yaw: 0, Roll: 14.934155 } },
];

const SOFT = (assetPath = "") => ({ AssetPathName: assetPath, SubPathString: "" });

function placement(overrides: Record<string, unknown> = {}): ResolvedPart["definition"] {
  return {
    StaticMesh: SOFT(), SkeletalMesh: SOFT(MESH), Effect: SOFT(), TagOverrides: [],
    bVisibleInFirstPerson: false, bCanBeMerged: true, bIsHeadMesh: false, OptionalHeadWrapMesh: SOFT(),
    bIsAttached: false, bAttachToHeadMesh: false, OptionalAttachmentMesh: SOFT(),
    AttachmentSocket: "head", bLimitMergedLod: false, MaxMergedLodIndex: 3,
    LocalPosition: { ...NEUTRAL[0].LocalPosition }, LocalRotation: { ...NEUTRAL[0].LocalRotation },
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
  return { source: "DA_Hairs_BobCurly_Black", hidden: false, materialParameters: [], parts: [part] };
}

function assets(overrides: Partial<AssemblyAssets> = {}): AssemblyAssets {
  return {
    formatVersion: 1,
    meshes: { [MESH]: { url: "hair.glb", kind: "skeletal", slots: [{ slot: "Hair", material: MI }] },
      [SM]: { url: "pin.glb", kind: "static", slots: [{ slot: "Pin", material: MI }] } },
    materials: { [MI]: "hair.json", [MI_OVERRIDE]: "hair-black.json" },
    attachmentBody: { source: BODY, url: "body.glb", restBones: { head: HEAD_REST } },
    ...overrides,
  };
}

const body = (restBones: Record<string, number[]>) =>
  assets({ attachmentBody: { source: BODY, url: "body.glb", restBones } });

test("the authored local transform inverts the preserved head rest for both written rotators", () => {
  for (const { name, LocalPosition, LocalRotation } of NEUTRAL) {
    const local = sourceLocalMatrix([LocalPosition.X, LocalPosition.Y, LocalPosition.Z],
      [LocalRotation.Pitch, LocalRotation.Yaw, LocalRotation.Roll], [1, 1, 1]);
    const deviation = sourceIdentityDeviation(multiplySourceMatrices(HEAD_REST, local));
    const worst = Math.max(deviation.translation, deviation.linear, deviation.affine);
    // The same product, to the last significant digit, that the packet recorded for these rows.
    assert.ok(Math.abs(worst - MEASURED_IDENTITY_ERROR) < 1e-12,
      `${name}: ${worst} != ${MEASURED_IDENTITY_ERROR} (${JSON.stringify(deviation)})`);
  }
});

test("a neutral compensated head frame resolves, keeping every binding and source identity", () => {
  for (const { name, LocalPosition, LocalRotation } of NEUTRAL) {
    const selected = item({ LocalPosition, LocalRotation });
    assert.equal(neutralSourceHeadFrame(selected.parts[0], assets()), true, name);
    assert.deepEqual(resolveSourceRigParts(selected, assets()), [{
      sourceIndex: 0, sourceMesh: MESH, url: "hair.glb",
      materials: { Hair: { url: "hair.json", source: MI } },
      attachment: undefined, bodyMaskUvTiles: undefined, bodyMaskUrl: undefined,
      neutralHeadFrame: true,
    }], name);
  }
});

test("the whole outfit path accepts one, with its own rules and material override intact", () => {
  const id = "hairs-bobcurly-black";
  const rule = (tag: string, skeletal: string) => ({
    MatchingTags: [tag], bOverrideMesh: true, ReplacementStaticMesh: SOFT(),
    ReplacementSkeletalMesh: SOFT(skeletal), bOverrideEffect: false, ReplacementEffect: SOFT(),
    bOverrideMaterials: false, MaterialOverrides: [],
  });
  const definition = {
    formatVersion: 1, id, source: "DA_Hairs_BobCurly_Black", sourceSha256: "stub",
    properties: {
      Slots: ["Hair"], ActivatesTags: [],
      MaterialOverrides: [{ Key: "Hair", Value: SOFT(MI_OVERRIDE) }],
      VisualParts: [placement({ TagOverrides: [
        rule("Customization.Archetype.Light", "/Game/Stub/SK_BobCurly_L.SK_BobCurly_L"),
        rule("Customization.Archetype.Heavy", "/Game/Stub/SK_BobCurly_H.SK_BobCurly_H"),
        rule("Customization.Shape.PushHair.hat_covers_head", ""),
      ] })],
    },
  } as unknown as SourceDefinition;
  const outfit = resolveSourceOutfit([definition], ["Customization.Archetype.Medium"]);
  const hair = outfit.items[id];
  assert.deepEqual(hair.parts.map(p => [p.hidden, p.unresolved, p.rules, p.skeletalMesh, p.staticMesh]),
    [[false, [], [], MESH, ""]]);
  const [part] = resolveSourceRigParts(hair, assets(), path => `https://example.invalid/${path}`);
  assert.equal(part.neutralHeadFrame, true);
  assert.equal(part.sourceMesh, MESH);
  assert.equal(part.url, "https://example.invalid/hair.glb");
  assert.equal(part.attachment, undefined);
  assert.deepEqual(part.materials, { Hair: { url: "https://example.invalid/hair-black.json", source: MI_OVERRIDE } });
  // The resolver never rewrites what the source authored.
  assert.deepEqual(hair.parts[0].definition.LocalPosition, NEUTRAL[0].LocalPosition);
  assert.deepEqual(hair.parts[0].definition.LocalRotation, NEUTRAL[0].LocalRotation);
});

test("an ordinary identity placement is unchanged, with or without a preserved body", () => {
  const identity = { LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
    LocalScale: { X: 1, Y: 1, Z: 1 } };
  for (const index of [assets(), body({})]) {
    const selected = item(identity);
    // An identity local transform does not cancel the head rest, so it is not the new route.
    assert.equal(neutralSourceHeadFrame(selected.parts[0], index), false);
    const [part] = resolveSourceRigParts(selected, index);
    assert.equal(part.neutralHeadFrame, undefined);
    assert.equal(part.sourceMesh, MESH);
    assert.equal(part.attachment, undefined);
  }
});

test("the attached static route keeps its own authored transform and rest", () => {
  const selected = item({ StaticMesh: SOFT(SM), SkeletalMesh: SOFT(), bIsAttached: true,
    LocalPosition: { X: 1, Y: 2, Z: 3 }, LocalRotation: { Pitch: 10, Yaw: 20, Roll: 30 },
    LocalScale: { X: 1, Y: 1, Z: 2 } }, { staticMesh: SM, skeletalMesh: "" });
  assert.equal(neutralSourceHeadFrame(selected.parts[0], assets()), false);
  const [part] = resolveSourceRigParts(selected, assets());
  assert.equal(part.neutralHeadFrame, undefined);
  assert.deepEqual(part.attachment, { bodyUrl: "body.glb", socket: "head", sourceRestMatrix: HEAD_REST,
    position: [1, 2, 3], rotation: [10, 20, 30], scale: [1, 1, 2] });
});

test("the converted basis is the existing one: (X, Z, Y) axes, centimetres to metres", () => {
  const matrix = sourceLocalMatrix([1, 2, 3], [0, 0, 0], [4, 5, 6]);
  assert.deepEqual([matrix[12], matrix[13], matrix[14]], [0.01, 0.03, 0.02]);
  assert.deepEqual([matrix[0], matrix[5], matrix[10]], [4, 6, 5]);
  assert.deepEqual([matrix[3], matrix[7], matrix[11], matrix[15]], [0, 0, 0, 1]);
});

// Every counterexample below keeps a nonidentity local transform, so refusing the neutral frame
// must leave the part exactly as unsupported as it is today.
function refused(name: string, overrides: Record<string, unknown>, resolved: Partial<ResolvedPart> = {}) {
  test(`refused: ${name}`, () => {
    const selected = item(overrides, resolved);
    assert.equal(neutralSourceHeadFrame(selected.parts[0], assets()), false);
    assert.throws(() => resolveSourceRigParts(selected, assets()), /Unsupported source assembly part 0/);
  });
}

const POSITION = NEUTRAL[0].LocalPosition, ROTATION = NEUTRAL[0].LocalRotation;

refused("non-neutral translation", { LocalPosition: { ...POSITION, X: -163.34 } });
refused("translation just past the 2e-6 m tolerance", { LocalPosition: { ...POSITION, X: -163.3517400 } });
refused("non-neutral rotation", { LocalRotation: { ...ROTATION, Yaw: 159.5 } });
refused("zero rotation", { LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 } });
// Near-zero authored values are not proof of anything: without the compensation the head rest stays.
refused("near-zero local values", { LocalPosition: { X: 1e-9, Y: 1e-9, Z: 1e-9 },
  LocalRotation: { Pitch: 0, Yaw: 0, Roll: 1e-9 } });
refused("non-unit scale", { LocalScale: { X: 1, Y: 1.0001, Z: 1 } });
refused("zero scale", { LocalScale: { X: 1, Y: 0, Z: 1 } });
refused("mirrored scale", { LocalScale: { X: -1, Y: 1, Z: 1 } });
refused("missing position", { LocalPosition: undefined });
refused("missing rotation", { LocalRotation: undefined });
refused("missing scale", { LocalScale: undefined });
refused("incomplete rotation", { LocalRotation: { Pitch: -90, Yaw: 159.44395 } });
refused("extra position component", { LocalPosition: { ...POSITION, W: 0 } });
refused("non-numeric position", { LocalPosition: { ...POSITION, X: "-163.35124" } });
refused("NaN rotation", { LocalRotation: { ...ROTATION, Yaw: Number.NaN } });
refused("infinite position", { LocalPosition: { ...POSITION, Z: Number.POSITIVE_INFINITY } });
refused("array scale", { LocalScale: [1, 1, 1] });
refused("null rotation", { LocalRotation: null });
refused("missing socket", { AttachmentSocket: undefined });
refused("another body socket", { AttachmentSocket: "spine_03" });
refused("differently spelled socket", { AttachmentSocket: "Head" });
refused("bIsAttached true", { bIsAttached: true });
refused("missing bCanBeMerged", { bCanBeMerged: undefined });
refused("bCanBeMerged false", { bCanBeMerged: false });
refused("truthy non-boolean bCanBeMerged", { bCanBeMerged: 1 });
refused("head component attachment", { bAttachToHeadMesh: true });
refused("optional attachment mesh", { OptionalAttachmentMesh: SOFT(SM) });
refused("head mesh role", { bIsHeadMesh: true });
refused("optional head wrap mesh", { OptionalHeadWrapMesh: SOFT(MESH) });
refused("wrap deformation", { WrapDeformation: { bIsWrapDeformed: true,
  bIsWrapDeformedByHeadComponent: false, OptionalWrapDeformerMesh: SOFT() } });
refused("wrap by head component", { WrapDeformation: { bIsWrapDeformed: false,
  bIsWrapDeformedByHeadComponent: true, OptionalWrapDeformerMesh: SOFT() } });
refused("wrap deformer mesh", { WrapDeformation: { bIsWrapDeformed: false,
  bIsWrapDeformedByHeadComponent: false, OptionalWrapDeformerMesh: SOFT(MESH) } });
refused("head-component wrap with its own deformer mesh", { WrapDeformation: { bIsWrapDeformed: true,
  bIsWrapDeformedByHeadComponent: true, OptionalWrapDeformerMesh: SOFT(MESH) } });
refused("head-component wrap with a head wrap mesh", { OptionalHeadWrapMesh: SOFT(MESH), WrapDeformation: {
  bIsWrapDeformed: true, bIsWrapDeformedByHeadComponent: true, OptionalWrapDeformerMesh: SOFT() } });

// Facial hair: the head component's wrap (both flags, no deformer of its own) is admitted on the neutral frame
// with the same bindings, marked for the rig to follow the worn head's wrap cage (HeadWrap.ts).
test("a neutral frame wrapped by the head component resolves with the same bindings, marked headWrap", () => {
  for (const { name, LocalPosition, LocalRotation } of NEUTRAL) {
    const selected = item({ LocalPosition, LocalRotation, WrapDeformation: { bIsWrapDeformed: true,
      bIsWrapDeformedByHeadComponent: true, DisabledByTags: [], OptionalWrapDeformerMesh: SOFT() } });
    assert.equal(neutralSourceHeadFrame(selected.parts[0], assets()), true, name);
    assert.deepEqual(resolveSourceRigParts(selected, assets()),
      resolveSourceRigParts(item({ LocalPosition, LocalRotation }), assets()).map(p => ({ ...p, headWrap: true })), name);
  }
});
refused("authored effect", { Effect: SOFT(NS) }, { effect: NS });
refused("logic modules", { LogicModules: [{ Class: "Stub" }] });
refused("a static mesh instead", { StaticMesh: SOFT(SM), SkeletalMesh: SOFT() }, { staticMesh: SM, skeletalMesh: "" });
refused("an undeclared skeletal asset", { SkeletalMesh: SOFT() }, { skeletalMesh: "" });
refused("a skeletal section reference", { SkeletalMesh: { AssetPathName: MESH, SubPathString: "LOD0" } });

// The preserved head matrix has to be there, and has to be a rigid affine rest.
const column = (index: number, edit: (value: number) => number) =>
  HEAD_REST.map((v, i) => (i >= index * 4 && i < index * 4 + 3 ? edit(v) : v));
const rests: Record<string, AssemblyAssets> = {
  "no preserved body": assets({ attachmentBody: undefined }),
  "no head rest bone": body({ spine_03: HEAD_REST }),
  "a truncated head matrix": body({ head: HEAD_REST.slice(0, 15) }),
  "a nonfinite head matrix": body({ head: HEAD_REST.map((v, i) => (i === 0 ? Number.NaN : v)) }),
  "a singular head rest": body({ head: column(0, () => 0) }),
  "a scaled head rest": body({ head: column(0, v => v * 2) }),
  "a reflected head rest": body({ head: column(0, v => -v) }),
  "a sheared head rest": body({ head: HEAD_REST.map((v, i) => (i >= 4 && i < 7 ? v + 0.05 * HEAD_REST[i - 4] : v)) }),
  "a projective head rest": body({ head: HEAD_REST.map((v, i) => (i === 3 ? 0.25 : v)) }),
  // Rigid, finite, present — and simply not the rest this local transform compensates.
  "a different rigid head rest": body({ head: HEAD_REST.map((v, i) => (i === 13 ? v + 0.01 : v)) }),
};
for (const [name, index] of Object.entries(rests)) {
  test(`refused with ${name}`, () => {
    const selected = item();
    assert.equal(neutralSourceHeadFrame(selected.parts[0], index), false);
    assert.throws(() => resolveSourceRigParts(selected, index), /Unsupported source assembly part 0/);
  });
}

for (const kind of ['static', undefined] as const) test(`a neutral frame requires an explicitly skeletal index entry (${kind})`, () => {
  const index = assets({ meshes: { [MESH]: { url: "hair.glb", kind, slots: [{ slot: "Hair", material: MI }] } } });
  const selected = item();
  assert.equal(neutralSourceHeadFrame(selected.parts[0], index), false);
  assert.throws(() => resolveSourceRigParts(selected, index),
    /Unsupported source assembly part 0/);
});

test("a nonidentity rule offset stays refused over a neutral base transform", () => {
  const id = "hairs-bobcurly-black";
  const definition = {
    formatVersion: 1, id, source: "DA_Hairs_BobCurly_Black", sourceSha256: "stub",
    properties: { Slots: ["Hair"], VisualParts: [placement({ TagOverrides: [{
      MatchingTags: ["Customization.Archetype.Medium"], bOverrideMesh: false, ReplacementStaticMesh: SOFT(),
      ReplacementSkeletalMesh: SOFT(), bOverrideEffect: false, ReplacementEffect: SOFT(),
      bOverrideMaterials: false, MaterialOverrides: [], bOffsetTransform: true,
      OffsetPosition: { X: 0.5, Y: 0, Z: 0 }, OffsetRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
      OffsetScale: { X: 1, Y: 1, Z: 1 },
    }] })] },
  } as unknown as SourceDefinition;
  const hair = resolveSourceOutfit([definition], ["Customization.Archetype.Medium"]).items[id];
  assert.deepEqual(hair.parts[0].unresolved, ["unsupported placement or logic override 0"]);
  assert.equal(neutralSourceHeadFrame(hair.parts[0], assets()), false);
  assert.throws(() => resolveSourceRigParts(hair, assets()), /Unsupported source assembly part 0/);
});

test("a logic-module rule stays refused over a neutral base transform", () => {
  const id = "hairs-bobcurly-black";
  const definition = {
    formatVersion: 1, id, source: "DA_Hairs_BobCurly_Black", sourceSha256: "stub",
    properties: { Slots: ["Hair"], VisualParts: [placement({ TagOverrides: [{
      MatchingTags: ["Customization.Archetype.Medium"], bOverrideMesh: false, ReplacementStaticMesh: SOFT(),
      ReplacementSkeletalMesh: SOFT(), bOverrideEffect: false, ReplacementEffect: SOFT(),
      bOverrideMaterials: false, MaterialOverrides: [], bAddLogicModules: true,
    }] })] },
  } as unknown as SourceDefinition;
  const hair = resolveSourceOutfit([definition], ["Customization.Archetype.Medium"]).items[id];
  assert.deepEqual(hair.parts[0].unresolved, ["unsupported placement or logic override 0"]);
  assert.throws(() => resolveSourceRigParts(hair, assets()), /Unsupported source assembly part 0/);
});

test("a missing mesh or material is still refused for a neutral frame", () => {
  assert.throws(() => resolveSourceRigParts(item(), assets({ meshes: {} })),
    /Unsupported source assembly part 0/);
  assert.throws(() => resolveSourceRigParts(item(), assets({ materials: {} })),
    /Missing recovered material for Hair/);
});

test("a head matrix alone is not a preserved attachment body", () => {
  for (const patch of [{ source: '' }, { url: '' }]) {
    const index = assets({ attachmentBody: { ...assets().attachmentBody!, ...patch } });
    assert.equal(neutralSourceHeadFrame(item().parts[0], index), false);
    assert.throws(() => resolveSourceRigParts(item(), index), /Unsupported source assembly part 0/);
  }
});
