import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptySourcePart, explicitlyEmptiedPart, inertMergedPartTransform, INERT_LOGIC_MODULES,
  loadSourceSkinPair, onlyInertLogicModules, omittedSourceHead, resolveSourceOutfit,
  resolveSourceRigParts, neutralSourceHeadFrame,
  type AssemblyAssets, type ResolvedPart, type SourceDefinition, type SourceOutfit,
} from "../../src/rig/SourceAssembly.ts";

// The one inert logic module every gate admits (w101-cel-unblock, Claude's decision):
// /Script/Angelscript.CharacterCustomizationLogic_IsInFrontend, authored by Face 11 and the anime-archer
// items. A part whose authored LogicModules are all allowlisted resolves exactly as a part without
// modules; every other module keeps today's refusal, alone or beside the allowlisted one.

const INERT = { AssetPathName: "/Script/Angelscript.CharacterCustomizationLogic_IsInFrontend", SubPathString: "" };
// (w119) a real module that stays refused: a gameplay-stat driver (two catalog parts author it).
const OTHER = { AssetPathName: "/Script/Angelscript.CharacterCustomizationLogic_EliminationTimestamps", SubPathString: "" };
// (w119 watches) the second allowlisted module, under the watch-faces-at-GameTime-0 sign-off.
const WATCH = { AssetPathName: "/Script/Angelscript.CharacterCustomizationLogic_Watch", SubPathString: "" };
// (w149) the third allowlisted module: the step counter watch, whose icon shows a zero count.
const STEPS = { AssetPathName: "/Script/Angelscript.CharacterCustomizationLogic_StepCounter", SubPathString: "" };

// --- the allowlist itself ---------------------------------------------------------------------

test("the allowlist is exactly the three inert modules, matched by exact path string", () => {
  assert.deepEqual([...INERT_LOGIC_MODULES], ["/Script/Angelscript.CharacterCustomizationLogic_IsInFrontend",
    "/Script/Angelscript.CharacterCustomizationLogic_Watch",
    "/Script/Angelscript.CharacterCustomizationLogic_StepCounter"]);
  assert.equal(onlyInertLogicModules({ LogicModules: [WATCH] }), true);
  assert.equal(onlyInertLogicModules({ LogicModules: [WATCH, INERT] }), true);
  // (w149) the step counter watch's module, admitted on the icon's zero count.
  assert.equal(onlyInertLogicModules({ LogicModules: [STEPS] }), true);
  for (const modules of [[WATCH, OTHER], [STEPS, OTHER], [{ ...WATCH, SubPathString: "Instance" }],
    [{ ...WATCH, AssetPathName: "/Script/Angelscript.CharacterCustomizationLogic_Watches" }],
    [{ ...STEPS, AssetPathName: "/Script/Angelscript.CharacterCustomizationLogic_StepCounters" }],
    [{ AssetPathName: "/Script/Angelscript.CharacterCustomizationLogic_Revives", SubPathString: "" }]]) {
    assert.equal(onlyInertLogicModules({ LogicModules: modules }), false, JSON.stringify(modules));
  }
  assert.equal(onlyInertLogicModules({}), true);
  assert.equal(onlyInertLogicModules({ LogicModules: [] }), true);
  assert.equal(onlyInertLogicModules({ LogicModules: [INERT] }), true);
  assert.equal(onlyInertLogicModules({ LogicModules: [INERT, { ...INERT }] }), true);
  // No prefix or pattern matching, no sub-object, no other module; mixed lists stay refused.
  for (const modules of [[OTHER], [INERT, OTHER],
    [{ ...INERT, AssetPathName: "/Script/Angelscript.CharacterCustomizationLogic_IsInFrontends" }],
    [{ ...INERT, AssetPathName: "/Script/Angelscript.CharacterCustomizationLogic_IsInFront" }],
    [{ ...INERT, AssetPathName: "CharacterCustomizationLogic_IsInFrontend" }],
    [{ ...INERT, SubPathString: "Instance" }],
    [{}], ["module"], [null]]) {
    assert.equal(onlyInertLogicModules({ LogicModules: modules }), false, JSON.stringify(modules));
  }
});

// --- the skinned-part admission (the route the archer garments take) ---------------------------

const SOFT = (assetPath = "") => ({ AssetPathName: assetPath, SubPathString: "" });
const MESH = "/Game/Test/Archers/SK_ArcherTop.SK_ArcherTop";
const MI = "/Game/Test/Archers/MI_ArcherTop.MI_ArcherTop";
const HEAD_REST = [
  2.5787347538459216e-07, 0.9662225716324597, -0.2577090825764894, 0,
  -1.0000001192089563, 1.1254719131705552e-07, -5.786674512118003e-07, 0,
  -5.301170100288239e-07, 0.25770914218134233, 0.966222512027538, 0,
  1.162334694554861e-06, 1.6811438197924242, -0.03551814923580808, 1,
];

function placement(overrides: Record<string, unknown> = {}): ResolvedPart["definition"] {
  return {
    StaticMesh: SOFT(), SkeletalMesh: SOFT(MESH), Effect: SOFT(), TagOverrides: [],
    bVisibleInFirstPerson: false, bCanBeMerged: true, bIsHeadMesh: false, OptionalHeadWrapMesh: SOFT(),
    bIsAttached: false, bAttachToHeadMesh: false, OptionalAttachmentMesh: SOFT(),
    AttachmentSocket: "None", bLimitMergedLod: false, MaxMergedLodIndex: 3,
    LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
    LocalScale: { X: 1, Y: 1, Z: 1 }, LogicModules: [],
    WrapDeformation: { bIsWrapDeformed: false, bIsWrapDeformedByHeadComponent: false,
      DisabledByTags: [], OptionalWrapDeformerMesh: SOFT() },
    ...overrides,
  } as unknown as ResolvedPart["definition"];
}

function part(overrides: Record<string, unknown> = {}, resolved: Partial<ResolvedPart> = {}): ResolvedPart {
  return { sourceIndex: 0, staticMesh: "", skeletalMesh: MESH, effect: "", hidden: false,
    rules: [], unresolved: [], materials: {}, definition: placement(overrides), ...resolved };
}

function garment(overrides: Record<string, unknown> = {}): SourceOutfit["items"][string] {
  return { source: "DA_Archer.uasset", hidden: false, materialParameters: [], parts: [part(overrides)] };
}

function assets(overrides: Partial<AssemblyAssets> = {}): AssemblyAssets {
  return {
    formatVersion: 1,
    meshes: { [MESH]: { url: "top.glb", kind: "skeletal", slots: [{ slot: "Top", material: MI }] } },
    materials: { [MI]: "top.json" },
    attachmentBody: { source: "/Game/Test/Body/SK_Body_M.SK_Body_M", url: "body.glb", restBones: { head: HEAD_REST } },
    ...overrides,
  };
}

test("a skinned part with only the inert module resolves exactly as a part without modules", () => {
  const plain = resolveSourceRigParts(garment(), assets());
  const admitted = resolveSourceRigParts(garment({ LogicModules: [INERT] }), assets());
  assert.deepEqual(admitted, plain);
  assert.equal(admitted[0].inertMergedTransform, undefined);
});

test("any other logic module keeps the skinned-part refusal, alone or beside the inert one", () => {
  for (const modules of [[OTHER], [INERT, OTHER]]) {
    assert.throws(() => resolveSourceRigParts(garment({ LogicModules: modules }), assets()),
      /Unsupported source assembly part 0/, JSON.stringify(modules));
  }
});

test("the merged skinned-part admission admits the inert module and refuses every other one", () => {
  // The eligible merged part with a nonidentity authored transform (the w45-resolver fixture shape):
  // the gate resolves it with the inert module authored, and only with that module.
  const transform = { AttachmentSocket: "neck_01",
    LocalPosition: { X: -149.09001, Y: 39.916553, Z: -0.003087 },
    LocalRotation: { Pitch: -90.0, Yaw: 172.87498, Roll: 173.94353 }, LocalScale: { X: 1, Y: 1, Z: 1 } };
  assert.equal(inertMergedPartTransform(part({ ...transform, LogicModules: [INERT] }), assets()), true);
  assert.equal(inertMergedPartTransform(part({ ...transform, LogicModules: [OTHER] }), assets()), false);
  assert.equal(inertMergedPartTransform(part({ ...transform, LogicModules: [INERT, OTHER] }), assets()), false);
  const [resolved] = resolveSourceRigParts(garment({ ...transform, LogicModules: [INERT] }),
    assets(), path => path, { mergedPartTransforms: true });
  assert.equal(resolved.inertMergedTransform, true);
  // The neutral compensated head frame route admits it too, under its own conditions.
  const neutral = { AttachmentSocket: "head",
    LocalPosition: { X: -163.35124, Y: -39.89272, Z: 0 }, LocalRotation: { Pitch: -90, Yaw: 159.44395, Roll: -144.5098 } };
  assert.equal(neutralSourceHeadFrame(part({ ...neutral, LogicModules: [INERT] }), assets()), true);
  assert.equal(neutralSourceHeadFrame(part({ ...neutral, LogicModules: [OTHER] }), assets()), false);
});

test("an emptied part with only the inert module is still an explicit emptying; any other module is not", () => {
  const emptied = (modules: unknown[]): ResolvedPart => part({ LogicModules: modules,
    SkeletalMesh: SOFT("/Game/Test/Heads/SK_Head.SK_Head"), bIsHeadMesh: true,
    TagOverrides: [{ MatchingTags: ["Customization.HideMesh.FaceReplacement"], bOffsetTransform: false,
      OffsetPosition: { X: 0, Y: 0, Z: 0 }, OffsetRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
      OffsetScale: { X: 1, Y: 1, Z: 1 }, bOverrideMesh: true, ReplacementStaticMesh: SOFT(),
      ReplacementSkeletalMesh: SOFT(), bOverrideEffect: false, ReplacementEffect: SOFT(),
      bOverrideMaterials: false, MaterialOverrides: [], bAddLogicModules: false }] },
    { hidden: true, skeletalMesh: "", rules: [0] });
  assert.equal(explicitlyEmptiedPart(emptied([INERT])), true);
  assert.equal(explicitlyEmptiedPart(emptied([OTHER])), false);
  assert.equal(explicitlyEmptiedPart(emptied([INERT, OTHER])), false);
  // A part that names nothing to render stays empty with the inert module and only with it.
  const bare = (modules: unknown[]) => part({ LogicModules: modules }, { skeletalMesh: "", staticMesh: "" });
  assert.equal(emptySourcePart(bare([INERT])), true);
  assert.equal(emptySourcePart(bare([])), true);
  assert.equal(emptySourcePart(bare([OTHER])), false);
});

// --- the published skin pair -------------------------------------------------------------------

const ORIGIN = "http://inert-logic.test/";
const FACE_ID = "head-face-11-base";
const FACE_SOURCE = "Test/Heads/DA_Head_Face_11_Base.uasset";
const HEAD_MESH = "/Game/Test/Heads/SK_Head_Face_11.SK_Head_Face_11";
const BODY_MESH = "/Game/Test/Body/SK_Body_M.SK_Body_M";
const HEAD_MI = "/Game/Test/Heads/MI_Head_Face_11.MI_Head_Face_11";
const BODY_MI = "/Game/Test/Heads/MI_Body_Face_11.MI_Body_Face_11";
const SKIN_MI = "/Game/Test/Body/M_Skin.M_Skin";
const MEDIUM = "Customization.Archetype.Medium";
const FACE_REPLACEMENT = "Customization.HideMesh.FaceReplacement";

const files = new Map<string, string>();
globalThis.fetch = (async (input: string | URL | Request) => {
  const body = files.get(String(input));
  return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
}) as typeof fetch;
(globalThis as { window?: unknown }).window = { location: { href: ORIGIN } };

const skinned = (mesh: string, head: boolean, modules: unknown[], overrides: unknown[]) => ({
  StaticMesh: SOFT(), SkeletalMesh: SOFT(mesh), Effect: SOFT(), bIsHeadMesh: head, bIsAttached: false,
  bAttachToHeadMesh: false, OptionalAttachmentMesh: SOFT(), AttachmentSocket: "None",
  LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
  LocalScale: { X: 1, Y: 1, Z: 1 }, LogicModules: modules, TagOverrides: overrides,
});
const emptyMesh = (tag: string) => ({ MatchingTags: [tag], bOffsetTransform: false,
  OffsetPosition: { X: 0, Y: 0, Z: 0 }, OffsetRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
  OffsetScale: { X: 1, Y: 1, Z: 1 }, bOverrideMesh: true, ReplacementStaticMesh: SOFT(),
  ReplacementSkeletalMesh: SOFT(), bOverrideEffect: false, ReplacementEffect: SOFT(),
  bOverrideMaterials: false, MaterialOverrides: [], bAddLogicModules: false });
const definition = (id: string, properties: Record<string, unknown>): SourceDefinition =>
  ({ formatVersion: 1, id, source: `Test/${id}.uasset`, sourceSha256: `${id}-sha`, properties }) as never;

/** The cel face: both pair parts carry the given logic modules; the head names the emptying rule. */
const face = (headModules: unknown[], bodyModules: unknown[]) =>
  ({ ...definition(FACE_ID, {
    Slots: ["EBodySlot::Head"], ActivatesTags: ["Customization.Slot.Head"],
    MaterialOverrides: [{ Key: "BaseBody", Value: SOFT(BODY_MI) }],
    VisualParts: [skinned(HEAD_MESH, true, headModules, [emptyMesh(FACE_REPLACEMENT)]),
      skinned(BODY_MESH, false, bodyModules, [])],
  }), source: FACE_SOURCE });
const donors = () => [
  { MaterialInstance: SOFT("/Game/Test/Hairs/MI_Scalp.MI_Scalp"),
    Behavior: "ECustomizationMaterialBehavior::OverrideParameters", MatchingTags: [], SlotNames: ["shader_head_shader"] },
];
const hairScalpOnly = () => definition("hairs-scalp-only", {
  Slots: ["EBodySlot::Hair"], ActivatesTags: ["Customization.Slot.Hair"], ActivatesMaterialParameters: donors(),
});
const helmet = () => definition("robots-helmet", {
  Slots: ["EBodySlot::Headwear"], ActivatesTags: [FACE_REPLACEMENT],
  VisualParts: [{ StaticMesh: SOFT("/Game/Test/Hats/SM_Cap.SM_Cap"), SkeletalMesh: SOFT(), Effect: SOFT(),
    bIsHeadMesh: false, bIsAttached: true, bAttachToHeadMesh: false, OptionalAttachmentMesh: SOFT(),
    AttachmentSocket: "head", LocalPosition: { X: 0, Y: 0, Z: 0 },
    LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 }, LocalScale: { X: 1, Y: 1, Z: 1 },
    LogicModules: [], TagOverrides: [] }],
});

const BASE = `${ORIGIN}pair`;
files.set(`${BASE}/skin-pairs.json`, JSON.stringify({
  formatVersion: 1,
  items: {
    [FACE_ID]: {
      source: FACE_SOURCE, sourceSha256: "face-sha",
      head: { sourceIndex: 0, sourceMesh: HEAD_MESH, url: "meshes/head.glb", boundsOrigin: [0, -0.65, 166.17],
        materials: { shader_head_shader: { source: HEAD_MI, defaultSource: HEAD_MI, url: "materials/head.json" } } },
      body: { sourceIndex: 1, sourceMesh: BODY_MESH, url: "meshes/body.glb", boundsOrigin: [0, -0.91, 83.8],
        materials: { BaseBody: { source: BODY_MI, defaultSource: SKIN_MI, url: "materials/body.json" } } },
    },
  },
}));
files.set(`${BASE}/assets.json`, JSON.stringify({ formatVersion: 1, meshes: {}, materials: {}, materialVariants: {} }));

const outfit = (definitions: SourceDefinition[]) => resolveSourceOutfit(definitions, [MEDIUM]);

test("the published pair admits the inert module on both parts and refuses any other module", async () => {
  const resolved = outfit([face([INERT], [INERT])]);
  const pair = await loadSourceSkinPair(FACE_ID, resolved.items[FACE_ID], BASE,
    resolved.materialParameters, { id: "hairs-scalp-only", item: outfit([face([INERT], [INERT])]).items["hairs-scalp-only"] });
  assert.ok(pair);
  assert.equal(pair!.head.sourceMesh, HEAD_MESH);
  assert.equal(pair!.body.sourceMesh, BODY_MESH);
  assert.equal(pair!.head.materials.shader_head_shader.url, `${BASE}/materials/head.json`);
  assert.equal(pair!.body.materials.BaseBody.url, `${BASE}/materials/body.json`);
  assert.equal(pair!.headOmitted, undefined, "nothing empties the head in this context");
  // A different module on the head part, or beside the inert one on the body part, refuses.
  const otherHead = outfit([face([OTHER], [INERT])]);
  await assert.rejects(loadSourceSkinPair(FACE_ID, otherHead.items[FACE_ID], BASE, otherHead.materialParameters),
    /Unsupported source skin pair placement or replacement/);
  const mixedBody = outfit([face([INERT], [INERT, OTHER])]);
  await assert.rejects(loadSourceSkinPair(FACE_ID, mixedBody.items[FACE_ID], BASE, mixedBody.materialParameters),
    /Unsupported source skin pair placement or replacement/);
});

test("an emptied head with only the inert module is omitted; with any other module the omission is refused", async () => {
  const covered = outfit([face([INERT], [INERT]), hairScalpOnly(), helmet()]);
  const selection = { id: "hairs-scalp-only", item: covered.items["hairs-scalp-only"] };
  const pair = await loadSourceSkinPair(FACE_ID, covered.items[FACE_ID], BASE,
    covered.materialParameters.filter(p => p.itemId === "hairs-scalp-only"), selection);
  assert.ok(pair?.headOmitted, "the emptied head carrying the inert module is omitted");
  assert.deepEqual(pair!.headOmitted!.rules, [0]);
  // The omission requires the allowlist too: the same head with the watch module stays unsupported.
  const refused = outfit([face([OTHER], [INERT]), hairScalpOnly(), helmet()]);
  assert.equal(omittedSourceHead(refused.items[FACE_ID],
    { sourceIndex: 0, sourceMesh: HEAD_MESH },
    { id: "hairs-scalp-only", item: refused.items["hairs-scalp-only"] }), undefined);
  await assert.rejects(loadSourceSkinPair(FACE_ID, refused.items[FACE_ID], BASE,
    refused.materialParameters.filter(p => p.itemId === "hairs-scalp-only"),
    { id: "hairs-scalp-only", item: refused.items["hairs-scalp-only"] }),
    /Unsupported source skin pair placement or replacement/);
});
