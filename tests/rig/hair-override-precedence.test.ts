import { test } from "node:test";
import assert from "node:assert/strict";
import { explicitlyEmptiedPart, hairOverridePrecedenceGate, resolveSourceOutfit, type SourceDefinition } from "../../src/rig/SourceAssembly.ts";

// The gated "every ordering agrees" precedence for several matching hair TagOverrides
// (w43-hair-precedence, 22 Oct 2026). The rule never guesses the game's precedence: a part is
// resolved only when first-match-wins, last-match-wins and both specificity-then-order variants
// (most tags first, ties broken by first and by last, in authored array order) all select the same
// mesh or the same empty/hide. Any disagreement keeps today's refusal with today's messages.
// Evidence for the two real patterns: _docs/goal-100-2026-10-11/w43-afro-underhat/FINDINGS.md
// (DA_Hairs_AfroFade rules 0/1/2 under the jester and penguin hats; DA_Hairs_LowBun rule 2).

const MEDIUM = "Customization.Archetype.Medium";
const COVERS_HEAD = "Customization.Shape.PushHair.hat_covers_head";
const COVERS_UPPER = "Customization.Shape.PushHair.hat_covers_upper_hair";
const HOOD_HEAD = "Customization.Shape.PushHair.hood_covers_head";
const COVERS_BUN = "Customization.Shape.PushHair.hat_covers_bun";
const BASE = "/Game/Stub/SK_Hair.SK_Hair";
const UNDER_HAT = "/Game/Stub/SK_Hair_UnderHat.SK_Hair_UnderHat";
const NO_BUN = "/Game/Stub/SK_Hair_UnderHat_NoBun.SK_Hair_UnderHat_NoBun";
const OTHER = "/Game/Stub/SK_Hair_Other.SK_Hair_Other";
const MATERIAL = "/Game/Stub/MI_Hat.MI_Hat";

const soft = (value: string) => ({ AssetPathName: value, SubPathString: "" });
const hide = (tags: string[]) => ({ MatchingTags: tags, bOverrideMesh: true,
  ReplacementStaticMesh: soft(""), ReplacementSkeletalMesh: soft(""),
  bOverrideEffect: false, ReplacementEffect: soft(""), bOverrideMaterials: false, MaterialOverrides: [] });
const replace = (tags: string[], mesh: string) => ({ ...hide(tags), ReplacementSkeletalMesh: soft(mesh) });
const materialRule = (tags: string[]) => ({ ...hide(tags), bOverrideMaterials: true,
  MaterialOverrides: [{ Key: "m_hair", Value: soft(MATERIAL) }] });

function hair(rules: unknown[]): SourceDefinition {
  return { id: "hair", formatVersion: 1, source: "/Game/Stub/DA_Hair.DA_Hair", sourceSha256: "a".repeat(64),
    properties: { Slots: ["EBodySlot::Hair"], VisualParts: [{
      StaticMesh: soft(""), SkeletalMesh: soft(BASE), Effect: soft(""), TagOverrides: rules }] } } as unknown as SourceDefinition;
}

const gate = { hairOverridePrecedence: "agreeing-orderings" as const };
const hideWins = { hairOverridePrecedence: "hide-wins" as const };
// The jester and penguin hats activate all three covering tags at once.
const ALL_COVERING = [MEDIUM, COVERS_HEAD, COVERS_UPPER, HOOD_HEAD];
// The fedora-style hats activate the bun and upper-hair tags together.
const BUN_COVERING = [MEDIUM, COVERS_BUN, COVERS_UPPER];

const part = (definitions: SourceDefinition[], context: string[], options?: object) =>
  resolveSourceOutfit(definitions, context, options).items.hair.parts[0];

test("agreeing orderings resolve to the shared hide (the AfroFade jester pattern)", () => {
  const rules = [hide([COVERS_HEAD]), replace([COVERS_UPPER], UNDER_HAT), hide([HOOD_HEAD])];
  // Gate off: today's refusal.
  const off = part([hair(rules)], ALL_COVERING);
  assert.deepEqual(off.unresolved, ["conflicting mesh overrides: 0,1,2"]);
  assert.equal(off.hidden, false);
  assert.equal(off.skeletalMesh, BASE);
  // Gate on: first, last and both specificity-then-order winners all select an empty override.
  const on = part([hair(rules)], ALL_COVERING, gate);
  assert.deepEqual(on.unresolved, []);
  assert.equal(on.hidden, true);
  assert.equal(on.staticMesh, "");
  assert.equal(on.skeletalMesh, "");
  assert.deepEqual(on.rules, [0, 1, 2]);
  // The hidden part keeps its scalp evidence: every applied rule is single-tag and one empties it.
  assert.equal(explicitlyEmptiedPart(on), true);
});

test("agreeing orderings resolve to a shared replacement mesh, not only a shared hide", () => {
  // First and last select UNDER_HAT; the middle rule selects OTHER, so today refuses.
  const rules = [replace([COVERS_HEAD], UNDER_HAT), replace([COVERS_UPPER], OTHER), replace([HOOD_HEAD], UNDER_HAT)];
  assert.deepEqual(part([hair(rules)], ALL_COVERING).unresolved, ["conflicting mesh overrides: 0,1,2"]);
  const on = part([hair(rules)], ALL_COVERING, gate);
  assert.deepEqual(on.unresolved, []);
  assert.equal(on.hidden, false);
  assert.equal(on.skeletalMesh, UNDER_HAT);
  assert.deepEqual(on.rules, [0, 1, 2]);
});

test("disagreeing orderings keep today's refusal exactly (the LowBun multi-tag pattern)", () => {
  const rules = [replace([COVERS_UPPER], UNDER_HAT), replace([COVERS_BUN, COVERS_UPPER], NO_BUN)];
  // First-match-wins selects UNDER_HAT; last and both specificity variants select NO_BUN.
  const off = part([hair(rules)], BUN_COVERING);
  const on = part([hair(rules)], BUN_COVERING, gate);
  assert.deepEqual(on.unresolved, ["multi-tag condition 1"]);
  assert.deepEqual(on, off);
});

test("two disagreeing single-tag overrides stay refused under the gate", () => {
  const rules = [replace([COVERS_HEAD], UNDER_HAT), replace([COVERS_UPPER], OTHER)];
  const off = part([hair(rules)], ALL_COVERING);
  const on = part([hair(rules)], ALL_COVERING, gate);
  assert.deepEqual(on.unresolved, ["conflicting mesh overrides: 0,1"]);
  assert.deepEqual(on, off);
});

test("a multi-tag rule with any other action never participates", () => {
  // Both mesh overrides select an empty mesh, but the multi-tag one also overrides a material:
  // partially applying it would guess, so the part stays refused exactly as today.
  const rules = [hide([COVERS_UPPER]), materialRule([COVERS_BUN, COVERS_UPPER])];
  const off = part([hair(rules)], BUN_COVERING);
  const on = part([hair(rules)], BUN_COVERING, gate);
  assert.deepEqual(on.unresolved, ["multi-tag condition 1"]);
  assert.deepEqual(on, off);
});

test("a single matching multi-tag rule stays refused: several overrides must match", () => {
  const rules = [replace([COVERS_BUN, COVERS_UPPER], NO_BUN), replace([HOOD_HEAD], OTHER)];
  const on = part([hair(rules)], BUN_COVERING, gate);
  assert.deepEqual(on.unresolved, ["multi-tag condition 0"]);
  assert.deepEqual(on, part([hair(rules)], BUN_COVERING));
});

test("gate off is byte-identical: the default call equals the explicit off options", () => {
  const rules = [hide([COVERS_HEAD]), replace([COVERS_UPPER], UNDER_HAT), hide([HOOD_HEAD]),
    replace([COVERS_BUN, COVERS_UPPER], NO_BUN)];
  for (const context of [ALL_COVERING, BUN_COVERING, [MEDIUM]]) {
    const def = resolveSourceOutfit([hair(rules)], context);
    assert.deepEqual(resolveSourceOutfit([hair(rules)], context, {}), def);
    assert.deepEqual(resolveSourceOutfit([hair(rules)], context, { hairOverridePrecedence: undefined }), def);
  }
});

test("hairOverridePrecedenceGate: absent stays off, the two spellings select, unknown throws", () => {
  assert.equal(hairOverridePrecedenceGate(undefined), undefined);
  assert.equal(hairOverridePrecedenceGate("agreeing-orderings"), "agreeing-orderings");
  assert.equal(hairOverridePrecedenceGate("hide-wins"), "hide-wins");
  assert.throws(() => hairOverridePrecedenceGate("first-match-wins"), /Unknown hair override precedence/);
});

// The gated "hide-wins" precedence (w61, signed off 22 Oct 2026 hairPrecedenceHideWins): a
// disagreement the "agreeing-orderings" value refuses resolves to hidden when ANY candidate
// ordering selects an empty mesh replacement; every other disagreement keeps today's refusal,
// and every combination "agreeing-orderings" resolves resolves identically.

test("hide-wins resolves the disagreeing dual-tag case to hidden (the space-brain pattern)", () => {
  // The brain authors BOTH covering tags: AfroFade swaps to its UnderHat mesh for the upper-hair
  // tag and hides for the head tag, so the orderings disagree (first-match vs last-match).
  const rules = [replace([COVERS_UPPER], UNDER_HAT), hide([COVERS_HEAD])];
  // Gate off: today's refusal.
  assert.deepEqual(part([hair(rules)], ALL_COVERING).unresolved, ["conflicting mesh overrides: 0,1"]);
  const on = part([hair(rules)], ALL_COVERING, hideWins);
  assert.deepEqual(on.unresolved, []);
  assert.equal(on.hidden, true);
  assert.equal(on.staticMesh, "");
  assert.equal(on.skeletalMesh, "");
  assert.deepEqual(on.rules, [0, 1]);
  assert.equal(explicitlyEmptiedPart(on), true);
});

test("hide-wins resolves a multi-tag disagreement to hidden when any ordering hides", () => {
  // Last-match and both specificity variants select the empty multi-tag replacement; first-match
  // selects the single-tag one. Today refuses; hide-wins hides.
  const rules = [replace([COVERS_UPPER], UNDER_HAT), hide([COVERS_BUN, COVERS_UPPER])];
  assert.deepEqual(part([hair(rules)], BUN_COVERING).unresolved, ["multi-tag condition 1"]);
  const on = part([hair(rules)], BUN_COVERING, hideWins);
  assert.deepEqual(on.unresolved, []);
  assert.equal(on.hidden, true);
  assert.deepEqual(on.rules, [0, 1]);
});

test("hide-wins keeps today's refusal when no ordering hides", () => {
  // The same LowBun multi-tag pattern as above: every ordering selects a real mesh.
  const rules = [replace([COVERS_UPPER], UNDER_HAT), replace([COVERS_BUN, COVERS_UPPER], NO_BUN)];
  const off = part([hair(rules)], BUN_COVERING);
  const on = part([hair(rules)], BUN_COVERING, hideWins);
  assert.deepEqual(on.unresolved, ["multi-tag condition 1"]);
  assert.deepEqual(on, off);
});

test("hide-wins resolves every agreeing combination exactly as agreeing-orderings does", () => {
  const cases = [
    [hide([COVERS_HEAD]), replace([COVERS_UPPER], UNDER_HAT), hide([HOOD_HEAD])], // agreed hide
    [replace([COVERS_HEAD], UNDER_HAT), replace([COVERS_UPPER], OTHER), replace([HOOD_HEAD], UNDER_HAT)], // agreed mesh
    [replace([COVERS_UPPER], UNDER_HAT), replace([COVERS_BUN, COVERS_UPPER], NO_BUN)], // refused
  ];
  for (const [rules, context] of [[cases[0], ALL_COVERING], [cases[1], ALL_COVERING], [cases[2], BUN_COVERING]] as [unknown[], string[]][]) {
    assert.deepEqual(part([hair(rules as unknown[])], context, hideWins),
      part([hair(rules as unknown[])], context, gate));
  }
});
