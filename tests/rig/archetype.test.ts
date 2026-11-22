import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { BODY_TYPE_PREVIEWS, type BodyTypePreview } from "../../src/rig/BodyTypePreview.ts";
import { bindDistance, indexClass, scaleSkeletonTranslations, sourceBindBasis } from "../../src/rig/Archetype.ts";
import type { AssemblyAssets } from "../../src/rig/SourceAssembly.ts";

// The rig's side of Light and Heavy contestants (22 Nov 2026, rig/Archetype.ts): the class values come from the Season 12
// DA_BodyType reads, and every mesh binds in the rest its own skin was authored in.

type Transform = { Translation: Record<"X" | "Y" | "Z", number>; Rotation: Record<"X" | "Y" | "Z" | "W", number>;
  Scale3D: Record<"X" | "Y" | "Z", number> };
type Asset = { ActivatesLightMorphTargets?: string[]; ActivatesHeavyMorphTargets?: string[]; SupportedArchetypes?: string[];
  AttachmentSocketData: { SocketOffsetLight?: { Key: string; Value: Transform }[]; SocketOffsetsHeavy?: { Key: string; Value: Transform }[] } };
const read = (folder: string, name: string) => (JSON.parse(readFileSync(new URL(
  `../../_docs/body-types-2026-11-06/${folder}/extract/DA_BodyType_${name}.properties.json`, import.meta.url), "utf8")) as
  { Name: string; properties: Asset }[]).find(e => e.Name === `DA_BodyType_${name}`)!.properties;
const ASSETS = { masculine: read("s12-bodytypes-read", "Masculine"), feminine: read("s12-bodytypes-read", "Feminine"),
  androgynous: read("s12-androgynous-read", "Androgynous") };
const offsets = (list: { Key: string; Value: Transform }[] | undefined) => Object.fromEntries((list ?? []).map(({ Key, Value }) =>
  [Key, { translation: [Value.Translation.X, Value.Translation.Y, Value.Translation.Z],
    rotation: [Value.Rotation.X, Value.Rotation.Y, Value.Rotation.Z, Value.Rotation.W],
    scale: [Value.Scale3D.X, Value.Scale3D.Y, Value.Scale3D.Z] }]));

test("every class a body type supports carries its asset's own Light/Heavy morph and socket offsets", () => {
  for (const [id, asset] of Object.entries(ASSETS)) {
    const preview = BODY_TYPE_PREVIEWS[id as keyof typeof ASSETS] as BodyTypePreview;
    for (const [cls, morphs, list] of [["light", asset.ActivatesLightMorphTargets, asset.AttachmentSocketData.SocketOffsetLight],
      ["heavy", asset.ActivatesHeavyMorphTargets, asset.AttachmentSocketData.SocketOffsetsHeavy]] as const) {
      const supported = !asset.SupportedArchetypes
        || asset.SupportedArchetypes.includes(`EArchetypeSize::${cls === "light" ? "Light" : "Heavy"}`);
      const carried = preview[cls];
      if (!supported) { assert.equal(carried, undefined, `${id} ${cls}: the game never applies it`); continue; }
      assert.ok(carried, `${id} ${cls}`);
      assert.equal(morphs?.length, 1, `${id} ${cls}: one class morph`);
      assert.equal(carried.morph, morphs![0], `${id} ${cls} morph`);
      assert.deepEqual(JSON.parse(JSON.stringify(carried.socketOffsets)), offsets(list), `${id} ${cls} socket offsets`);
    }
  }
  assert.equal(BODY_TYPE_PREVIEWS.masculine.light.morph, "light_male");
  assert.equal(BODY_TYPE_PREVIEWS.masculine.heavy.morph, "heavy_male");
  assert.equal((BODY_TYPE_PREVIEWS.androgynous as BodyTypePreview).light, undefined, "Androgynous is Medium-only");
});

// A small chain with the legacy driver's trait: its bone axes are reoriented (Blender), so its rotations never match a
// source skin's, while every joint sits in the same place.
function driverChain(): THREE.Bone[] {
  const names = ["root", "pelvis", "spine_01", "neck_01", "head", "hand_r"];
  const offsets = [[0, 0, 0], [0, 0.97, 0], [0, 0.11, 0.01], [0, 0.45, 0.02], [0, 0.07, 0], [0.3, -0.2, 0.1]];
  const bones = names.map((name, i) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.fromArray(offsets[i]);
    bone.quaternion.setFromEuler(new THREE.Euler(0.3 * i, -0.2 * i, 0.1));
    return bone;
  });
  for (let i = 1; i < bones.length; i++) (i === 5 ? bones[2] : bones[i - 1]).add(bones[i]);
  bones[0].updateMatrixWorld(true);
  return bones;
}
const restsOf = (bones: THREE.Bone[]) => {
  bones[0].updateMatrixWorld(true);
  return new Map(bones.map(bone => [bone.name, bone.matrixWorld.clone().invert()]));
};
// A source skin authored with its joints at `scale` times the driver's Medium joints, in its own axes (unrotated, as a
// GLB's inverse binds are here): only the joint positions agree with the driver.
function skinAt(medium: ReadonlyMap<string, THREE.Matrix4>, scale: number): THREE.Skeleton {
  const bones = [...medium].map(([name, inverse]) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.setFromMatrixPosition(inverse.clone().invert()).multiplyScalar(scale);
    bone.updateMatrixWorld(true);
    return bone;
  });
  return new THREE.Skeleton(bones, bones.map(bone => bone.matrixWorld.clone().invert()));
}

test("each skin binds in the rest it was authored in: its own class, or Medium; anything else is refused", () => {
  const driver = driverChain();
  const medium = restsOf(driver);
  scaleSkeletonTranslations(driver, 0.85);
  const light = restsOf(driver);
  // The scaled driver puts every joint at 0.85 of its Medium place (rotations are unchanged).
  for (const name of medium.keys()) {
    const at = new THREE.Vector3().setFromMatrixPosition(light.get(name)!.clone().invert());
    const was = new THREE.Vector3().setFromMatrixPosition(medium.get(name)!.clone().invert());
    assert.ok(at.distanceTo(was.multiplyScalar(0.85)) < 1e-9, name);
  }
  const identity = new THREE.Matrix4();
  assert.ok(bindDistance(skinAt(medium, 1), identity, medium) < 1e-9, "positions match despite the reoriented driver axes");
  assert.equal(sourceBindBasis(skinAt(medium, 0.85), identity, light, medium, "SK_X_L"), "class");
  assert.equal(sourceBindBasis(skinAt(medium, 1), identity, light, medium, "SK_Head"), "medium");
  assert.throws(() => sourceBindBasis(skinAt(medium, 1.15), identity, light, medium, "SK_X_H"), /bound to no body rest/);
  // A mesh whose node moved (its bind matrix) is judged where it actually binds.
  const shifted = new THREE.Matrix4().makeTranslation(0, 0.2, 0);
  assert.throws(() => sourceBindBasis(skinAt(medium, 1), shifted, light, medium, "moved"), /bound to no body rest/);
});

const BODY_M = "/Game/Discovery/Characters/Body/SK_Body_M.SK_Body_M";
const BODY_L = "/Game/Discovery/Characters/Body/SK_Body_L.SK_Body_L";
const slots = [{ slot: "BaseBody", material: "/Game/Discovery/Characters/Body/M_Skin.M_Skin" }];
const index = (extra: Partial<AssemblyAssets> = {}): AssemblyAssets => ({
  formatVersion: 1, materials: {},
  meshes: { [BODY_M]: { url: "../m/SK_Body_M.glb", kind: "skeletal", slots }, [BODY_L]: { url: "../a/SK_Body_L.glb", kind: "skeletal", slots } },
  attachmentBody: { source: BODY_M, url: "../m/SK_Body_M.glb", restBones: {} },
  archetypes: { light: { body: BODY_L, skeletonScale: 0.85, boundsOrigin: [0, -0.778, 71.231] } },
  ...extra,
});
const url = (path: string) => new URL(path, "https://host/models/reconstructed-assemblies-v1/").href;

test("the index's class record: checked, URLs resolved, the face's body swap prepared; absent offers nothing", () => {
  const light = indexClass(index(), "light", url)!;
  assert.deepEqual(light.rig, { id: "light", skeletonScale: 0.85, bodySource: BODY_L,
    bodyUrl: "https://host/models/a/SK_Body_L.glb", mediumBodyUrl: "https://host/models/m/SK_Body_M.glb" });
  assert.deepEqual(light.skinBody, { mediumBody: BODY_M, body: BODY_L, url: "https://host/models/a/SK_Body_L.glb",
    boundsOrigin: [0, -0.778, 71.231] });
  assert.equal(indexClass(index(), "heavy", url), undefined);
  assert.equal(indexClass(index({ archetypes: undefined }), "light", url), undefined, "an index from before archetypes");
  const wrongSlots = index();
  wrongSlots.meshes[BODY_L] = { ...wrongSlots.meshes[BODY_L], slots: [{ slot: "Other", material: "x" }] };
  assert.throws(() => indexClass(wrongSlots, "light", url), /Invalid index archetype/, "the face's body materials must fit");
  for (const bad of [{ body: "/Game/missing", skeletonScale: 0.85, boundsOrigin: [0, 0, 0] },
    { body: BODY_L, skeletonScale: 3, boundsOrigin: [0, 0, 0] }, { body: BODY_L, skeletonScale: 0.85, boundsOrigin: [0, 0] }])
    assert.throws(() => indexClass(index({ archetypes: { light: bad as never } }), "light", url), /Invalid index archetype/);
});
