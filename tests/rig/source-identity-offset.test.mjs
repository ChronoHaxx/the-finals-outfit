// Regression fixtures retain the source-authored hoodie and earring override fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveSourceOutfit, resolveSourceRigParts } from "../../src/rig/SourceAssembly.ts";
const packet = JSON.parse(readFileSync(new URL("../fixtures/source-identity-offset.json", import.meta.url), "utf8"));

const HOODIE = "streetwear-techhoodie-cotton-black";
const EARRINGS = "bodycosmetics-earrings-chain-01-gold";
const TSHIRT = "casual-basictshirt-cotton-alfaacta";
const CONTEXT = ["Customization.Archetype.Medium"]; // the runtime's loadSourceOutfit context
const COVERED = "Customization.HideMesh.EarringsCovered";
const definition = id => structuredClone(packet.definitions[id]);

const EARRING_MESH = "/Game/Discovery/Characters/BodyCosmetics/Earrings/Chain_01/SM_Earrings_Chain_01_A.SM_Earrings_Chain_01_A";
const GOLD = "/Game/Discovery/Characters/BodyCosmetics/Earrings/Chain_01/Skins/Chain_01_Gold/MI_Earrings_Chain_01_Gold_A.MI_Earrings_Chain_01_Gold_A";
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const socket = { bone: "stub_head_bone", parentRest: IDENTITY, rest: IDENTITY, restScale: [1, 1, 1] };
// Synthetic index entries only, so the rig boundary can be exercised; not recovered asset data.
const STUB_ASSETS = {
  formatVersion: 1,
  meshes: { [EARRING_MESH]: { url: "stub/earring.glb", kind: "static", slots: [{ slot: "Earrings_Chain_01_A", material: "stub-default" }] } },
  materials: { [GOLD]: "stub/gold.json" },
  attachmentBody: { source: "stub-body", url: "stub/body.glb", restBones: {} },
  attachmentFrames: { headComponents: { "stub-head": { sourceSha256: "stub", sockets: { earring_01_l: socket, earring_01_r: socket } } } },
};

// Resolve the approved hoodie with earrings whose parts' EarringsCovered rules are edited first.
function underHood(edit) {
  const earrings = definition(EARRINGS);
  for (const part of earrings.properties.VisualParts) edit(part.TagOverrides[0], part);
  return resolveSourceOutfit([definition(HOODIE), earrings], CONTEXT).items[EARRINGS];
}
function assertBlocked(item, reason) {
  for (const part of item.parts) {
    assert.equal(part.hidden, false);
    assert.ok(part.unresolved.includes(reason), `part ${part.sourceIndex} unresolved: ${JSON.stringify(part.unresolved)}`);
  }
  assert.equal(item.hidden, false);
  assert.throws(() => resolveSourceRigParts(item, STUB_ASSETS), /Unsupported source assembly part 0/);
}

test("approved Tech Hoodie hides the approved Chain 01 Gold earrings without unresolved overrides", () => {
  for (const order of [[HOODIE, EARRINGS], [EARRINGS, HOODIE]]) {
    const outfit = resolveSourceOutfit(order.map(definition), CONTEXT);
    const earrings = outfit.items[EARRINGS];
    // The reported runtime failure was "Unsupported source assembly part 0" from this call.
    assert.deepEqual(resolveSourceRigParts(earrings, STUB_ASSETS), []);
    assert.deepEqual(earrings.parts.map(p => ({ hidden: p.hidden, unresolved: p.unresolved, rules: p.rules,
      staticMesh: p.staticMesh, skeletalMesh: p.skeletalMesh, effect: p.effect })),
    [0, 1].map(() => ({ hidden: true, unresolved: [], rules: [0], staticMesh: "", skeletalMesh: "", effect: "" })));
    assert.equal(earrings.hidden, true);
    assert.ok(outfit.tags.includes(COVERED));
    assert.deepEqual(outfit.items[HOODIE].parts.map(p => [p.hidden, p.unresolved]), [[false, []]]);
  }
});

test("without the hood the approved earrings are visible and reach the attachment boundary", () => {
  for (const selection of [[EARRINGS], [TSHIRT, EARRINGS]]) {
    const outfit = resolveSourceOutfit(selection.map(definition), CONTEXT);
    const earrings = outfit.items[EARRINGS];
    assert.ok(!outfit.tags.includes(COVERED));
    assert.equal(earrings.hidden, false);
    for (const part of earrings.parts) {
      assert.deepEqual([part.hidden, part.unresolved, part.rules, part.staticMesh], [false, [], [], EARRING_MESH]);
      assert.equal(part.materials.Earrings_Chain_01_A, GOLD);
    }
    const rig = resolveSourceRigParts(earrings, STUB_ASSETS);
    assert.deepEqual(rig.map(p => [p.sourceIndex, p.sourceMesh, p.attachment.socket, p.attachment.frame.kind,
      p.materials.Earrings_Chain_01_A.source]),
    [[0, EARRING_MESH, "earring_01_l", "head-component", GOLD], [1, EARRING_MESH, "earring_01_r", "head-component", GOLD]]);
  }
});

test("a complete identity offset is a no-op for other single-tag overrides too", () => {
  const item = underHood(rule => {
    Object.assign(rule, { bOverrideMesh: false, bOverrideMaterials: true,
      MaterialOverrides: [{ Key: "Earrings_Chain_01_A", Value: { AssetPathName: "/Game/Stub/MI_Covered.MI_Covered" } }] });
  });
  for (const part of item.parts) {
    assert.deepEqual([part.hidden, part.unresolved, part.staticMesh], [false, [], EARRING_MESH]);
    assert.equal(part.materials.Earrings_Chain_01_A, "/Game/Stub/MI_Covered.MI_Covered");
  }
});

const PLACEMENT = "unsupported placement or logic override 0";
const offsets = {
  "non-identity position": rule => { rule.OffsetPosition.X = 0.5; },
  "non-identity rotation": rule => { rule.OffsetRotation.Yaw = 90; },
  "non-identity scale": rule => { rule.OffsetScale.Z = 0.9; },
  "missing offset": rule => { delete rule.OffsetPosition; delete rule.OffsetRotation; delete rule.OffsetScale; },
  "missing scale": rule => { delete rule.OffsetScale; },
  "partial position": rule => { delete rule.OffsetPosition.Z; },
  "unknown extra component": rule => { rule.OffsetPosition.W = 0; },
  "numeric string": rule => { rule.OffsetRotation.Pitch = "0"; },
  "null rotation": rule => { rule.OffsetRotation = null; },
  "array scale": rule => { rule.OffsetScale = [1, 1, 1]; },
  "NaN position": rule => { rule.OffsetPosition.X = NaN; },
  "infinite scale": rule => { rule.OffsetScale.Y = Infinity; },
};
for (const [name, edit] of Object.entries(offsets)) {
  test(`offset transform stays unsupported: ${name}`, () => assertBlocked(underHood(edit), PLACEMENT));
}

test("logic-module overrides stay unsupported alongside an identity offset", () => {
  assertBlocked(underHood(rule => { rule.bAddLogicModules = true; }), PLACEMENT);
});

test("multi-tag conditions stay ambiguous", () => {
  const tags = [COVERED, "Customization.HideMesh.WearingHood"];
  assertBlocked(underHood(rule => { rule.MatchingTags = tags; }), "multi-tag condition 0");
  assertBlocked(underHood(rule => { Object.assign(rule, { MatchingTags: tags, bOverrideMesh: false });
    rule.OffsetScale.X = 2; }), "multi-tag condition 0");
  // With nothing but an identity offset, the rule has no effect under any all/any matching.
  const noop = underHood(rule => { Object.assign(rule, { MatchingTags: tags, bOverrideMesh: false }); });
  assert.deepEqual(noop.parts.map(p => [p.hidden, p.unresolved]), [[false, []], [false, []]]);
});

test("conflicting mesh and material replacements stay unresolved", () => {
  const second = rule => ({ ...structuredClone(rule), MatchingTags: ["Customization.HideMesh.WearingHood"] });
  assertBlocked(underHood((rule, part) => {
    part.TagOverrides.push({ ...second(rule), ReplacementStaticMesh: { AssetPathName: EARRING_MESH } });
  }), "conflicting mesh overrides: 0,1");
  const material = path => [{ Key: "Earrings_Chain_01_A", Value: { AssetPathName: path } }];
  assertBlocked(underHood((rule, part) => {
    Object.assign(rule, { bOverrideMaterials: true, MaterialOverrides: material("/Game/Stub/MI_A.MI_A") });
    part.TagOverrides.push({ ...second(rule), MaterialOverrides: material("/Game/Stub/MI_B.MI_B") });
  }), "conflicting material overrides: Earrings_Chain_01_A");
});

test("an authored effect keeps the part visible after an identity-offset mesh removal", () => {
  const effect = "/Game/Stub/NS_Effect.NS_Effect";
  const item = underHood((rule, part) => { part.Effect = { AssetPathName: effect }; });
  for (const part of item.parts)
    assert.deepEqual([part.hidden, part.unresolved, part.staticMesh, part.effect], [false, [], "", effect]);
  assert.throws(() => resolveSourceRigParts(item, STUB_ASSETS), /Unsupported source assembly part 0/);
});
