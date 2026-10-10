import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSourceOutfit, type SourceDefinition } from "./SourceAssembly";
import { sourceHairUnresolved } from "./SourceHairAvailability";

const MEDIUM = ["Customization.Archetype.Medium"];
const HAT = "Customization.Shape.PushHair.hat_covers_upper_hair";
const HEAD = "Customization.Shape.PushHair.hat_covers_head";
const BUN = "Customization.Shape.PushHair.hat_covers_bun";
const HOOD = "Customization.Shape.PushHair.hood_covers_head";
const soft = (p = "") => ({ AssetPathName: p, SubPathString: "" });
const rule = (tags: string[], mesh: string) => ({ MatchingTags: tags, bOverrideMesh: true, ReplacementStaticMesh: soft(mesh),
  ReplacementSkeletalMesh: soft(), bOverrideEffect: false, ReplacementEffect: soft(), bOverrideMaterials: false, MaterialOverrides: [] });
const part = (mesh: string, rules: ReturnType<typeof rule>[]) =>
  ({ StaticMesh: soft(mesh), SkeletalMesh: soft(), Effect: soft(), TagOverrides: rules });
const item = (id: string, properties: Record<string, unknown>) =>
  ({ formatVersion: 1, id, source: `/Game/Test/${id}`, sourceSha256: "0", properties }) as unknown as SourceDefinition;
const hair = (id: string, rules: ReturnType<typeof rule>[], parameterTags: string[] = []) => item(id, {
  VisualParts: [part(`/Game/Test/${id}`, rules)],
  ActivatesMaterialParameters: [{ MaterialInstance: soft("/Game/Test/MI_Scalp"),
    Behavior: "ECustomizationMaterialBehavior::OverrideParameters", MatchingTags: parameterTags, SlotNames: ["shader_head_shader"] }] });
const wear = (id: string, tags: string[], parts: unknown[] = []) => item(id, { ActivatesTags: tags, VisualParts: parts });

const pixie = hair("hairs-pixie", [rule([HAT], "/Game/Test/UnderHat"), rule([HEAD], "")]);
const bun = hair("hairs-bun", [rule([BUN, HAT], "/Game/Test/NoBun")]);
const scalp = hair("hairs-scalp", [], [HOOD, HEAD]);
const check = (defs: SourceDefinition[], id: string) => sourceHairUnresolved(resolveSourceOutfit(defs, MEDIUM), id);

test("bare and single-rule headwear resolve", () => {
  assert.deepEqual(check([pixie], pixie.id), []);
  assert.deepEqual(check([pixie, wear("cap", [HAT])], pixie.id), []);
  assert.deepEqual(check([pixie, wear("helmet", [HEAD])], pixie.id), []);
});

test("conflicting mesh overrides are refused", () => {
  assert.match(check([pixie, wear("both", [HAT, HEAD])], pixie.id).join("; "), /conflicting mesh overrides/);
});

test("a partially matched multi-tag condition is refused", () => {
  assert.deepEqual(check([bun], bun.id), []);
  assert.match(check([bun, wear("cap", [HAT])], bun.id).join("; "), /multi-tag condition/);
});

test("an ambiguous scalp parameter condition is refused", () => {
  assert.deepEqual(check([scalp], scalp.id), []);
  assert.match(check([scalp, wear("hood", [HOOD])], scalp.id).join("; "), /multi-tag material parameter condition/);
});

test("another item's ambiguity does not block the hair", () => {
  const odd = wear("odd", ["Customization.Test.Other"],
    [part("/Game/Test/Odd", [rule(["Customization.Test.Other", "Customization.Test.Else"], "/Game/Test/Odd2")])]);
  const outfit = resolveSourceOutfit([pixie, odd], MEDIUM);
  assert.ok(outfit.items.odd.parts[0].unresolved.length);
  assert.deepEqual(sourceHairUnresolved(outfit, pixie.id), []);
});

test("an absent hair item never passes", () => {
  assert.equal(check([pixie], "hairs-absent").length, 1);
});
