import { test } from "node:test";
import assert from "node:assert/strict";
import { assemblyResolveGates, glitchOverlayPartsGate, resolveSourceOutfit, resolveSourceRigParts,
  type AssemblyAssets, type SourceDefinition } from "../../src/rig/SourceAssembly.ts";

// The gated "drop" route for CNS Glitch overlay parts (w175, decision 5 in signoffs-2026-11-11.json: CNS Glitch items
// drawn without the glitch effect, as purple). A part whose mesh is on the index's evidenced glitchOverlayMeshes list
// renders nothing, provided the item keeps another real part. Gate off (every index before activation) is exactly the
// old behaviour: the unbuilt glitch mesh refuses the item. Synthetic definitions in the shape of the CNS items (a
// garment mesh plus a separate *Glitch mesh).

const SK = "/Game/Stub/SK_Joggers_M.SK_Joggers_M";
const GLITCH = "/Game/Stub/SK_JoggersGlitch_M.SK_JoggersGlitch_M";
const OTHER_GLITCH = "/Game/Stub/SK_OtherGlitch_M.SK_OtherGlitch_M";
const MI = "/Game/Stub/MI_Joggers.MI_Joggers";

const soft = (value = "") => ({ AssetPathName: value, SubPathString: "" });
const skinned = (mesh: string, overrides: Record<string, unknown> = {}) => ({
  StaticMesh: soft(), SkeletalMesh: soft(mesh), Effect: soft(), TagOverrides: [], bIsAttached: false,
  bIsHeadMesh: false, bAttachToHeadMesh: false, OptionalAttachmentMesh: soft(), OptionalHeadWrapMesh: soft(),
  AttachmentSocket: "None", LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
  LocalScale: { X: 1, Y: 1, Z: 1 }, LogicModules: [],
  WrapDeformation: { bIsWrapDeformed: false, bIsWrapDeformedByHeadComponent: false, OptionalWrapDeformerMesh: soft() },
  ...overrides,
});

function joggers(parts: unknown[]): SourceDefinition {
  return { id: "joggers", formatVersion: 1, source: "/Game/Stub/DA_Joggers.DA_Joggers", sourceSha256: "a".repeat(64),
    properties: { Slots: ["EBodySlot::LowerBody"], VisualParts: parts } } as unknown as SourceDefinition;
}

const assets: AssemblyAssets = {
  formatVersion: 1,
  meshes: { [SK]: { url: "joggers.glb", kind: "skeletal", slots: [{ slot: "Joggers", material: MI }] } },
  materials: { [MI]: "joggers.json" },
};
const on: AssemblyAssets = { ...assets, glitchOverlayParts: "drop", glitchOverlayMeshes: [GLITCH] };

test("a listed glitch overlay part refuses the item with the gate off and renders nothing with it on", () => {
  const item = resolveSourceOutfit([joggers([skinned(SK), skinned(GLITCH)])], []).items.joggers;
  assert.throws(() => resolveSourceRigParts(item, assets), /Missing preserved source mesh|Unsupported source assembly part 1/);
  const parts = resolveSourceRigParts(item, on);
  assert.deepEqual(parts.map(part => [part.sourceIndex, part.sourceMesh]), [[0, SK]]);
});

test("a list without the gate is ignored, and an unlisted mesh is never dropped", () => {
  const item = resolveSourceOutfit([joggers([skinned(SK), skinned(OTHER_GLITCH)])], []).items.joggers;
  assert.throws(() => resolveSourceRigParts(item, { ...assets, glitchOverlayMeshes: [OTHER_GLITCH] }));
  assert.throws(() => resolveSourceRigParts(item, on));
});

test("an item made only of glitch overlay parts is refused exactly as before", () => {
  const item = resolveSourceOutfit([joggers([skinned(GLITCH)])], []).items.joggers;
  assert.throws(() => resolveSourceRigParts(item, on));
  const two = resolveSourceOutfit([joggers([skinned(GLITCH), skinned(GLITCH)])], []).items.joggers;
  assert.throws(() => resolveSourceRigParts(two, on));
});

test("a listed part with any other unsupported authoring stays refused under the gate", () => {
  for (const overrides of [{ LogicModules: [{}] }, { OptionalAttachmentMesh: soft("/Game/Stub/SK_Opt.SK_Opt") },
    { bIsHeadMesh: true }, { Effect: soft("/Game/Stub/NS_Fx.NS_Fx") },
    { WrapDeformation: { bIsWrapDeformed: true, bIsWrapDeformedByHeadComponent: false,
      OptionalWrapDeformerMesh: soft("/Game/Stub/SK_Proxy.SK_Proxy") } }]) {
    const item = resolveSourceOutfit([joggers([skinned(SK), skinned(GLITCH, overrides)])], []).items.joggers;
    assert.throws(() => resolveSourceRigParts(item, on), undefined, JSON.stringify(overrides));
  }
});

test("the gate refuses unknown spellings and a missing or malformed list", () => {
  assert.equal(glitchOverlayPartsGate(undefined, [GLITCH]), undefined);
  assert.deepEqual([...glitchOverlayPartsGate("drop", [GLITCH])!], [GLITCH]);
  assert.throws(() => glitchOverlayPartsGate("hide", [GLITCH]), /Unknown glitch overlay parts/);
  for (const bad of [undefined, [], ["SK_NoPath"], [1]])
    assert.throws(() => glitchOverlayPartsGate("drop", bad), /Invalid glitch overlay meshes/);
  assert.equal(assemblyResolveGates(assets).glitchOverlayMeshes, undefined);
  assert.ok(assemblyResolveGates(on).glitchOverlayMeshes?.has(GLITCH));
});
