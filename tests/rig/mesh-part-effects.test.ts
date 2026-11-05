import { test } from "node:test";
import assert from "node:assert/strict";
import { assemblyResolveGates, meshPartEffectsGate, resolveSourceOutfit, resolveSourceRigParts,
  type AssemblyAssets, type SourceDefinition } from "../../src/rig/SourceAssembly.ts";

// The gated effect drop on a mesh part (w120, signed off 4 Nov 2026 dropEffectOnMeshPart, extending the w61
// dropActivatedEffectParts): a part with a real mesh and a Niagara effect renders its mesh and only the effect is
// dropped. Gate off (every index today) is exactly today's refusal. Synthetic definitions in the shape of
// Vayiia Smart 01 Ultimate (one attached static part with its own Effect).

const SM = "/Game/Stub/SM_Watch.SM_Watch";
const MI = "/Game/Stub/MI_Watch.MI_Watch";
const NS = "/Game/Stub/NS_WatchUltimate.NS_WatchUltimate";
const BODY = "/Game/Stub/SK_Body.SK_Body";
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const soft = (value = "") => ({ AssetPathName: value, SubPathString: "" });
const attached = (mesh: string, overrides: Record<string, unknown> = {}) => ({
  StaticMesh: soft(mesh), SkeletalMesh: soft(), Effect: soft(), TagOverrides: [], bIsAttached: true,
  bIsHeadMesh: false, bAttachToHeadMesh: false, OptionalAttachmentMesh: soft(), OptionalHeadWrapMesh: soft(),
  AttachmentSocket: "hand_l", LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
  LocalScale: { X: 1, Y: 1, Z: 1 }, LogicModules: [],
  WrapDeformation: { bIsWrapDeformed: false, bIsWrapDeformedByHeadComponent: false, OptionalWrapDeformerMesh: soft() },
  ...overrides,
});

function watch(parts: unknown[]): SourceDefinition {
  return { id: "watch", formatVersion: 1, source: "/Game/Stub/DA_Watch.DA_Watch", sourceSha256: "b".repeat(64),
    properties: { Slots: ["EBodySlot::Wrist"], VisualParts: parts } } as unknown as SourceDefinition;
}

const assets: AssemblyAssets = {
  formatVersion: 1,
  meshes: { [SM]: { url: "watch.glb", kind: "static", slots: [{ slot: "Watch", material: MI }] } },
  materials: { [MI]: "watch.json" },
  attachmentBody: { source: BODY, url: "body.glb", restBones: { hand_l: IDENTITY } },
};

test("a mesh part with an effect refuses with the gate off and renders its mesh with it on", () => {
  const item = resolveSourceOutfit([watch([attached(SM, { Effect: soft(NS) })])], []).items.watch;
  assert.equal(item.parts[0].effect, NS);
  assert.throws(() => resolveSourceRigParts(item, assets), /Unsupported source assembly part 0/);
  const parts = resolveSourceRigParts(item, assets, path => path, { meshPartEffects: true });
  assert.deepEqual(parts.map(part => [part.sourceIndex, part.sourceMesh]), [[0, SM]]);
});

test("the gate applies through the index field and refuses an unknown spelling", () => {
  const item = resolveSourceOutfit([watch([attached(SM, { Effect: soft(NS) })])], []).items.watch;
  const parts = resolveSourceRigParts(item, { ...assets, meshPartEffects: "drop" });
  assert.deepEqual(parts.map(part => part.sourceMesh), [SM]);
  assert.equal(meshPartEffectsGate(undefined), false);
  assert.throws(() => assemblyResolveGates({ ...assets, meshPartEffects: "keep" }), /Unknown mesh part effects: keep/);
});

test("an effect-only part is not a mesh part: the gate alone still refuses it", () => {
  const item = resolveSourceOutfit([watch([attached(SM), attached("", { Effect: soft(NS) })])], []).items.watch;
  assert.throws(() => resolveSourceRigParts(item, assets, path => path, { meshPartEffects: true }),
    /Unsupported source assembly part 1/);
});

test("every other refusal of the part stands under the gate", () => {
  const wrapped = attached(SM, { Effect: soft(NS),
    WrapDeformation: { bIsWrapDeformed: true, bIsWrapDeformedByHeadComponent: false, OptionalWrapDeformerMesh: soft() } });
  const item = resolveSourceOutfit([watch([wrapped])], []).items.watch;
  assert.throws(() => resolveSourceRigParts(item, assets, path => path, { meshPartEffects: true }),
    /Unsupported source assembly part 0/);
});
