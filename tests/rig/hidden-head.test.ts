import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { CharacterRig } from "../../src/rig/CharacterRig.ts";
import {
  explicitlyEmptiedPart, loadSourceSkinPair, resolveSourceOutfit, sourceHairWithoutScalp,
  omittedSourceHead,
  type SourceDefinition, type SourceRigPart,
} from "../../src/rig/SourceAssembly.ts";

// A headwear choice can explicitly replace the equipped face's HEAD mesh with nothing. The body of
// that same face stays, and so does its recovered skin. This file pins what the runtime may do with
// that: omit the head's own resources entirely when the selected hair needs no scalp, keep the body,
// refuse the combination when the hair still has geometry, restore the exact head when it is
// uncovered, and never leave a socket hanging off a head that is not in the scene.

const ORIGIN = "http://hidden-head.test/";
const FACE_ID = "head-face-09-base";
const FACE_SOURCE = "Test/Heads/DA_Head_Face_09_Base.uasset";
const HEAD_MESH = "/Game/Test/Heads/SK_Head_Face_09.SK_Head_Face_09";
const BODY_MESH = "/Game/Test/Body/SK_Body_M.SK_Body_M";
const HEAD_MI = "/Game/Test/Heads/MI_Head_Face_09.MI_Head_Face_09";
const BODY_MI = "/Game/Test/Heads/MI_Body_Face_09.MI_Body_Face_09";
const SKIN_MI = "/Game/Test/Body/M_Skin.M_Skin";
const HAIR_MESH = "/Game/Test/Hairs/SM_Bob.SM_Bob";
const UNDERHAT_MESH = "/Game/Test/Hairs/SM_Bob_Underhat.SM_Bob_Underhat";
const CAP_MESH = "/Game/Test/Hats/SM_Cap.SM_Cap";
const MEDIUM = "Customization.Archetype.Medium";
const FACE_REPLACEMENT = "Customization.HideMesh.FaceReplacement";
const COVERS_HEAD = "Customization.Shape.PushHair.hat_covers_head";
const COVERS_UPPER = "Customization.Shape.PushHair.hat_covers_upper_hair";

// --- source fixtures --------------------------------------------------------------------------

const soft = (asset = "") => ({ AssetPathName: asset, SubPathString: "" });
const IDENTITY = {
  LocalPosition: { X: 0, Y: 0, Z: 0 },
  LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
  LocalScale: { X: 1, Y: 1, Z: 1 },
};
const rule = (tag: string, over: Record<string, unknown> = {}) => ({
  MatchingTags: [tag], bOffsetTransform: false,
  OffsetPosition: { X: 0, Y: 0, Z: 0 }, OffsetRotation: { Pitch: 0, Yaw: 0, Roll: 0 }, OffsetScale: { X: 1, Y: 1, Z: 1 },
  bOverrideMesh: false, ReplacementStaticMesh: soft(), ReplacementSkeletalMesh: soft(),
  bOverrideEffect: false, ReplacementEffect: soft(),
  bOverrideMaterials: false, MaterialOverrides: [], bAddLogicModules: false, LogicModules: [], ...over,
});
const emptyMesh = (tag: string) => rule(tag, { bOverrideMesh: true });
const skinned = (mesh: string, head: boolean, overrides: unknown[]) => ({
  StaticMesh: soft(), SkeletalMesh: soft(mesh), Effect: soft(), bIsHeadMesh: head, bIsAttached: false,
  bAttachToHeadMesh: false, OptionalAttachmentMesh: soft(), AttachmentSocket: "None",
  ...IDENTITY, LogicModules: [], TagOverrides: overrides,
});
const attached = (mesh: string, overrides: unknown[]) => ({
  StaticMesh: soft(mesh), SkeletalMesh: soft(), Effect: soft(), bIsHeadMesh: false, bIsAttached: true,
  bAttachToHeadMesh: false, OptionalAttachmentMesh: soft(), AttachmentSocket: "head",
  LocalPosition: { X: -163.35, Y: -39.89, Z: 0 }, LocalRotation: { Pitch: -90, Yaw: 159.4, Roll: -144.5 },
  LocalScale: { X: 1, Y: 1, Z: 1 }, LogicModules: [], TagOverrides: overrides,
});
const definition = (id: string, properties: Record<string, unknown>): SourceDefinition =>
  ({ formatVersion: 1, id, source: `Test/${id}.uasset`, sourceSha256: `${id}-sha`, properties }) as unknown as SourceDefinition;

const face = (): SourceDefinition => ({
  ...definition(FACE_ID, {
    Slots: ["EBodySlot::Head"], ActivatesTags: ["Customization.Slot.Head"],
    MaterialOverrides: [{ Key: "BaseBody", Value: soft(BODY_MI) }],
    VisualParts: [
      skinned(HEAD_MESH, true, [emptyMesh(FACE_REPLACEMENT)]),
      skinned(BODY_MESH, false, [emptyMesh("Customization.HideMesh.BodyReplacement")]),
    ],
  }),
  source: FACE_SOURCE,
});

const donors = () => [
  { MaterialInstance: soft("/Game/Test/Hairs/MI_Scalp.MI_Scalp"),
    Behavior: "ECustomizationMaterialBehavior::OverrideParameters", MatchingTags: [], SlotNames: ["shader_head_shader"] },
  { MaterialInstance: soft("/Game/Test/Hairs/MI_HairColor.MI_HairColor"),
    Behavior: "ECustomizationMaterialBehavior::OverrideParameters", MatchingTags: [], SlotNames: ["M_Hair"] },
];
const hair = (id: string, parts: unknown[]) => definition(id, {
  Slots: ["EBodySlot::Hair"], ActivatesTags: ["Customization.Slot.Hair"],
  ActivatesMaterialParameters: donors(), ...(parts.length ? { VisualParts: parts } : {}),
});
const HAIR_EMPTIED = "hairs-bob-emptied";       // its one part is replaced with nothing under a hat
const HAIR_UNDERHAT = "hairs-bob-underhat";     // the same part is replaced with a different mesh
const HAIR_SCALP_ONLY = "hairs-waves-scalp";    // donors only: no visual part at all
const hairEmptied = () => hair(HAIR_EMPTIED, [attached(HAIR_MESH, [emptyMesh(COVERS_HEAD)])]);
const hairUnderhat = () => hair(HAIR_UNDERHAT,
  [attached(HAIR_MESH, [rule(COVERS_UPPER, { bOverrideMesh: true, ReplacementStaticMesh: soft(UNDERHAT_MESH) })])]);
const hairScalpOnly = () => hair(HAIR_SCALP_ONLY, []);
const headwear = (id: string, tags: string[]) => definition(id, {
  Slots: ["EBodySlot::Headwear"], ActivatesTags: tags, VisualParts: [attached(CAP_MESH, [])],
});
const HELMET = headwear("robots-helmet", [COVERS_HEAD, FACE_REPLACEMENT]);
const MASK_ONLY = headwear("fancydress-mask", [FACE_REPLACEMENT]);          // hides the face, not the hair
const UPPER_HAT = headwear("streetwear-cap", [COVERS_UPPER, FACE_REPLACEMENT]);

const outfit = (definitions: SourceDefinition[]) => resolveSourceOutfit(definitions, [MEDIUM]);
const hairOf = (definitions: SourceDefinition[], id: string) => {
  const resolved = outfit(definitions);
  return { id, item: resolved.items[id], outfit: resolved };
};

// --- served files -----------------------------------------------------------------------------

const files = new Map<string, string>();
const requests: string[] = [];
const holds = new Map<string, Promise<void>>();
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  requests.push(url);
  const hold = holds.get(url);
  if (hold) await hold;
  const body = files.get(url);
  return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
}) as typeof fetch;
(globalThis as { window?: unknown }).window = { location: { href: ORIGIN } };
// BodyDecals also uses the browser Image constructor. A failed optional mask is enough for
// these resource/transaction tests; actual mask pixels are exercised in the browser checks.
(globalThis as { Image?: unknown }).Image = class {
  onerror?: () => void;
  set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
};
// three's ImageLoader needs a DOM element to start a texture load. A visible head registers its
// sibling body mask on commit; nothing here needs the pixels, so the request is recorded and
// never completes.
if (!(globalThis as { document?: unknown }).document)
  (globalThis as { document?: unknown }).document = {
    createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, src: "" }),
    createElement: () => ({ addEventListener() {}, removeEventListener() {}, src: "" }),
  };

function serveMaterial(base: string, name: string): void {
  const shader = `ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1) {\n  ReconstructedSurface surface; // ${name}\n  return surface;\n}\n`;
  files.set(`${base}/materials/${name}.glsl`, shader);
  files.set(`${base}/materials/${name}.json`, JSON.stringify({ formatVersion: 1, itemId: name, shader: `${name}.glsl`,
    shaderSha256: createHash("sha256").update(shader).digest("hex"), textures: [], requiredUvSets: [0] }));
}

/** One isolated copy of the published index, so a cached fetch of another test's copy can never
 *  make "this was not requested" true by accident. */
function serve(name: string, index?: Record<string, unknown>) {
  const base = `${ORIGIN}${name}`;
  files.set(`${base}/skin-pairs.json`, JSON.stringify(index ?? {
    formatVersion: 1,
    items: {
      [FACE_ID]: {
        source: FACE_SOURCE, sourceSha256: "face-sha",
        head: { sourceIndex: 0, sourceMesh: HEAD_MESH, url: "meshes/head.glb", boundsOrigin: [0, -0.65, 166.17],
          materials: { shader_head_shader: { source: HEAD_MI, defaultSource: HEAD_MI,
            url: "materials/head.json", legacyName: "MI_Head" } } },
        body: { sourceIndex: 1, sourceMesh: BODY_MESH, url: "meshes/body.glb", boundsOrigin: [0, -0.91, 83.8],
          materials: { BaseBody: { source: BODY_MI, defaultSource: SKIN_MI, url: "materials/body.json" } } },
      },
    },
  }));
  files.set(`${base}/assets.json`, JSON.stringify({ formatVersion: 1, meshes: {}, materials: {}, materialVariants: {} }));
  serveMaterial(base, "head");
  serveMaterial(base, "body");
  return { base, assets: `${base}/assets.json`, headMesh: `${base}/meshes/head.glb`, bodyMesh: `${base}/meshes/body.glb`,
    headMaterial: `${base}/materials/head.json`, bodyMaterial: `${base}/materials/body.json`,
    legacyHead: `${ORIGIN}models/${name}-legacy-head.glb` };
}

// --- resolver ----------------------------------------------------------------------------------

test("the source head part is emptied by an explicit mesh replacement, not by a bare flag", () => {
  const resolved = outfit([face(), hairEmptied(), HELMET]);
  const [head, body] = resolved.items[FACE_ID].parts;
  assert.equal(head.hidden, true);
  assert.deepEqual(head.rules, [0], "the FaceReplacement rule is the one that fired");
  assert.equal(head.skeletalMesh, "", "the resolver keeps the replacement, which is nothing");
  assert.equal(body.hidden, false, "the paired body is untouched");
  assert.equal(resolved.items[FACE_ID].hidden, false, "the face item itself is not hidden");
  assert.equal(explicitlyEmptiedPart(head), true);
  assert.equal(explicitlyEmptiedPart(body), false);
  // The same part with its hidden flag forced on, but no applied rule to show for it.
  assert.equal(explicitlyEmptiedPart({ ...body, hidden: true, skeletalMesh: "", rules: [] }), false);
  // A rule that replaced the mesh with another mesh is not an emptied part either.
  const underhat = outfit([face(), hairUnderhat(), UPPER_HAT]).items[HAIR_UNDERHAT].parts[0];
  assert.equal(underhat.staticMesh, UNDERHAT_MESH);
  assert.equal(explicitlyEmptiedPart({ ...underhat, hidden: true, staticMesh: "" }), false,
    "the applied rule names a replacement mesh, so nothing was emptied");
});

test("a hair choice without geometry is recognised, and every other one is refused", () => {
  const emptied = hairOf([face(), hairEmptied(), HELMET], HAIR_EMPTIED);
  assert.deepEqual(sourceHairWithoutScalp(emptied.id, emptied.item), { kind: "hidden", id: HAIR_EMPTIED });
  const scalp = hairOf([face(), hairScalpOnly(), HELMET], HAIR_SCALP_ONLY);
  assert.equal(scalp.item.parts.length, 0);
  assert.equal(scalp.item.hidden, false, "a material-only choice has no part to hide");
  assert.deepEqual(sourceHairWithoutScalp(scalp.id, scalp.item), { kind: "material-only", id: HAIR_SCALP_ONLY });
  assert.deepEqual(sourceHairWithoutScalp(undefined, undefined), { kind: "none" });
  // Visible geometry, under a covering item that only hides the face.
  const visible = hairOf([face(), hairEmptied(), MASK_ONLY], HAIR_EMPTIED);
  assert.equal(visible.item.parts[0].hidden, false);
  assert.equal(sourceHairWithoutScalp(visible.id, visible.item), undefined);
  // A replaced under-hat mesh is still geometry.
  const under = hairOf([face(), hairUnderhat(), UPPER_HAT], HAIR_UNDERHAT);
  assert.equal(sourceHairWithoutScalp(under.id, under.item), undefined);
  // A hair the source path cannot resolve gets no permission from the absence of its item.
  assert.equal(sourceHairWithoutScalp("hairs-legacy-only", undefined), undefined);
});

// --- the published pair --------------------------------------------------------------------------

test("an emptied head is omitted, keeps the recovered body, and requests no scalp variant", async () => {
  const served = serve("omitted-scalp");
  const resolved = outfit([face(), hairScalpOnly(), HELMET]);
  const before = requests.length;
  const pair = await loadSourceSkinPair(FACE_ID, resolved.items[FACE_ID], served.base,
    resolved.materialParameters.filter(p => p.itemId === HAIR_SCALP_ONLY),
    { id: HAIR_SCALP_ONLY, item: resolved.items[HAIR_SCALP_ONLY] });
  assert.ok(pair, "the face is still a published skin pair");
  assert.deepEqual(pair.headOmitted,
    { sourceMesh: HEAD_MESH, rules: [0], hair: { kind: "material-only", id: HAIR_SCALP_ONLY } });
  // The index's own record of the head is retained, exactly as published.
  assert.equal(pair.head.sourceMesh, HEAD_MESH);
  assert.equal(pair.head.sourceIndex, 0);
  assert.equal(pair.head.materials.shader_head_shader.parameterOverrides, undefined,
    "no donor is bound to a recipient that is not there");
  assert.equal(pair.body.url, served.bodyMesh);
  assert.equal(pair.body.materials.BaseBody.url, served.bodyMaterial, "the body keeps its recovered skin");
  assert.deepEqual(requests.slice(before).filter(url => url === served.assets), [],
    "no scalp material variant is looked up for an omitted head");
});

test("no hair at all also omits the head, and the same donors still need a variant with one", async () => {
  const bare = serve("omitted-bare");
  const resolved = outfit([face(), HELMET]);
  const pair = await loadSourceSkinPair(FACE_ID, resolved.items[FACE_ID], bare.base, [], { id: undefined });
  assert.deepEqual(pair!.headOmitted!.hair, { kind: "none" });
  assert.equal(pair!.headOmitted!.sourceMesh, HEAD_MESH);

  // The control: the same scalp-only hair with a VISIBLE head still has to bind its donor, and the
  // published index has no variant for it — so the omission above is what skipped that lookup.
  const visible = serve("visible-scalp");
  const uncovered = outfit([face(), hairScalpOnly()]);
  await assert.rejects(loadSourceSkinPair(FACE_ID, uncovered.items[FACE_ID], visible.base,
    uncovered.materialParameters.filter(p => p.itemId === HAIR_SCALP_ONLY),
    { id: HAIR_SCALP_ONLY, item: uncovered.items[HAIR_SCALP_ONLY] }),
    /Unvalidated skin parameter variant: shader_head_shader/);
  assert.ok(requests.includes(visible.assets), "a real recipient does look the variant up");
});

test("an emptied head stays unsupported without a hair selection, with hair that still has geometry, or with the wrong mesh", async () => {
  const served = serve("unsupported");
  const covered = outfit([face(), hairEmptied(), HELMET]);
  // No hair selection supplied at all: the previous contract, unchanged.
  await assert.rejects(loadSourceSkinPair(FACE_ID, covered.items[FACE_ID], served.base),
    /Unsupported source skin pair placement or replacement/);
  // Visible hair with a hidden head remains out of scope in this pass.
  const masked = outfit([face(), hairEmptied(), MASK_ONLY]);
  await assert.rejects(loadSourceSkinPair(FACE_ID, masked.items[FACE_ID], served.base, [],
    { id: HAIR_EMPTIED, item: masked.items[HAIR_EMPTIED] }),
    /Unsupported source skin pair placement or replacement/);
  // A legacy hair the source path does not resolve gets no permission from its absence.
  await assert.rejects(loadSourceSkinPair(FACE_ID, covered.items[FACE_ID], served.base, [],
    { id: "hairs-legacy-only", item: undefined }),
    /Unsupported source skin pair placement or replacement/);
  // Malformed evidence: the hidden part's authored mesh is not the head this index publishes.
  const renamed = serve("renamed-head", JSON.parse(files.get(`${served.base}/skin-pairs.json`)!.replace(HEAD_MESH, `${HEAD_MESH}_Other`)));
  await assert.rejects(loadSourceSkinPair(FACE_ID, covered.items[FACE_ID], renamed.base, [], { id: undefined }),
    /Unsupported source skin pair placement or replacement/);
});

test("omission does not relax wrapping, attachment, native rule or scalp donor support", () => {
  const resolved = outfit([face(), hairScalpOnly(), HELMET]);
  const pair = { sourceIndex: 0, sourceMesh: HEAD_MESH };
  const selection = { id: HAIR_SCALP_ONLY, item: resolved.items[HAIR_SCALP_ONLY] };
  for (const mutate of [
    (p: any) => { p.definition.WrapDeformation = { bIsWrapDeformed: true }; },
    (p: any) => { p.definition.bAttachToHeadMesh = true; },
    (p: any) => { p.definition.TagOverrides[0].MatchingTags.push("unknown"); },
    (p: any) => { p.definition.TagOverrides[0].bAddLogicModules = true; },
    (p: any) => { p.definition.LocalPosition.X = 1; },
  ]) {
    const item = structuredClone(resolved.items[FACE_ID]); mutate(item.parts[0]);
    assert.equal(omittedSourceHead(item, pair, selection), undefined);
  }
  const bodyDonor = structuredClone(selection.item);
  bodyDonor.materialParameters![0].slots = ["BaseBody"];
  assert.equal(sourceHairWithoutScalp(HAIR_SCALP_ONLY, bodyDonor), undefined);
});

test("uncovering the head restores the published pair with no omission and its own materials", async () => {
  const served = serve("restored");
  const uncovered = outfit([face(), hairEmptied()]);
  const pair = await loadSourceSkinPair(FACE_ID, uncovered.items[FACE_ID], served.base, [],
    { id: HAIR_EMPTIED, item: uncovered.items[HAIR_EMPTIED] });
  assert.equal(pair!.headOmitted, undefined, "nothing empties the head now");
  assert.equal(pair!.head.url, served.headMesh);
  assert.equal(pair!.head.materials.shader_head_shader.url, served.headMaterial);
  assert.equal(pair!.body.materials.BaseBody.url, served.bodyMaterial);
});

// --- the rig ---------------------------------------------------------------------------------------

const HEAD_REST = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.6, 0.01),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.1, -0.3)), new THREE.Vector3(1, 1, 1));

const bone = (name: string, matrix: THREE.Matrix4, parent?: THREE.Bone) => {
  const created = new THREE.Bone();
  created.name = name;
  parent?.updateWorldMatrix(true, false);
  (parent ? matrix.clone().premultiply(parent.matrixWorld.clone().invert()) : matrix)
    .decompose(created.position, created.quaternion, created.scale);
  parent?.add(created);
  created.updateWorldMatrix(true, false);
  return created;
};

function surface(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

/** The staging GLBs the rig asks for when a head IS visible: the preserved head's own sections, and
 *  the legacy preview head whose materials they clone. */
function headGltf(): THREE.Group {
  const geometry = surface();
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const material = new THREE.MeshStandardMaterial({ name: "source-head" });
  material.userData.sourceSlot = { MaterialSlotName: "shader_head_shader" };
  const group = new THREE.Group();
  const root = bone("root", new THREE.Matrix4());
  const head = bone("head", HEAD_REST, root);
  group.add(root);
  group.updateMatrixWorld(true);
  const bones = [root, head];
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.bind(new THREE.Skeleton(bones, bones.map(b => b.matrixWorld.clone().invert())));
  group.add(mesh);
  return group;
}
const legacyGltf = () => new THREE.Group().add(new THREE.Mesh(surface(), new THREE.MeshStandardMaterial({ name: "MI_Head" })));

function harness(bodyUrl: string) {
  const loads: string[] = [];
  const root = new THREE.Group();
  const driverRoot = bone("root", new THREE.Matrix4());
  root.add(driverRoot);
  bone("head", HEAD_REST, driverRoot);
  root.updateMatrixWorld(true);
  const driverBones = [driverRoot, ...driverRoot.children as THREE.Bone[]];
  const bonesByName = new Map(driverBones.map(b => [b.name, b]));
  const bodyRestInverses = new Map(driverBones.map(b => [b.name, b.matrixWorld.clone().invert()]));
  const legacyBody = new THREE.MeshStandardMaterial({ name: "legacy-body" });
  const body = new THREE.SkinnedMesh(surface(), legacyBody);
  body.userData.sourceBody = true;
  body.userData.sourceBodyUrl = bodyUrl;
  const bodyScene = new THREE.Group().add(body);
  const rig = new CharacterRig({ loadAsync: async (url: string) => {
    loads.push(String(url));
    return { scene: String(url).includes("legacy-head") ? legacyGltf() : headGltf() };
  } } as never, root);
  const internals = rig as unknown as {
    skeleton: THREE.Skeleton; bonesByName: Map<string, THREE.Bone>;
    bodyRestInverses: Map<string, THREE.Matrix4>; bodyScene: THREE.Object3D;
  };
  internals.skeleton = new THREE.Skeleton(driverBones);
  body.bind(internals.skeleton);
  internals.bonesByName = bonesByName;
  internals.bodyRestInverses = bodyRestInverses;
  internals.bodyScene = bodyScene;
  root.add(bodyScene);
  return { rig, root, body, legacyBody, loads };
}

const faceItem = (pair: unknown, url: string) => ({ id: FACE_ID, slot: "face" as never, url, sourceSkinPair: pair as never });

async function omittedPair(name: string) {
  const served = serve(name);
  const resolved = outfit([face(), hairScalpOnly(), HELMET]);
  const pair = await loadSourceSkinPair(FACE_ID, resolved.items[FACE_ID], served.base,
    resolved.materialParameters.filter(p => p.itemId === HAIR_SCALP_ONLY),
    { id: HAIR_SCALP_ONLY, item: resolved.items[HAIR_SCALP_ONLY] });
  assert.ok(pair?.headOmitted, "the fixture is the omitted case");
  return { served, pair };
}

test("a prepared appearance waits for its covering and commits or releases only once", async () => {
  const { served, pair } = await omittedPair("deferred-covering");
  const { rig, body, legacyBody } = harness(served.bodyMesh);
  const prepared = await rig.prepareSourceItems([faceItem(pair, served.legacyHead)]);
  assert(prepared); assert.equal(body.material, legacyBody); assert.equal(rig.equippedItemId('face'), undefined);
  assert.equal(prepared.commit(), true); const committed = body.material;
  prepared.release(); assert.equal(body.material, committed); assert.equal(prepared.commit(), false);
  rig.dispose();
});

test("a failed covering can discard prepared skin without changing the current appearance", async () => {
  const { served, pair } = await omittedPair("discard-covering");
  const { rig, body, legacyBody } = harness(served.bodyMesh);
  const prepared = await rig.prepareSourceItems([faceItem(pair, served.legacyHead)]);
  assert(prepared); prepared.release(); prepared.release();
  assert.equal(prepared.commit(), false); assert.equal(body.material, legacyBody);
  assert.equal(rig.equippedItemId('face'), undefined); rig.dispose();
});

test("aborting after preparation prevents a late appearance commit", async () => {
  const { served, pair } = await omittedPair("abort-prepared-covering");
  const { rig, body, legacyBody } = harness(served.bodyMesh), controller = new AbortController();
  const prepared = await rig.prepareSourceItems([faceItem(pair, served.legacyHead)], [], controller.signal);
  assert(prepared); controller.abort(); assert.equal(prepared.commit(), false);
  assert.equal(body.material, legacyBody); assert.equal(rig.equippedItemId('face'), undefined); rig.dispose();
});

test("an omitted head fetches nothing of its own and still stages the recovered body skin", async () => {
  const { served, pair } = await omittedPair("rig-omitted");
  const { rig, root, body, legacyBody, loads } = harness(served.bodyMesh);
  const before = requests.length;
  assert.equal(await rig.equipSourceItems([faceItem(pair, served.legacyHead)]), true);
  assert.deepEqual(loads, [], "no head mesh and no legacy preview head are loaded");
  const fetched = requests.slice(before);
  assert.ok(fetched.includes(served.bodyMaterial), "the body's recovered material is fetched");
  assert.ok(!fetched.includes(served.headMaterial), "the head's material is not");
  assert.equal(rig.equippedItemId("face" as never), FACE_ID, "the face still owns its slot");
  assert.notEqual(body.material, legacyBody, "the recovered body skin replaced the legacy one");
  assert.equal((body.material as THREE.Material).userData.sourceMaterial, BODY_MI);
  assert.equal(rig.sourceHeadComponentKey(), undefined, "there is no head component to socket onto");
  assert.equal(root.getObjectsByProperty("isSkinnedMesh", true)
    .filter(o => o.userData.sourceMesh === HEAD_MESH).length, 0, "no head geometry entered the scene");
});

test("a head-socketed accessory fails closed while the head is omitted", async () => {
  const { served, pair } = await omittedPair("rig-socket");
  const { rig } = harness(served.bodyMesh);
  await rig.equipSourceItems([faceItem(pair, served.legacyHead)]);
  const earring: SourceRigPart = {
    sourceIndex: 0, sourceMesh: "/Game/Test/SM_Earring.SM_Earring", url: `${ORIGIN}meshes/earring.glb`,
    materials: { Slot: { url: served.bodyMaterial, source: "/Game/Test/MI.MI" } },
    attachment: { bodyUrl: served.bodyMesh, socket: "earring_01_l", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      frame: { kind: "head-component", components: [{ source: HEAD_MESH, sourceSha256: "head-sha", bone: "FACIAL_L_Ear",
        bodyBone: false, parentRest: HEAD_REST.toArray(), rest: HEAD_REST.toArray(), restScale: [1, 1, 1] }] } },
  };
  await assert.rejects(rig.equipSourceItems([{ id: "earring-01", slot: "earrings" as never,
    url: earring.url, sourceParts: [earring] }]),
    /No active source head component carries socket earring_01_l/);
  assert.equal(rig.equippedItemId("earrings" as never), undefined);
});

test("a cancelled omitted staging commits nothing and keeps the previous body skin", async () => {
  const { served, pair } = await omittedPair("rig-cancelled");
  const { rig, body, legacyBody } = harness(served.bodyMesh);
  let release = () => {};
  holds.set(served.bodyMaterial, new Promise<void>(resolve => { release = resolve; }));
  const controller = new AbortController();
  const staging = rig.equipSourceItems([faceItem(pair, served.legacyHead)], [], controller.signal);
  controller.abort();
  release();
  assert.equal(await staging, false, "a superseded appearance is never committed");
  holds.delete(served.bodyMaterial);
  assert.equal(rig.equippedItemId("face" as never), undefined);
  assert.equal(body.material, legacyBody, "the body keeps the skin it had");
});

test("a failed omitted staging keeps the complete appearance that was already there", async () => {
  const { served, pair } = await omittedPair("rig-failure");
  const { rig, body } = harness(served.bodyMesh);
  await rig.equipSourceItems([faceItem(pair, served.legacyHead)]);
  const staged = body.material;
  const broken = JSON.parse(JSON.stringify(pair));
  broken.body.materials.BaseBody.url = `${served.base}/materials/missing.json`;
  await assert.rejects(rig.equipSourceItems([faceItem(broken, served.legacyHead)]));
  assert.equal(rig.equippedItemId("face" as never), FACE_ID, "the prior face is still worn");
  assert.equal(body.material, staged, "and still wears the skin that was committed");
});

test("removing the omitted face restores the body material and leaves nothing behind", async () => {
  const { served, pair } = await omittedPair("rig-cleanup");
  const { rig, root, body, legacyBody } = harness(served.bodyMesh);
  await rig.equipSourceItems([faceItem(pair, served.legacyHead)]);
  const staged = body.material as THREE.Material;
  rig.unequip("face" as never);
  assert.equal(rig.equippedItemId("face" as never), undefined);
  assert.equal(body.material, legacyBody, "the preserved body returns to its previous material");
  assert.notEqual(body.material, staged);
  assert.deepEqual(root.children.filter(child => child.userData.sourceSkinPair), [],
    "the face's own scene left the rig");
});

test("uncovering the head restores that exact head and its own resources", async () => {
  const { served, pair } = await omittedPair("rig-restore");
  const { rig, body, loads } = harness(served.bodyMesh);
  await rig.equipSourceItems([faceItem(pair, served.legacyHead)]);
  const omittedSkin = body.material;

  const uncovered = outfit([face(), hairScalpOnly()]);
  const restored = await loadSourceSkinPair(FACE_ID, uncovered.items[FACE_ID], served.base, [], { id: undefined });
  assert.equal(restored!.headOmitted, undefined);
  assert.equal(await rig.equipSourceItems([faceItem(restored, served.legacyHead)]), true);
  assert.deepEqual(loads.slice().sort(), [served.legacyHead, served.headMesh].sort(),
    "the head the index publishes, and its preview fallback, are loaded now");
  assert.equal(rig.sourceHeadComponentKey(), `${FACE_ID}|${HEAD_MESH}`, "the head component is back");
  assert.notEqual(body.material, omittedSkin, "the body skin was restaged with the head");
  assert.equal((body.material as THREE.Material).userData.sourceMaterial, BODY_MI);
});
