import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSourceOutfit, type SourceDefinition } from "../../src/rig/SourceAssembly.ts";
import { sourceHairMissingMeshes, sourceHairUnresolved } from "../../src/rig/SourceHairAvailability.ts";

// A static attached hair whose single-tag rule swaps it for an _UnderHat mesh while a hat activates
// "covers upper hair" (SM_Buzzcut_Straight -> SM_Buzzcut_Straight_UnderHat, 11 Oct 2026). The standalone
// coverage audit never resolves that context, so an unpreserved replacement must surface as a refused
// combination before loading, not as a generic load failure. Synthetic definitions.

const COVERS = "Customization.Shape.PushHair.hat_covers_upper_hair";
const HAIR = "/Game/Stub/SM_Buzzcut.SM_Buzzcut";
const UNDER = "/Game/Stub/SM_Buzzcut_UnderHat.SM_Buzzcut_UnderHat";
const soft = (value = "") => ({ AssetPathName: value, SubPathString: "" });

const hair = { id: "hair", formatVersion: 1, source: "/Game/Stub/DA_Hair.DA_Hair", sourceSha256: "a".repeat(64),
  properties: { Slots: ["EBodySlot::Hair"], VisualParts: [{ StaticMesh: soft(HAIR), SkeletalMesh: soft(), Effect: soft(),
    bIsAttached: true, AttachmentSocket: "head", TagOverrides: [{ MatchingTags: [COVERS], bOverrideMesh: true,
      ReplacementStaticMesh: soft(UNDER), ReplacementSkeletalMesh: soft(), bOverrideEffect: false,
      ReplacementEffect: soft(), bOverrideMaterials: false, MaterialOverrides: [] }] }] } } as unknown as SourceDefinition;
const hat = { id: "hat", formatVersion: 1, source: "/Game/Stub/DA_Hat.DA_Hat", sourceSha256: "b".repeat(64),
  properties: { ActivatesTags: [COVERS], VisualParts: [] } } as unknown as SourceDefinition;

test("a hat's replacement mesh that is not preserved is reported for the hair", () => {
  const outfit = resolveSourceOutfit([hair, hat]);
  assert.deepEqual(sourceHairUnresolved(outfit, "hair"), []);
  assert.deepEqual(sourceHairMissingMeshes(outfit, "hair", { [HAIR]: {} }), [`missing preserved mesh ${UNDER}`]);
  assert.deepEqual(sourceHairMissingMeshes(outfit, "hair", { [HAIR]: {}, [UNDER]: {} }), []);
});

test("without the hat the base mesh is checked", () => {
  const outfit = resolveSourceOutfit([hair]);
  assert.deepEqual(sourceHairMissingMeshes(outfit, "hair", { [HAIR]: {} }), []);
  assert.deepEqual(sourceHairMissingMeshes(outfit, "hair", {}), [`missing preserved mesh ${HAIR}`]);
});

test("an inherited object key is not a preserved mesh", () => {
  const outfit = resolveSourceOutfit([{ ...hair, properties: { ...hair.properties, VisualParts: [{
    ...hair.properties.VisualParts![0], StaticMesh: soft("constructor"), TagOverrides: [] }] } } as SourceDefinition]);
  assert.deepEqual(sourceHairMissingMeshes(outfit, "hair", {}), ["missing preserved mesh constructor"]);
});
