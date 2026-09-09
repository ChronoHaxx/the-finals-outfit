import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { resolveMaterialInstance, resolveSkinMaterialSlots } from "./material-instances.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "finals-material-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dump = join(root, "Content", "Discovery", "Characters");
  mkdirSync(dump, { recursive: true });
  const write = (name, obj) => {
    const file = join(root, "Content", "Discovery", name + ".json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify([obj]));
    return file;
  };
  const ref = (name) => ({ ObjectName: `MaterialInstanceConstant'${name.split("/").at(-1)}'`, ObjectPath: `/Game/Discovery/${name}.0` });
  return { root, dump, write, ref };
}
const scalar = (Name, ParameterValue) => ({ ParameterInfo: { Name }, ParameterValue });

test("parent defaults, texture null overrides and TwoSided obey authored inheritance", (t) => {
  const f = fixture(t);
  f.write("Materials/M_Character_Layered", { Type: "Material", Name: "M_Character_Layered", Properties: { TwoSided: true }, CachedExpressionData: {
    RuntimeEntries: { ParameterInfoSet: [{ Key: { Name: "Roughness" } }] }, ScalarValues: [0.7],
    "RuntimeEntries[3]": { ParameterInfoSet: [{ Key: { Name: "Normal" } }] }, TextureValues: [{ AssetPathName: "/Game/Discovery/Textures/Normal.Normal" }],
  } });
  f.write("Materials/MI_Parent", { Type: "MaterialInstanceConstant", Name: "MI_Parent", Properties: {
    Parent: f.ref("Materials/M_Character_Layered"), ScalarParameterValues: [scalar("Tiling", 2)],
    BasePropertyOverrides: { TwoSided: false, bOverride_TwoSided: false },
  } });
  const file = f.write("Materials/MI_Child", { Type: "MaterialInstanceConstant", Name: "MI_Child", Properties: {
    Parent: f.ref("Materials/MI_Parent"), ScalarParameterValues: [scalar("Tiling", 3)],
    TextureParameterValues: [scalar("Normal", null)], BasePropertyOverrides: { bOverride_TwoSided: true },
  } });
  const mi = resolveMaterialInstance(file, f.dump);
  assert.equal(mi.doubleSided, false, "enabled override with omitted TwoSided uses UE false default");
  assert.equal(mi.scalars.Roughness, 0.7);
  assert.equal(mi.scalars.Tiling, 3);
  assert.equal(mi.textures.Normal, null);
  assert.equal(mi.family, "layered");
  assert.equal(mi.complete, true);
  assert.deepEqual(mi.chain, ["MI_Child", "MI_Parent", "M_Character_Layered"]);
});

test("only a resolved master can supply the default false sidedness", (t) => {
  const f = fixture(t);
  const missing = f.write("Materials/MI_Missing", { Type: "MaterialInstanceConstant", Name: "MI_Missing", Properties: { Parent: f.ref("Materials/Absent") } });
  assert.equal(resolveMaterialInstance(missing, f.dump).doubleSided, undefined);
  assert.equal(resolveMaterialInstance(missing, f.dump).complete, false);
  const master = f.write("Materials/M_Solid", { Type: "Material", Name: "M_Solid", Properties: {} });
  assert.equal(resolveMaterialInstance(master, f.dump).doubleSided, false);
  f.write("Materials/MI_A", { Type: "MaterialInstanceConstant", Name: "MI_A", Properties: { Parent: f.ref("Materials/MI_B") } });
  const b = f.write("Materials/MI_B", { Type: "MaterialInstanceConstant", Name: "MI_B", Properties: { Parent: f.ref("Materials/MI_A") } });
  assert.equal(resolveMaterialInstance(b, f.dump).complete, false);
});

test("texture array aliases resolve before inheritance, including explicit clearing", (t) => {
  const f = fixture(t);
  f.write("Materials/M_Character_Layered", { Type: "Material", Name: "M_Character_Layered", Properties: {} });
  f.write("Materials/MI_Parent", { Type: "MaterialInstanceConstant", Name: "MI_Parent", Properties: {
    Parent: f.ref("Materials/M_Character_Layered"), TextureParameterValues: [
      scalar("TextureArray_Colors", { ObjectPath: "/Game/Discovery/Parent.0" }),
      scalar("TextureArray_N", { ObjectPath: "/Game/Discovery/ParentNormal.0" }),
    ],
  } });
  const file = f.write("Materials/MI_Child", { Type: "MaterialInstanceConstant", Name: "MI_Child", Properties: {
    Parent: f.ref("Materials/MI_Parent"), TextureParameterValues: [
      scalar("TextureArray_C", null),
      scalar("TextureArray_Normals", { ObjectPath: "/Game/Discovery/ChildNormal.0" }),
    ],
  } });
  const mi = resolveMaterialInstance(file, f.dump);
  assert.equal(mi.textures.TextureArray_Colors, null);
  assert.equal(mi.textures.TextureArray_Normals, "/Game/Discovery/ChildNormal.0");
});

test("two material helmet maps shell and LED to distinct source slots", (t) => {
  const f = fixture(t);
  f.write("Materials/M_Character_Layered", { Type: "Material", Name: "M_Character_Layered", Properties: {} });
  f.write("Materials/M_LEDScreen", { Type: "Material", Name: "M_LEDScreen", Properties: {} });
  const slots = ["Helmet", "Visor"].map((name) => ({ MaterialSlotName: name, Material: f.ref(`Characters/Helmet/MI_Helmet_${name}`) }));
  const mesh = f.write("Characters/Helmet/SK_Helmet", { Type: "SkeletalMesh", Name: "SK_Helmet", SkeletalMaterials: slots });
  f.write("Characters/Helmet/MI_Helmet_Helmet", { Type: "MaterialInstanceConstant", Name: "MI_Helmet_Helmet", Properties: { Parent: f.ref("Materials/M_Character_Layered") } });
  f.write("Characters/Helmet/MI_Helmet_Visor", { Type: "MaterialInstanceConstant", Name: "MI_Helmet_Visor", Properties: { Parent: f.ref("Materials/M_LEDScreen") } });
  const skinDir = dirname(f.write("Characters/Helmet/Skins/Carbon/MI_Helmet_Carbon", { Type: "MaterialInstanceConstant", Name: "MI_Helmet_Carbon", Properties: { Parent: f.ref("Materials/M_Character_Layered") } }));
  f.write("Characters/Helmet/Skins/Carbon/MI_Helmet_Helmet_Carbon_Visor", { Type: "MaterialInstanceConstant", Name: "MI_Helmet_Helmet_Carbon_Visor", Properties: { Parent: f.ref("Materials/M_LEDScreen") } });
  const result = resolveSkinMaterialSlots(mesh, skinDir, f.dump);
  assert.deepEqual(result.map((s) => [s.materialName, s.mi.name, s.mi.family]), [
    ["MI_Helmet_Helmet", "MI_Helmet_Carbon", "layered"],
    ["MI_Helmet_Visor", "MI_Helmet_Helmet_Carbon_Visor", "led"],
  ]);
});

test("ambiguous skin candidates never replace every source material with the first MI", (t) => {
  const f = fixture(t);
  const mesh = f.write("Characters/Thing/SK_Thing", { Type: "SkeletalMesh", Name: "SK_Thing", SkeletalMaterials: [
    { MaterialSlotName: "A", Material: f.ref("Characters/Thing/MI_A") },
    { MaterialSlotName: "B", Material: f.ref("Characters/Thing/MI_B") },
  ] });
  const skinDir = dirname(f.write("Characters/Thing/Skins/Red/MI_Red", { Type: "MaterialInstanceConstant", Name: "MI_Red", Properties: {} }));
  const result = resolveSkinMaterialSlots(mesh, skinDir, f.dump);
  assert.deepEqual(result.map((s) => s.resolution), ["unresolved-skin", "unresolved-skin"]);
  assert.ok(result.every((s) => !s.mi));
});

test("repeated source sections sharing a material resolve to one skin binding", (t) => {
  const f = fixture(t);
  f.write("Materials/M_Layered", { Type: "Material", Name: "M_Layered", Properties: {} });
  const ref = f.ref("Characters/Cape/MI_Cape");
  const mesh = f.write("Characters/Cape/SK_Cape", { Type: "SkeletalMesh", Name: "SK_Cape", SkeletalMaterials: [
    { MaterialSlotName: "Cape", Material: ref }, { MaterialSlotName: "Cape", Material: ref },
  ] });
  const skinDir = dirname(f.write("Characters/Cape/Skins/Red/MI_Cape_Red", { Type: "MaterialInstanceConstant", Name: "MI_Cape_Red", Properties: { Parent: f.ref("Materials/M_Layered") } }));
  const result = resolveSkinMaterialSlots(mesh, skinDir, f.dump);
  assert.equal(result.length, 1);
  assert.equal(result[0].mi.name, "MI_Cape_Red");
  assert.notEqual(result[0].resolution, "unresolved-skin");
});

test("an embedded preview's OCM alone is not a layered skin", (t) => {
  const f = fixture(t);
  const file = f.write("Materials/M_Character_Preview", { Type: "Material", Name: "M_Character_Preview", Properties: {}, CachedExpressionData: {
    "RuntimeEntries[3]": { ParameterInfoSet: [{ Key: { Name: "OcclusionCurvatureMaterialID" } }] }, TextureValues: [{ AssetPathName: "/Game/Discovery/Textures/OCM.OCM" }],
  } });
  const mi = resolveMaterialInstance(file, f.dump);
  assert.equal(mi.family, "unknown");
  assert.equal(mi.doubleSided, false);
});
