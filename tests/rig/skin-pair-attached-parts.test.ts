import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachedStaticSourcePart, loadSourceSkinPair, loadSourceSkinPairAttachments, resolveSourceOutfit, sourceSkinPairParts,
  type SourceDefinition,
} from "../../src/rig/SourceAssembly.ts";

// (w128, 4 Nov 2026) A face may author an attached static beside its skin pair: the hollow-face and ballistic-gel
// skulls, static meshes on the body's head socket. It is never a pair part. sourceSkinPairParts lists it as `attached`,
// the planner records that as the pair's attachedParts, loadSourceSkinPair requires exactly those, and
// loadSourceSkinPairAttachments resolves only the recorded, visible ones through the ordinary attached-static route.

const ORIGIN = "http://attached-parts.test/";
const MEDIUM = "Customization.Archetype.Medium";
const FACE_REPLACEMENT = "Customization.HideMesh.FaceReplacement";
const HEAD_MESH = "/Game/T/SK_HollowFace.SK_HollowFace";
const BODY_MESH = "/Game/T/SK_Body_M.SK_Body_M";
const SKULL_MESH = "/Game/T/SM_Military_Skull.SM_Military_Skull";
const soft = (asset = "") => ({ AssetPathName: asset, SubPathString: "" });
const IDENTITY = { LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 }, LocalScale: { X: 1, Y: 1, Z: 1 } };
const part = (over: Record<string, unknown>) => ({
  StaticMesh: soft(), SkeletalMesh: soft(), Effect: soft(), bIsHeadMesh: false, bIsAttached: false, bAttachToHeadMesh: false,
  OptionalAttachmentMesh: soft(), OptionalHeadWrapMesh: soft(), AttachmentSocket: "None", ...IDENTITY,
  LogicModules: [], TagOverrides: [], ...over,
});
const hideRule = {
  MatchingTags: [FACE_REPLACEMENT], bOffsetTransform: false, OffsetPosition: { X: 0, Y: 0, Z: 0 },
  OffsetRotation: { Pitch: 0, Yaw: 0, Roll: 0 }, OffsetScale: { X: 1, Y: 1, Z: 1 }, bOverrideMesh: true,
  ReplacementStaticMesh: soft(), ReplacementSkeletalMesh: soft(), bOverrideEffect: false, ReplacementEffect: soft(),
  bOverrideMaterials: false, MaterialOverrides: [], bAddLogicModules: false, LogicModules: [],
};
const HEAD = part({ SkeletalMesh: soft(HEAD_MESH), bIsHeadMesh: true });
const BODY = part({ SkeletalMesh: soft(BODY_MESH) });
const SKULL = part({ StaticMesh: soft(SKULL_MESH), bIsAttached: true, AttachmentSocket: "head",
  LocalPosition: { X: -163.354, Y: -39.882668, Z: -0.003087 }, LocalRotation: { Pitch: -90, Yaw: 22.413612, Roll: -7.485082 },
  TagOverrides: [hideRule] });
const HEARTS = part({ Effect: soft("/Game/T/NS_Hearts.NS_Hearts"), bIsAttached: true, AttachmentSocket: "head" });
const FACE_ID = "head-test-skull";
const definition = (...parts: unknown[]) => ({ formatVersion: 1, id: FACE_ID, source: "T/head-test-skull.uasset",
  sourceSha256: "sha", properties: { Slots: ["EBodySlot::Head"], VisualParts: parts } }) as unknown as SourceDefinition;
const resolved = (parts: unknown[], tags: string[] = []) =>
  resolveSourceOutfit([definition(...parts)], [MEDIUM, ...tags]).items[FACE_ID];
const ON = { attachmentMirroredScale: false, mergedPartTransforms: false, facialHairForeignOverlays: false, activatedEffectParts: true };
const OFF = { ...ON, activatedEffectParts: false };

test("an authored attached static leaves the pair with or without the effect gate", () => {
  for (const gates of [ON, OFF]) {
    const split = sourceSkinPairParts(resolved([HEAD, BODY, SKULL]), gates);
    assert.deepEqual(split.parts.map(p => p.sourceIndex), [0, 1]);
    assert.deepEqual(split.attached, [2]);
    assert.deepEqual(split.dropped, []);
  }
});

test("the attached static is the same part when a rule hides it", () => {
  const hidden = resolved([HEAD, BODY, SKULL], [FACE_REPLACEMENT]);
  assert.equal(hidden.parts[2].hidden, true);
  assert.deepEqual(sourceSkinPairParts(hidden, ON).attached, [2]);
});

test("an attached static beside a dropped effect part: both leave the pair, each recorded on its own", () => {
  const split = sourceSkinPairParts(resolved([HEAD, BODY, SKULL, HEARTS]), ON);
  assert.deepEqual(split.parts.map(p => p.sourceIndex), [0, 1]);
  assert.deepEqual(split.attached, [2]);
  assert.deepEqual(split.dropped, [3]);
});

test("a static part with other authoring is not an attached static, so the pair still refuses", () => {
  for (const extra of [{ bIsAttached: false }, { Effect: soft("/Game/T/NS.NS") }, { bAttachToHeadMesh: true },
    { OptionalAttachmentMesh: soft("/Game/T/SM.SM") }, { SkeletalMesh: soft("/Game/T/SK.SK") }, { bIsHeadMesh: true }]) {
    const face = resolved([HEAD, BODY, { ...SKULL, ...extra }]);
    assert.equal(attachedStaticSourcePart(face.parts[2]), false, JSON.stringify(extra));
    assert.deepEqual(sourceSkinPairParts(face, OFF).attached, [], JSON.stringify(extra));
  }
});

// --- the loaders ------------------------------------------------------------------------------

const files = new Map<string, string>();
globalThis.fetch = (async (input: string | URL | Request) => {
  const body = files.get(String(input));
  return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
}) as typeof fetch;
(globalThis as { window?: unknown }).window = { location: { href: ORIGIN } };

function serve(name: string, attachedParts?: number[]): string {
  const base = `${ORIGIN}${name}`;
  const material = (mi: string) => ({ source: mi, defaultSource: mi, url: `materials/${mi}.json` });
  files.set(`${base}/skin-pairs.json`, JSON.stringify({ formatVersion: 1, items: { [FACE_ID]: {
    source: "T/head-test-skull.uasset", sourceSha256: "sha",
    head: { sourceIndex: 0, sourceMesh: HEAD_MESH, url: "meshes/head.glb", boundsOrigin: [0, -0.65, 166.17],
      materials: { shader_head_shader: material("/Game/T/MI_Head.MI_Head") } },
    body: { sourceIndex: 1, sourceMesh: BODY_MESH, url: "meshes/body.glb", boundsOrigin: [0, -0.91, 83.8],
      materials: { BaseBody: material("/Game/T/MI_Body.MI_Body") } },
    ...(attachedParts ? { attachedParts } : {}) } } }));
  files.set(`${base}/assets.json`, JSON.stringify({ formatVersion: 1, meshes: {}, materials: {}, materialVariants: {} }));
  return base;
}

test("loadSourceSkinPair requires exactly the recorded attached statics and returns them", async () => {
  const face = resolved([HEAD, BODY, SKULL]);
  const pair = await loadSourceSkinPair(FACE_ID, face, serve("recorded", [2]));
  assert.deepEqual(pair?.attachedParts, [2]);
  assert.equal(pair?.head.sourceIndex, 0);
  await assert.rejects(loadSourceSkinPair(FACE_ID, face, serve("unrecorded")), /definition changed/);
  await assert.rejects(loadSourceSkinPair(FACE_ID, resolved([HEAD, BODY]), serve("recorded-two", [2])), /definition changed/);
});

test("an ordinary two-part pair carries no attachedParts", async () => {
  const pair = await loadSourceSkinPair(FACE_ID, resolved([HEAD, BODY]), serve("two"));
  assert.equal(pair?.attachedParts, undefined);
  assert.deepEqual(await loadSourceSkinPairAttachments(resolved([HEAD, BODY]), pair!, serve("two-b")), []);
});

test("a hidden attached static brings no rig part; a recorded index that is not an attached static refuses", async () => {
  const base = serve("hidden", [2]);
  const hidden = resolved([HEAD, BODY, SKULL], [FACE_REPLACEMENT]);
  const pair = await loadSourceSkinPair(FACE_ID, hidden, base);
  assert.deepEqual(await loadSourceSkinPairAttachments(hidden, pair!, base), []);
  await assert.rejects(loadSourceSkinPairAttachments(resolved([HEAD, BODY, SKULL]), { ...pair!, attachedParts: [1] }, base),
    /definition changed/);
});

test("a visible recorded attached static goes through the ordinary route and its preserved-frame check", async () => {
  const base = serve("visible", [2]);
  const face = resolved([HEAD, BODY, SKULL]);
  const pair = await loadSourceSkinPair(FACE_ID, face, base);
  // The served index preserves no attachment body (nor skull mesh), so the ordinary attached-static route refuses
  // it exactly as it would for any item: the face pair adds no placement of its own.
  await assert.rejects(loadSourceSkinPairAttachments(face, pair!, base), /Missing preserved source attachment frame/);
});
