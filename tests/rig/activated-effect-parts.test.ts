import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSourceOutfit, resolveSourceRigParts,
  type AssemblyAssets, type SourceDefinition } from "../../src/rig/SourceAssembly.ts";

// The gated "drop" route for activated Niagara effect parts (w61, signed off 22 Oct 2026
// dropActivatedEffectParts): a part whose only renderable is an effect — its own `Effect`, or a
// rule's `ReplacementEffect` the resolver applied — renders nothing instead of refusing the item,
// provided the item keeps at least one real mesh part; the item's real meshes then render. Logic
// modules, wrap or optional meshes, head roles and unresolved rules keep today's refusal. Gate off
// (every index today) is exactly today's behaviour. Synthetic definitions, the shapes of the
// catalog's effect-part cases (empty-source-part.test.ts).

const ULTIMATE = "Customization.Asset.UltimateS10_Effect";
const SM = "/Game/Stub/SM_Visor.SM_Visor";
const MI = "/Game/Stub/MI_Visor.MI_Visor";
const NS = "/Game/Stub/NS_UltimateEffect.NS_UltimateEffect";
const NS_OTHER = "/Game/Stub/NS_Other.NS_Other";
const BODY = "/Game/Stub/SK_Body.SK_Body";
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const DROP = { activatedEffectParts: true };

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

function visor(parts: unknown[]): SourceDefinition {
  return { id: "visor", formatVersion: 1, source: "/Game/Stub/DA_Visor.DA_Visor", sourceSha256: "a".repeat(64),
    properties: { Slots: ["EBodySlot::Head"], VisualParts: parts } } as unknown as SourceDefinition;
}

const assets: AssemblyAssets = {
  formatVersion: 1,
  meshes: { [SM]: { url: "visor.glb", kind: "static", slots: [{ slot: "Visor", material: MI }] } },
  materials: { [MI]: "visor.json" },
  attachmentBody: { source: BODY, url: "body.glb", restBones: { head: IDENTITY } },
};

test("an activated effect part refuses the item with the gate off and renders nothing with it on", () => {
  const item = resolveSourceOutfit([visor([attached(SM), attached("", { TagOverrides: [effectRule] })])],
    [ULTIMATE]).items.visor;
  assert.equal(item.parts[1].effect, NS);
  assert.throws(() => resolveSourceRigParts(item, assets), /Unsupported source assembly part 1/);
  const parts = resolveSourceRigParts(item, assets, path => path, DROP);
  assert.deepEqual(parts.map(part => [part.sourceIndex, part.sourceMesh]), [[0, SM]]);
});

test("the drop also applies through the index field, and to a part's own authored Effect", () => {
  const item = resolveSourceOutfit([visor([attached(SM), attached("", { Effect: soft(NS_OTHER) })])],
    [ULTIMATE]).items.visor;
  assert.throws(() => resolveSourceRigParts(item, assets), /Unsupported source assembly part 1/);
  const fromIndex = resolveSourceRigParts(item,
    { ...assets, activatedEffectParts: "drop" }, path => path);
  assert.deepEqual(fromIndex.map(part => part.sourceIndex), [0]);
});

test("an item left with no real mesh part is refused exactly as before", () => {
  const item = resolveSourceOutfit([visor([attached("", { TagOverrides: [effectRule] }),
    attached("", { Effect: soft(NS_OTHER) })])], [ULTIMATE]).items.visor;
  assert.throws(() => resolveSourceRigParts(item, assets, path => path, DROP),
    /Unsupported source assembly part 0/);
});

test("an effect part with any other unsupported authoring stays refused under the gate", () => {
  for (const overrides of [{ LogicModules: [{}] }, { OptionalAttachmentMesh: soft("/Game/Stub/SK_Opt.SK_Opt") },
    { OptionalHeadWrapMesh: soft("/Game/Stub/SK_Wrap.SK_Wrap") }, { bIsHeadMesh: true }, { bAttachToHeadMesh: true },
    { WrapDeformation: { bIsWrapDeformed: true, bIsWrapDeformedByHeadComponent: true,
      OptionalWrapDeformerMesh: soft() } }]) {
    const item = resolveSourceOutfit([visor([attached(SM), attached("", { Effect: soft(NS_OTHER), ...overrides })])],
      [ULTIMATE]).items.visor;
    assert.throws(() => resolveSourceRigParts(item, assets, path => path, DROP),
      /Unsupported source assembly part 1/, JSON.stringify(overrides));
  }
});

test("an unresolved rule on the effect part stays refused under the gate", () => {
  const item = resolveSourceOutfit([visor([attached(SM), attached("", { Effect: soft(NS_OTHER),
    TagOverrides: [{ MatchingTags: [ULTIMATE], bOverrideMesh: false, ReplacementStaticMesh: soft(),
      ReplacementSkeletalMesh: soft(), bOverrideEffect: false, ReplacementEffect: soft(),
      bOverrideMaterials: false, MaterialOverrides: [], bAddLogicModules: true }] })])],
    [ULTIMATE]).items.visor;
  assert.deepEqual(item.parts[1].unresolved, ["unsupported placement or logic override 0"]);
  assert.throws(() => resolveSourceRigParts(item, assets, path => path, DROP),
    /Unsupported source assembly part 1/);
});

test("a part carrying both a mesh and an effect is never dropped and stays refused", () => {
  const item = resolveSourceOutfit([visor([attached(SM), attached(SM, { Effect: soft(NS_OTHER) })])],
    [ULTIMATE]).items.visor;
  assert.throws(() => resolveSourceRigParts(item, assets, path => path, DROP),
    /Unsupported source assembly part 1/);
});

test("an item without effect parts resolves identically with the gate on and off", () => {
  const item = resolveSourceOutfit([visor([attached(SM)])], [ULTIMATE]).items.visor;
  assert.deepEqual(resolveSourceRigParts(item, assets, path => path, DROP),
    resolveSourceRigParts(item, assets));
});
