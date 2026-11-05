import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSourceOutfit, sourceSkinPairParts, type SourceDefinition } from "../../src/rig/SourceAssembly.ts";

// (w113, 2 Nov 2026) A skin recipient's activated-effect part (the white-valentines blank face's head-socket Niagara
// hearts) is not part of its skin pair under the signed-off activated-effect drop; the planner records the dropped
// indexes as the pair's droppedEffectParts and loadSourceSkinPair requires exactly those. Everything else is as before.

const soft = (asset = "") => ({ AssetPathName: asset, SubPathString: "" });
const IDENTITY = { LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 }, LocalScale: { X: 1, Y: 1, Z: 1 } };
const part = (over: Record<string, unknown>) => ({
  StaticMesh: soft(), SkeletalMesh: soft(), Effect: soft(), bIsHeadMesh: false, bIsAttached: false, bAttachToHeadMesh: false,
  OptionalAttachmentMesh: soft(), OptionalHeadWrapMesh: soft(), AttachmentSocket: "None", ...IDENTITY,
  LogicModules: [], TagOverrides: [], ...over,
});
const HEAD = part({ SkeletalMesh: soft("/Game/T/SK_BlankFace.SK_BlankFace"), bIsHeadMesh: true });
const BODY = part({ SkeletalMesh: soft("/Game/T/SK_Body_M.SK_Body_M") });
const HEARTS = part({ Effect: soft("/Game/T/NS_Hearts.NS_Hearts"), bIsAttached: true, AttachmentSocket: "head" });
const resolved = (...parts: unknown[]) => resolveSourceOutfit([{ formatVersion: 1, id: "head-test", source: "T/head-test.uasset",
  sourceSha256: "sha", properties: { Slots: ["EBodySlot::Head"], VisualParts: parts } } as unknown as SourceDefinition],
  ["Customization.Archetype.Medium"]).items["head-test"];
const ON = { attachmentMirroredScale: false, mergedPartTransforms: false, facialHairForeignOverlays: false, activatedEffectParts: true };
const OFF = { ...ON, activatedEffectParts: false };

test("under the gate the effect-only part leaves the pair and is recorded", () => {
  const split = sourceSkinPairParts(resolved(HEAD, BODY, HEARTS), ON);
  assert.deepEqual(split.parts.map(p => p.sourceIndex), [0, 1]);
  assert.deepEqual(split.dropped, [2]);
});

test("without the gate, or for a two-part face, nothing is dropped", () => {
  assert.equal(sourceSkinPairParts(resolved(HEAD, BODY, HEARTS), OFF).parts.length, 3);
  const two = resolved(HEAD, BODY);
  assert.deepEqual(sourceSkinPairParts(two, ON), { parts: two.parts, dropped: [], attached: [] });
});

test("an effect part with other authoring is not dropped, so the pair still refuses", () => {
  for (const extra of [{ bAttachToHeadMesh: true }, { StaticMesh: soft("/Game/T/SM.SM") },
    { OptionalAttachmentMesh: soft("/Game/T/SM.SM") }]) {
    const split = sourceSkinPairParts(resolved(HEAD, BODY, { ...HEARTS, ...extra }), ON);
    assert.equal(split.parts.length, 3, JSON.stringify(extra));
  }
});
