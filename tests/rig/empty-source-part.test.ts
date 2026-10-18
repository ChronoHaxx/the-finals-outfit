import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySourcePart, resolveSourceOutfit, resolveSourceRigParts,
  type AssemblyAssets, type SourceDefinition } from "../../src/rig/SourceAssembly.ts";

// An attached part with no mesh and no effect whose only rule adds the UltimateS10 effect, the shape of the
// seven catalog cases (e.g. DA_Medieval_KnightHelmet2_Steel part 1, 11 Oct 2026). Without the tag it renders
// nothing; with it the part carries the effect, which stays refused. Synthetic definitions.

const ULTIMATE = "Customization.Asset.UltimateS10_Effect";
const SM = "/Game/Stub/SM_Helmet.SM_Helmet";
const MI = "/Game/Stub/MI_Helmet.MI_Helmet";
const NS = "/Game/Stub/NS_UltimateEffect.NS_UltimateEffect";
const BODY = "/Game/Stub/SK_Body.SK_Body";
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const soft = (value = "") => ({ AssetPathName: value, SubPathString: "" });
const attached = (mesh: string, overrides: Record<string, unknown> = {}) => ({
  StaticMesh: soft(mesh), SkeletalMesh: soft(), Effect: soft(), TagOverrides: [], bIsAttached: true,
  bIsHeadMesh: false, bAttachToHeadMesh: false, OptionalAttachmentMesh: soft(), OptionalHeadWrapMesh: soft(),
  AttachmentSocket: "head", LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
  LocalScale: { X: 1, Y: 1, Z: 1 }, LogicModules: [],
  WrapDeformation: { bIsWrapDeformed: false, bIsWrapDeformedByHeadComponent: false, OptionalWrapDeformerMesh: soft() },
  ...overrides,
});
const effectRule = { MatchingTags: [ULTIMATE], bOverrideMesh: false, ReplacementStaticMesh: soft(),
  ReplacementSkeletalMesh: soft(), bOverrideEffect: true, ReplacementEffect: soft(NS), bOverrideMaterials: false,
  MaterialOverrides: [] };

function helmet(parts = [attached(SM), attached("", { TagOverrides: [effectRule] })]): SourceDefinition {
  return { id: "helmet", formatVersion: 1, source: "/Game/Stub/DA_Helmet.DA_Helmet", sourceSha256: "a".repeat(64),
    properties: { Slots: ["EBodySlot::Head"], VisualParts: parts } } as unknown as SourceDefinition;
}

const assets: AssemblyAssets = {
  formatVersion: 1,
  meshes: { [SM]: { url: "helmet.glb", kind: "static", slots: [{ slot: "Helmet", material: MI }] } },
  materials: { [MI]: "helmet.json" },
  attachmentBody: { source: BODY, url: "body.glb", restBones: { head: IDENTITY } },
};

test("an empty part renders nothing while its effect tag is inactive", () => {
  const item = resolveSourceOutfit([helmet()]).items.helmet;
  assert.deepEqual(item.parts.map(emptySourcePart), [false, true]);
  assert.deepEqual(resolveSourceRigParts(item, assets).map(part => [part.sourceIndex, part.sourceMesh]), [[0, SM]]);
});

test("the activated effect keeps the part refused", () => {
  const item = resolveSourceOutfit([helmet()], [ULTIMATE]).items.helmet;
  assert.equal(item.parts[1].effect, NS);
  assert.equal(emptySourcePart(item.parts[1]), false);
  assert.throws(() => resolveSourceRigParts(item, assets), /Unsupported source assembly part 1/);
});

test("a part with a logic module, an optional mesh or a head role is not empty", () => {
  for (const overrides of [{ LogicModules: [{}] }, { OptionalAttachmentMesh: soft("/Game/Stub/SK_Opt.SK_Opt") },
    { bIsHeadMesh: true }, { OptionalHeadWrapMesh: soft("/Game/Stub/SK_Wrap.SK_Wrap") }]) {
    const item = resolveSourceOutfit([helmet([attached(SM), attached("", overrides)])]).items.helmet;
    assert.equal(emptySourcePart(item.parts[1]), false, JSON.stringify(overrides));
    assert.throws(() => resolveSourceRigParts(item, assets), /Unsupported source assembly part 1/);
  }
});

test("an item made only of empty parts is refused", () => {
  const item = resolveSourceOutfit([helmet([attached("", { TagOverrides: [effectRule] })])]).items.helmet;
  assert.throws(() => resolveSourceRigParts(item, assets), /Unsupported source assembly part 0/);
});
