import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { CharacterRig } from "../../src/rig/CharacterRig.ts";
import { resolveSourceOutfit, resolveSourceRigParts, type AssemblyAssets, type SourceDefinition,
  type SourceRigPart } from "../../src/rig/SourceAssembly.ts";

// Two sections of one preserved mesh can carry the exact same authored material slot name and two
// different authored defaults: the braided hairs author M_Hair -> SmallBun and M_Hair ->
// FrontBraids_Braids on one mesh, next to a Gold section. A slot name is therefore not a recipient.
// The resolver keeps every section under its exact source material index — the position the
// converter writes in GLB materials order, which is the source section's own MaterialIndex — and
// the rig binds each actual primitive through the index that primitive carries, never through
// traversal order and never through a name that answers for two sections. Meshes whose slot names
// are unique keep the by-name record and behaviour they have always had.
// Run: node --import tsx --test scripts/generated/catalog-public-worktree/tests/rig/source-material-recipients.test.ts

const ORIGIN = "http://recipients.test/";
const MEDIUM = "Customization.Archetype.Medium";

// Exact source values, read from braid-material-metadata.json. Production code names none of them.
const DOUBLE_BUN = "/Game/Discovery/Characters/Hairs/DoubleBunHangingBraids/SK_DoubleBunHangingBraids_M.SK_DoubleBunHangingBraids_M";
const FRONT_BRAIDS = "/Game/Discovery/Characters/Hairs/FrontBraids/SK_FrontBraids_M.SK_FrontBraids_M";
const SMALL_BUN = "/Game/Discovery/Characters/Hairs/SmallBun/MI_SmallBun_Black.MI_SmallBun_Black";
const BRAIDS = "/Game/Discovery/Characters/Hairs/FrontBraids/MI_FrontBraids_Braids_Black.MI_FrontBraids_Braids_Black";
const HAIR = "/Game/Discovery/Characters/Hairs/FrontBraids/MI_FrontBraids_Hair_Black.MI_FrontBraids_Hair_Black";
const MOON = "/Game/Discovery/Characters/Hairs/DoubleBunHangingBraids/MI_LunarHairMoon.MI_LunarHairMoon";
const RED_VOLPE = "/Game/Discovery/Characters/Hairs/Materials/HairColors/Hair_01/MI_Hair_01_RedVolpe_01.MI_Hair_01_RedVolpe_01";

// The index's slot arrays, in GLB material order, exactly as build-assembly-assets.py records them.
const REPEATED = [{ slot: "M_Hair", material: SMALL_BUN }, { slot: "M_Hair", material: BRAIDS },
  { slot: "Gold", material: MOON }];
const BRAID_PAIR = [{ slot: "M_Hair", material: BRAIDS }, { slot: "M_Hair", material: HAIR }];
const UNIQUE = [{ slot: "M_Hair", material: BRAIDS }, { slot: "Gold", material: MOON }];

const files = new Map<string, string>();
const fetched = new Map<string, number>();
/** A recovered material manifest and its shader, as the reconstruction pipeline publishes them. */
function recovered(id: string): string {
  const url = `${ORIGIN}materials/${id}.json`;
  if (!files.has(url)) {
    const shader = `ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1) {\n  ReconstructedSurface surface; // ${id}\n  return surface;\n}\n`;
    files.set(`${ORIGIN}materials/${id}.glsl`, shader);
    files.set(url, JSON.stringify({ formatVersion: 1, itemId: id, shader: `${id}.glsl`,
      shaderSha256: createHash("sha256").update(shader).digest("hex"), textures: [], requiredUvSets: [0] }));
  }
  return url;
}
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  fetched.set(url, (fetched.get(url) ?? 0) + 1);
  const body = files.get(url);
  return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
}) as typeof fetch;
(globalThis as { window?: unknown }).window = { location: { href: ORIGIN } };

const soft = (AssetPathName: string) => ({ AssetPathName, SubPathString: "" });
const basename = (source: string) => source.split(".").at(-1)!;

/** An ordinary identity-placed hair: one visual part per mesh, no attachment, no rules. */
function hairDefinition(id: string, meshes: string[], overrides: [string, string][] = [],
  donors: [string, string[]][] = []): SourceDefinition {
  return { formatVersion: 1, id, source: `Discovery/Content/Test/DA_${id}.uasset`, sourceSha256: id,
    properties: {
      Slots: ["EBodySlot::Hair"], ActivatesTags: ["Customization.Slot.Hair"],
      MaterialOverrides: overrides.map(([Key, value]) => ({ Key, Value: soft(value) })),
      VisualParts: meshes.map(mesh => ({ StaticMesh: soft(""), SkeletalMesh: soft(mesh), Effect: soft(""),
        TagOverrides: [], bCanBeMerged: true, bIsHeadMesh: false, bIsAttached: false, bAttachToHeadMesh: false,
        LocalPosition: { X: 0, Y: 0, Z: 0 }, LocalRotation: { Pitch: 0, Yaw: 0, Roll: 0 },
        LocalScale: { X: 1, Y: 1, Z: 1 } })),
      ActivatesMaterialParameters: donors.map(([instance, SlotNames]) => ({ MaterialInstance: soft(instance),
        Behavior: "ECustomizationMaterialBehavior::OverrideParameters", MatchingTags: [], SlotNames })),
    } };
}

// One synthetic item, its mesh index entries and its recovered materials. Material URLs are unique
// per fixture, so one staging can never observe a material another test already loaded.
let fixtures = 0;
function hairFixture(entries: { mesh: string; slots: { slot: string; material: string }[] }[],
  options: { overrides?: [string, string][]; donors?: [string, string[]][]; variants?: [string, string[]][] } = {}) {
  const tag = `fx${fixtures++}`;
  const sources = [...new Set([...entries.flatMap(entry => entry.slots.map(slot => slot.material)),
    ...(options.overrides ?? []).map(([, value]) => value)])];
  const materials = Object.fromEntries(sources.map(source => [source, recovered(`${tag}-${basename(source)}`)]));
  const materialVariants = Object.fromEntries((options.variants ?? []).map(([source, overlays]) =>
    [JSON.stringify([source, ...overlays]),
      recovered(`${tag}-${basename(source)}-with-${overlays.map(basename).join("-")}`)]));
  const assets: AssemblyAssets = { formatVersion: 1, materials, materialVariants,
    meshes: Object.fromEntries(entries.map((entry, index) => [entry.mesh,
      { url: `${ORIGIN}meshes/${tag}-${index}.glb`, kind: "skeletal" as const, slots: entry.slots }])) };
  const definition = hairDefinition(`${tag}-hair`, entries.map(entry => entry.mesh), options.overrides, options.donors);
  const item = resolveSourceOutfit([definition], [MEDIUM]).items[definition.id];
  return { tag, assets, materials, materialVariants,
    parts: () => resolveSourceRigParts(item, assets, path => new URL(path, ORIGIN).href) };
}

test("a repeated slot name keeps every authored recipient instead of the section resolved last", () => {
  const fixture = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }]);
  const [part] = fixture.parts();
  assert.deepEqual(part.materialSections, [
    { materialIndex: 0, slot: "M_Hair", defaultSource: SMALL_BUN, source: SMALL_BUN, url: fixture.materials[SMALL_BUN] },
    { materialIndex: 1, slot: "M_Hair", defaultSource: BRAIDS, source: BRAIDS, url: fixture.materials[BRAIDS] },
    { materialIndex: 2, slot: "Gold", defaultSource: MOON, source: MOON, url: fixture.materials[MOON] },
  ]);
  // The reported defect: `materials[slot.slot]` used to hold whichever M_Hair section came last,
  // silently dropping the other recipient. The ambiguous name is now absent rather than wrong.
  assert.deepEqual(Object.keys(part.materials), ["Gold"]);
  assert.equal(part.materials.M_Hair, undefined);
  // The second braided mesh repeats its only name; nothing at all is published by name for it.
  const pair = hairFixture([{ mesh: FRONT_BRAIDS, slots: BRAID_PAIR }]).parts()[0];
  assert.deepEqual(pair.materialSections!.map(section => [section.materialIndex, section.defaultSource]),
    [[0, BRAIDS], [1, HAIR]]);
  assert.deepEqual(Object.keys(pair.materials), []);
});

test("unique slot names are unchanged, and case-equivalent spellings stay ambiguous", () => {
  const fixture = hairFixture([{ mesh: FRONT_BRAIDS, slots: UNIQUE }]);
  const [part] = fixture.parts();
  assert.equal("materialSections" in part, false, "no added representation where none is needed");
  assert.deepEqual(part.materials, { M_Hair: { url: fixture.materials[BRAIDS], source: BRAIDS },
    Gold: { url: fixture.materials[MOON], source: MOON } });
  // Two distinct case-equivalent spellings are two slots, not one repeated name: they keep their
  // own exact defaults, and an override reaching both is still refused by the unchanged FName rule.
  const twin = [{ slot: "M_Hair", material: BRAIDS }, { slot: "m_hair", material: HAIR }];
  const plain = hairFixture([{ mesh: FRONT_BRAIDS, slots: twin }]).parts()[0];
  assert.equal("materialSections" in plain, false);
  assert.deepEqual([plain.materials.M_Hair.source, plain.materials.m_hair.source], [BRAIDS, HAIR]);
  assert.throws(() => hairFixture([{ mesh: FRONT_BRAIDS, slots: twin }],
    { overrides: [["M_Hair", MOON]] }).parts(), /Ambiguous case-equivalent material slots/);
});

test("one authored override or donor sequence reaches every occurrence, each keeping its own default", () => {
  // The same donor is authored once for the name M_Hair; both of its sections take it, and each
  // resolves the variant of its own distinct default.
  const overlaid = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }],
    { donors: [[RED_VOLPE, ["M_Hair"]]], variants: [[SMALL_BUN, [RED_VOLPE]], [BRAIDS, [RED_VOLPE]]] });
  assert.deepEqual(overlaid.parts()[0].materialSections!.map(s => [s.materialIndex, s.defaultSource, s.source, s.url]), [
    [0, SMALL_BUN, SMALL_BUN, overlaid.materialVariants[JSON.stringify([SMALL_BUN, RED_VOLPE])]],
    [1, BRAIDS, BRAIDS, overlaid.materialVariants[JSON.stringify([BRAIDS, RED_VOLPE])]],
    [2, MOON, MOON, overlaid.materials[MOON]],
  ]);
  // An explicit override replaces the recipient of both occurrences of that exact name. The two
  // authored source defaults they came from stay distinct and recorded.
  const overridden = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }], { overrides: [["M_Hair", HAIR]] });
  assert.deepEqual(overridden.parts()[0].materialSections!.map(s => [s.defaultSource, s.source]),
    [[SMALL_BUN, HAIR], [BRAIDS, HAIR], [MOON, MOON]]);
  // A variant recovered for only one of the two occurrences fails the whole part, as before.
  assert.throws(() => hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }],
    { donors: [[RED_VOLPE, ["M_Hair"]]], variants: [[SMALL_BUN, [RED_VOLPE]]] }).parts(),
    /Missing recovered material for M_Hair/);
});

// ---- runtime staging -------------------------------------------------------------------------

const HEAD_REST = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.6, 0.01),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.1, -0.3)), new THREE.Vector3(1, 1, 1));

/** Place a bone by the world rest it must have, whatever its parents already are. */
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

function primitiveGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

/** One converted primitive: the section extras the converter writes, and the GLB material's own
 *  authored slot and source material. `index: undefined` omits the section entirely. */
interface Primitive { index?: unknown; slot?: string; source?: string; extra?: THREE.Material[] }

/** A loaded source part: one glTF mesh whose primitives are its sections, all sharing one skin. */
function partScene(primitives: Primitive[]): THREE.Group {
  const group = new THREE.Group();
  const root = bone("root", new THREE.Matrix4());
  const head = bone("head", HEAD_REST, root);
  root.updateMatrixWorld(true);
  const bones = [root, head];
  const skeleton = new THREE.Skeleton(bones, bones.map(b => b.matrixWorld.clone().invert()));
  group.add(root);
  // GLTFLoader reuses the same material object when several primitives reference one material.
  const shared = new Map<string, THREE.Material>();
  for (const primitive of primitives) {
    const geometry = primitiveGeometry();
    if (primitive.index !== undefined)
      geometry.userData.sourceSection = { MaterialIndex: primitive.index, FirstIndex: 0, NumFaces: 1 };
    const key = JSON.stringify([primitive.slot, primitive.source]);
    const material = shared.get(key) ?? new THREE.MeshStandardMaterial({ name: primitive.source ? basename(primitive.source) : "" });
    shared.set(key, material);
    if (primitive.slot !== undefined) material.userData.sourceSlot = { MaterialSlotName: primitive.slot };
    material.userData.sourceMaterial = primitive.source;
    const mesh = new THREE.SkinnedMesh(geometry, primitive.extra ?? material);
    mesh.bind(skeleton, new THREE.Matrix4());
    group.add(mesh);
  }
  return group;
}

/** The correct primitives for an index slot array, optionally in another order. */
const sectionsOf = (slots: { slot: string; material: string }[], order?: number[]): Primitive[] =>
  (order ?? slots.map((_, index) => index)).map(index =>
    ({ index, slot: slots[index].slot, source: slots[index].material }));

function harness() {
  const root = new THREE.Group();
  const driverRoot = bone("root", new THREE.Matrix4());
  root.add(driverRoot);
  const head = bone("head", HEAD_REST, driverRoot);
  root.updateMatrixWorld(true);
  const driver = [driverRoot, head];
  const body = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  body.userData.sourceBody = true;
  body.userData.sourceBodyUrl = `${ORIGIN}models/SK_Body_M.glb`;
  const bodyScene = new THREE.Group().add(body);
  const registry = new Map<string, { primitives: Primitive[]; delay: boolean }>();
  const loader = { loadAsync: async (url: string) => {
    const entry = registry.get(String(url));
    if (!entry) throw new Error(`Unregistered source mesh: ${url}`);
    if (entry.delay) await new Promise(resolve => setTimeout(resolve, 5));
    return { scene: partScene(entry.primitives) };
  } };
  const rig = new CharacterRig(loader as never, root);
  const internals = rig as unknown as {
    skeleton: THREE.Skeleton; bonesByName: Map<string, THREE.Bone>;
    bodyRestInverses: Map<string, THREE.Matrix4>; bodyScene: THREE.Object3D;
  };
  internals.skeleton = new THREE.Skeleton(driver);
  internals.bonesByName = new Map(driver.map(b => [b.name, b]));
  internals.bodyRestInverses = new Map(driver.map(b => [b.name, b.matrixWorld.clone().invert()]));
  internals.bodyScene = bodyScene;
  root.add(bodyScene);
  return { rig, root,
    register: (url: string, primitives: Primitive[], delay = false) => registry.set(url, { primitives, delay }),
    equip: (id: string, parts: SourceRigPart[]) => rig.equipSourceItems([{ id, slot: "hair" as never,
      url: parts[0].url, sourceParts: parts }]) };
}

const staged = (root: THREE.Object3D, id: string) =>
  root.children.find(child => child.userData.rigItemId === id && child.userData.sourceAssembly);

/** Which recovered recipient each staged primitive actually received, by its own source identity. */
function recipients(scene: THREE.Object3D) {
  return (scene.getObjectsByProperty("isMesh", true) as THREE.Mesh[]).map(mesh => ({
    part: mesh.userData.sourcePartIndex as number,
    index: (mesh.geometry.userData.sourceSection as { MaterialIndex: number } | undefined)?.MaterialIndex,
    source: (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).userData.sourceMaterial as string,
  }));
}
const size = (root: THREE.Object3D) => { let n = 0; root.traverse(() => { n += 1; }); return n; };

test("each primitive is staged with its own recipient, whatever order it loads or appears in", async () => {
  const { rig, root, register, equip } = harness();
  const fixture = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }]);
  const parts = fixture.parts();
  // The converted primitives arrive in a different order from the source material indices, after a
  // delay: neither traversal order nor fetch timing may decide which recipient a section gets.
  register(parts[0].url, sectionsOf(REPEATED, [2, 0, 1, 0]), true);
  assert.equal(await equip("hair-double-bun", parts), true);
  const scene = staged(root, "hair-double-bun")!;
  assert.deepEqual([...recipients(scene)].sort((a, b) => a.index! - b.index!),
    [{ part: 0, index: 0, source: SMALL_BUN }, { part: 0, index: 0, source: SMALL_BUN }, { part: 0, index: 1, source: BRAIDS },
      { part: 0, index: 2, source: MOON }]);
  // The defect at runtime: both M_Hair primitives used to receive the one binding the name kept.
  const braided = recipients(scene).filter(entry => entry.index !== 2).map(entry => entry.source);
  assert.equal(new Set(braided).size, 2, "the two M_Hair sections are two different recipients");
  assert.equal(rig.equippedItemId("hair" as never), "hair-double-bun");
});

test("a shared source material and several parts repeating one spelling all bind correctly", async () => {
  const { root, register, equip } = harness();
  // Two parts, each repeating M_Hair, and one source material shared between a primitive of each.
  const fixture = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }, { mesh: FRONT_BRAIDS, slots: BRAID_PAIR }]);
  const parts = fixture.parts();
  register(parts[0].url, sectionsOf(REPEATED), true); // the first authored part resolves last
  register(parts[1].url, sectionsOf(BRAID_PAIR, [1, 0]));
  fetched.clear();
  assert.equal(await equip("hair-two-parts", parts), true);
  const scene = staged(root, "hair-two-parts")!;
  assert.deepEqual([...recipients(scene)].sort((a, b) => a.part - b.part || a.index! - b.index!), [
    { part: 0, index: 0, source: SMALL_BUN }, { part: 0, index: 1, source: BRAIDS },
    { part: 0, index: 2, source: MOON }, { part: 1, index: 0, source: BRAIDS },
    { part: 1, index: 1, source: HAIR },
  ]);
  // Authored part order is kept, independent of fetch timing, and the shared material is requested
  // once for the two primitives that use it.
  assert.deepEqual(scene.children.map(child => child.userData.sourcePartIndex), [0, 1]);
  assert.equal(fetched.get(fixture.materials[BRAIDS]), 1, "the shared recovered material is deduplicated");
});

test("missing, unknown or disagreeing source identity rejects staging and keeps the equipped item", async () => {
  const { rig, root, register, equip } = harness();
  const good = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }]).parts();
  register(good[0].url, sectionsOf(REPEATED));
  assert.equal(await equip("hair-good", good), true);
  const before = size(root);
  const attempts: [string, Primitive[], RegExp][] = [
    ["no converted section at all", [{ slot: "M_Hair", source: SMALL_BUN }], /Missing source material index/],
    ["a malformed index", [{ index: 1.5, slot: "M_Hair", source: SMALL_BUN }], /Missing source material index/],
    ["an index the mesh index never recorded", [{ index: 7, slot: "M_Hair", source: SMALL_BUN }],
      /Unknown source material index 7/],
    ["a slot that section does not carry", [{ index: 0, slot: "Gold", source: SMALL_BUN }],
      /Source material index 0 is not slot Gold/],
    ["no authored slot at all", [{ index: 0, source: SMALL_BUN }], /is not slot \(unnamed\)/],
    ["another section's source default", [{ index: 0, slot: "M_Hair", source: BRAIDS }],
      /is not .*MI_SmallBun_Black/],
  ];
  for (const [label, primitives, message] of attempts) {
    const broken = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }]).parts();
    register(broken[0].url, primitives);
    await assert.rejects(equip("hair-broken", broken), message, label);
    assert.equal(rig.equippedItemId("hair" as never), "hair-good", label);
    assert.equal(size(root), before, `${label}: nothing of the refused item stayed in the scene`);
  }
  // A binding whose preserved identity is itself ambiguous is refused rather than picked from.
  const conflicting = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }]).parts();
  conflicting[0].materialSections = conflicting[0].materialSections!.map(s => ({ ...s, materialIndex: 0 }));
  register(conflicting[0].url, [{ index: 0, slot: "M_Hair", source: SMALL_BUN }]);
  await assert.rejects(equip("hair-conflicting", conflicting), /Conflicting source material index 0/);
  assert.equal(rig.equippedItemId("hair" as never), "hair-good");
  assert.equal(size(root), before);
});

test("a primitive carrying several materials is refused instead of guessed", async () => {
  const { rig, root, register, equip } = harness();
  const parts = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }]).parts();
  const pair = [0, 1].map(index => {
    const material = new THREE.MeshStandardMaterial();
    material.userData.sourceSlot = { MaterialSlotName: REPEATED[index].slot };
    material.userData.sourceMaterial = REPEATED[index].material;
    return material;
  });
  register(parts[0].url, [{ index: 0, extra: pair }]);
  await assert.rejects(equip("hair-array", parts), /Unsupported source material array/);
  register(parts[0].url, [{ index: 0, extra: [] }]);
  await assert.rejects(equip("hair-empty-array", parts), /Unsupported source material array/);
  assert.equal(rig.equippedItemId("hair" as never), undefined);
  assert.equal(staged(root, "hair-array"), undefined);
});

test("a unique-slot part still binds by name, with no section metadata anywhere", async () => {
  const { rig, root, register, equip } = harness();
  const fixture = hairFixture([{ mesh: FRONT_BRAIDS, slots: UNIQUE }]);
  const parts = fixture.parts();
  assert.equal("materialSections" in parts[0], false);
  // Shaped like the legacy supplied parts: primitives whose geometry carries no section extras.
  register(parts[0].url, [{ slot: "Gold", source: MOON }, { slot: "M_Hair", source: BRAIDS }]);
  assert.equal(await equip("hair-unique", parts), true);
  assert.deepEqual(recipients(staged(root, "hair-unique")!).map(entry => entry.source), [MOON, BRAIDS]);
  // And a name the part does not bind still fails exactly as it did before.
  const missing = hairFixture([{ mesh: FRONT_BRAIDS, slots: UNIQUE }]).parts();
  register(missing[0].url, [{ slot: "Buckle", source: MOON }]);
  await assert.rejects(equip("hair-missing", missing), /Missing source material slot: Buckle/);
  assert.equal(rig.equippedItemId("hair" as never), "hair-unique");
});

test("a cancelled staging of a repeated-slot part attaches nothing", async () => {
  const { rig, root, register } = harness();
  const parts = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }]).parts();
  register(parts[0].url, sectionsOf(REPEATED), true);
  const controller = new AbortController();
  const pending = rig.equipSourceItems([{ id: "hair-cancelled", slot: "hair" as never,
    url: parts[0].url, sourceParts: parts }], [], controller.signal);
  controller.abort();
  assert.equal(await pending, false);
  assert.equal(staged(root, "hair-cancelled"), undefined);
  assert.equal(rig.equippedItemId("hair" as never), undefined);
});

test("a negative index cannot become valid by repeating the same corrupt index in the binding", async () => {
  const { rig, register, equip } = harness();
  const parts = hairFixture([{ mesh: DOUBLE_BUN, slots: REPEATED }]).parts();
  parts[0].materialSections![0].materialIndex = -1;
  register(parts[0].url, [{ index: -1, slot: "M_Hair", source: SMALL_BUN }]);
  await assert.rejects(equip("hair-negative", parts), /Missing source material index/);
  assert.equal(rig.equippedItemId("hair" as never), undefined);
});
