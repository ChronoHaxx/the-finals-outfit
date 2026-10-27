import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assemblyResolveGates,
  facialHairForeignOverlaysGate,
  resolveSourceOutfit,
  resolveSourceRigParts,
  type AssemblyAssets,
  type SourceDefinition,
  type SourceResolveGates,
} from "../../src/rig/SourceAssembly.ts";

// The gated facial-hair foreign-overlay route (w50-hair-facial, 22 Oct 2026). A facial-hair item's
// authored material-parameter rule can name slots beyond its own mesh's (Beard Wizard White
// activates MI_Hair_01_IceBlonde_01 OverrideParameters on M_FacialHair, shader_eyebrows_shader and
// M_Mustache). The own facial-hair slot's overlay resolves through the index's material variant as
// before; the gate lets the route admit the rule and records the foreign slots it defers. Gate off
// (every index today), a part resolves byte-identically: no field is written, nothing is deferred.
// Evidence: DA_FacialHairs_BeardWizard_White (public/models/reconstructed-assembly-v2/items/) and
// the w50 resolver probe (w50-hair-facial/work/resolver-probe.mjs).

const MEDIUM = ["Customization.Archetype.Medium"];
const MESH = "/Game/Discovery/Characters/FacialHairs/BeardWizard/SK_BeardWizard_M.SK_BeardWizard_M";
const BASE_MATERIAL = "/Game/Discovery/Characters/FacialHairs/BeardWizard/MI_BeardWizard_Black.MI_BeardWizard_Black";
const OVERLAY = "/Game/Discovery/Characters/Hairs/Materials/HairColors/Hair_01/MI_Hair_01_IceBlonde_01.MI_Hair_01_IceBlonde_01";
const VARIANT = "../reconstructed-w50-stub/mi-beardwizard-black-v.json";
const OWN_ONLY_OVERLAY = "/Game/Discovery/Characters/Hairs/Materials/HairColors/Hair_01/MI_Hair_01_Black.MI_Hair_01_Black";

const soft = (value: string) => ({ AssetPathName: value, SubPathString: "" });

function beard(overlaySlots: string[], overlay: string = OVERLAY): SourceDefinition {
  return { id: "facialhairs-beardwizard-white", formatVersion: 1,
    source: "/Game/Stub/DA_FacialHairs_BeardWizard_White", sourceSha256: "a".repeat(64),
    properties: { Slots: ["EBodySlot::FacialHair"], VisualParts: [{
      StaticMesh: soft(""), SkeletalMesh: soft(MESH), Effect: soft(""), TagOverrides: [] }],
      ActivatesMaterialParameters: [{ MaterialInstance: soft(overlay),
        Behavior: "ECustomizationMaterialBehavior::OverrideParameters", MatchingTags: [],
        SlotNames: overlaySlots }] } } as unknown as SourceDefinition;
}

const assets: AssemblyAssets = {
  formatVersion: 1,
  meshes: { [MESH]: { url: "../reconstructed-w50-stub/SK_BeardWizard_M.glb",
    slots: [{ slot: "M_Facialhair", material: BASE_MATERIAL }], kind: "skeletal" } },
  materials: { [BASE_MATERIAL]: "../reconstructed-w50-stub/mi-beardwizard-black.json" },
  materialVariants: { [JSON.stringify([BASE_MATERIAL, OVERLAY])]: VARIANT,
    [JSON.stringify([BASE_MATERIAL, OWN_ONLY_OVERLAY])]: VARIANT },
};

const parts = (definition: SourceDefinition, gates?: SourceResolveGates) => {
  const item = resolveSourceOutfit([definition], MEDIUM).items[definition.id];
  return resolveSourceRigParts(item, assets, path => path, gates);
};

test("facialHairForeignOverlaysGate: absent stays off, the one spelling is on, unknown throws", () => {
  assert.equal(facialHairForeignOverlaysGate(undefined), false);
  assert.equal(facialHairForeignOverlaysGate("own-slots"), true);
  assert.throws(() => facialHairForeignOverlaysGate("all-slots"), /Unknown facial hair foreign overlays/);
});

test("the gate reads the index field, and a capture-only switch wins over it", () => {
  const index = { ...assets, facialHairForeignOverlays: "own-slots" };
  assert.equal(assemblyResolveGates(index).facialHairForeignOverlays, true);
  assert.equal(assemblyResolveGates(assets).facialHairForeignOverlays, false);
  assert.equal(assemblyResolveGates(assets, { facialHairForeignOverlays: "own-slots" }).facialHairForeignOverlays, true);
  assert.throws(() => assemblyResolveGates(assets, { facialHairForeignOverlays: "nope" }));
});

test("gate off resolves the own-slot overlay exactly as before and writes no deferred field", () => {
  const definition = beard(["M_FacialHair", "shader_eyebrows_shader", "M_Mustache"]);
  const before = parts(definition);
  assert.equal(before[0].materials["M_Facialhair"]?.source, BASE_MATERIAL);
  assert.equal(before[0].deferredOverlaySlots, undefined);
  // The default call and the explicit gate-off call are byte-identical.
  assert.deepEqual(parts(definition, { facialHairForeignOverlays: false }), before);
});

test("gate on admits the rule: the own slot keeps its overlay variant, the foreign slots defer", () => {
  const definition = beard(["M_FacialHair", "shader_eyebrows_shader", "M_Mustache"]);
  const after = parts(definition, { facialHairForeignOverlays: true });
  assert.equal(after[0].materials["M_Facialhair"]?.source, BASE_MATERIAL);
  assert.equal(after[0].materials["M_Facialhair"]?.url, VARIANT);
  assert.deepEqual(after[0].deferredOverlaySlots, ["m_mustache", "shader_eyebrows_shader"]);
  // Everything else about the part is unchanged by the gate.
  const before = parts(definition);
  const { deferredOverlaySlots: _ignored, ...rest } = after[0];
  assert.deepEqual(rest, before[0] as never);
});

test("a rule that reaches only its own slots defers nothing, on or off", () => {
  const definition = beard(["M_FacialHair"], OWN_ONLY_OVERLAY);
  for (const gates of [undefined, { facialHairForeignOverlays: true } as SourceResolveGates]) {
    const resolved = parts(definition, gates);
    assert.equal(resolved[0].materials["M_Facialhair"]?.url, VARIANT);
    assert.equal(resolved[0].deferredOverlaySlots, undefined);
  }
});

test("a rule that reaches no own slot is not this route: nothing is deferred", () => {
  const definition = beard(["shader_eyebrows_shader"]);
  // Without an own-slot overlay the slot keeps its default; the gate records nothing.
  const resolved = parts(definition, { facialHairForeignOverlays: true });
  assert.equal(resolved[0].materials["M_Facialhair"]?.url, "../reconstructed-w50-stub/mi-beardwizard-black.json");
  assert.equal(resolved[0].deferredOverlaySlots, undefined);
});
