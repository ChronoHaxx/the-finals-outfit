import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSourceOutfit, type SourceDefinition } from "../../src/rig/SourceAssembly.ts";

// A TagOverrides rule with several MatchingTags is a conjunction (evidence:
// _docs/goal-100-2026-10-11/multi-tag/census.json). Partially matched it is inactive; fully matched
// it stays unresolved until priority between overlapping rules is verified. Synthetic definitions.

const MEDIUM = "Customization.Archetype.Medium";
const LIGHT = "Customization.Archetype.Light";
const PUSH = "Customization.Shape.PushInsideClothes.push_hair_in_back";
const BASE = "/Game/Stub/SK_Ponytail_M.SK_Ponytail_M";
const NO_PHYS = "/Game/Stub/SK_Ponytail_NoPhys_M.SK_Ponytail_NoPhys_M";
const LIGHT_MESH = "/Game/Stub/SK_Ponytail_L.SK_Ponytail_L";

const soft = (value: string) => ({ AssetPathName: value, SubPathString: "" });
const rule = (tags: string[], mesh: string) => ({ MatchingTags: tags, bOverrideMesh: true,
  ReplacementStaticMesh: soft(""), ReplacementSkeletalMesh: soft(mesh) });

function hair(activates: string[] = []): SourceDefinition {
  return { id: "hair", formatVersion: 1, source: "/Game/Stub/DA_Hair.DA_Hair", sourceSha256: "a".repeat(64),
    properties: { Slots: ["EBodySlot::Hair"], ActivatesTags: activates, VisualParts: [{
      StaticMesh: soft(""), SkeletalMesh: soft(BASE), Effect: soft(""),
      TagOverrides: [rule([LIGHT], LIGHT_MESH), rule([MEDIUM, PUSH], NO_PHYS)],
    }] } } as unknown as SourceDefinition;
}

const part = (definitions: SourceDefinition[], context: string[]) =>
  resolveSourceOutfit(definitions, context).items.hair.parts[0];

test("a partially matched multi-tag rule is inactive", () => {
  const resolved = part([hair()], [MEDIUM]);
  assert.deepEqual(resolved.unresolved, []);
  assert.equal(resolved.skeletalMesh, BASE);
  assert.deepEqual(resolved.rules, []);
});

test("a fully matched multi-tag rule is still refused", () => {
  const pusher = { id: "hoodie", formatVersion: 1, source: "/Game/Stub/DA_Hoodie.DA_Hoodie", sourceSha256: "b".repeat(64),
    properties: { ActivatesTags: [PUSH], VisualParts: [] } } as unknown as SourceDefinition;
  assert.deepEqual(part([hair(), pusher], [MEDIUM]).unresolved, ["multi-tag condition 1"]);
});

test("single-tag rules are unchanged beside a multi-tag rule", () => {
  const resolved = part([hair()], [LIGHT]);
  assert.deepEqual(resolved.unresolved, []);
  assert.equal(resolved.skeletalMesh, LIGHT_MESH);
  assert.deepEqual(resolved.rules, [0]);
});
