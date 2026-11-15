import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { curveTransform, modifyBoneNodes, rootOverride } from "../scripts/anim-export/prop-placement.mjs";
import { surveyActor } from "../scripts/anim-export/survey-props.mjs";

// Emote prop placement beyond socket + notify (11 Nov 2026): the AnimBlueprint's ModifyBone root override, the
// CurveDrivenTransformPrefix curves, and Blueprint child components. Fixtures are trimmed CUE4Parse exports of the
// real assets (turret, sensu fan, laptop; PilotCheckList-style curves; the Puppeteer and CoconutRider actors).

const mirror = new THREE.Matrix4().makeScale(1, -1, 1);
const appToUe = v => new THREE.Vector3(v.x, -v.y, v.z); // the mirror is its own inverse (and drops the /100 for unit vectors)

// A class default object with one ModifyBone node, as the ABP JSON has it.
function abp(node, { bound = false } = {}) {
  return [{
    Type: "ABP_Test_C", Name: "Default__ABP_Test_C", Flags: "RF_Public | RF_ClassDefaultObject | RF_ArchetypeObject",
    Properties: { AnimGraphNode_Root: { Result: { LinkID: 4 } }, AnimGraphNode_ModifyBone: {
      BoneToModify: { BoneName: "root" }, Translation: { X: 0, Y: 0, Z: 0 }, Rotation: { Pitch: 0, Yaw: 0, Roll: 0 }, Scale: { X: 1, Y: 1, Z: 1 },
      TranslationMode: "EBoneModificationMode::BMM_Replace", RotationMode: "EBoneModificationMode::BMM_Replace", ScaleMode: "EBoneModificationMode::BMM_Ignore",
      TranslationSpace: "EBoneControlSpace::BCS_ComponentSpace", RotationSpace: "EBoneControlSpace::BCS_ComponentSpace", ScaleSpace: "EBoneControlSpace::BCS_ComponentSpace",
      Alpha: 1, AlphaInputType: "EAnimAlphaInputType::Float", AlphaCurveName: "None", ...node } },
    SerializedSparseClassData: { AnimGraphNode_ModifyBone: { CopyRecords: bound ? [{ CopyIndex: 0 }] : [], Function: null } },
  }];
}

test("a root Replace in component space becomes a constant root (turret: zero translation and rotation)", () => {
  const o = rootOverride(modifyBoneNodes(abp({})), "root");
  assert.deepEqual(o.translation.map(Math.abs), [0, 0, 0]);
  assert.deepEqual(o.rotation.map(v => Math.abs(v)), [0, 0, 0, 1]);
  assert.deepEqual(o.notes, []);
  assert.equal(rootOverride(modifyBoneNodes(abp({})), "ROOT").bone, "ROOT", "bone names match case-insensitively");
});

test("the replaced rotation is the FRotator, mirrored into the app's frame (sensu fan roll 90, fencing foil yaw -30)", () => {
  for (const r of [{ Pitch: 0, Yaw: 0, Roll: 90 }, { Pitch: 0, Yaw: -30, Roll: 0 }, { Pitch: 90, Yaw: 0, Roll: 90 }]) {
    const o = rootOverride(modifyBoneNodes(abp({ Rotation: r })), "root");
    // UE FRotator semantics: yaw turns +X toward +Y, pitch turns +X up toward +Z, roll turns +Y toward -Z
    // (FRotator::Quaternion). Check the app rotation is M R M of that.
    const ue = new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(r.Yaw))
      .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(-r.Pitch)))
      .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-r.Roll)));
    const expected = mirror.clone().multiply(ue).multiply(mirror);
    const got = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...o.rotation));
    assert.ok(got.elements.every((v, i) => Math.abs(v - expected.elements[i]) < 1e-6), JSON.stringify(r));
  }
  const fan = rootOverride(modifyBoneNodes(abp({ Rotation: { Pitch: 0, Yaw: 0, Roll: 90 } })), "root");
  const y = appToUe(new THREE.Vector3(0, -1, 0).applyQuaternion(new THREE.Quaternion(...fan.rotation))); // UE +Y
  assert.ok(Math.abs(y.z + 1) < 1e-6, "roll 90 turns UE +Y to -Z");
});

test("rotation Ignore keeps the sequence's rotation (the laptops): only the translation is replaced", () => {
  const o = rootOverride(modifyBoneNodes(abp({ BoneToModify: { BoneName: "weapon_root" }, RotationMode: "EBoneModificationMode::BMM_Ignore" })), "weapon_root");
  assert.ok(o.translation);
  assert.equal(o.rotation, undefined);
});

test("anything not verified is refused with a note, not applied", () => {
  const cases = [
    [abp({}, { bound: true }), "bound"],
    [abp({ Alpha: 0.5 }), "alpha"],
    [abp({ AlphaCurveName: "Blend" }), "curve"],
    [abp({ TranslationMode: "EBoneModificationMode::BMM_Additive" }), "BMM_Additive"],
    [abp({ RotationSpace: "EBoneControlSpace::BCS_WorldSpace" }), "WorldSpace"],
    [abp({ ScaleMode: "EBoneModificationMode::BMM_Replace" }), "scale mode"],
    [abp({ BoneToModify: { BoneName: "hand_r" } }), "not the root"],
  ];
  for (const [exports, why] of cases) {
    const o = rootOverride(modifyBoneNodes(exports), "root");
    assert.equal(o?.translation, undefined, why);
    assert.equal(o?.rotation, undefined, why);
    assert.match(o.notes.join(" "), new RegExp(why), why);
  }
  assert.equal(rootOverride([], "root"), null, "no ModifyBone: nothing");
});

// --- Curves --------------------------------------------------------------------------------------------------------
const frames = 31, ft = 1 / 30;
const series = f => Array.from({ length: frames }, (_, i) => f(i));
const at = (keys, frame, stride) => { // sample of a [keys, values] pair as the app does: lerp, slerp for quaternions
  const [k, v] = keys;
  let i = 0; while (i < k.length - 1 && k[i + 1] <= frame) i++;
  if (i === k.length - 1) return v.slice(i * stride, i * stride + stride);
  const u = (frame - k[i]) / (k[i + 1] - k[i]);
  if (stride === 4) return new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(...v.slice(i * 4, i * 4 + 4)),
    new THREE.Quaternion(...v.slice(i * 4 + 4, i * 4 + 8)), u).toArray();
  return v.slice(i * stride, i * stride + stride).map((x, j) => x + (v[(i + 1) * stride + j] - x) * u);
};

test("curve rotation is FRotator(Roll = RotateX, Pitch = RotateY, Yaw = RotateZ); translation cm -> m, mirrored", () => {
  const curve = curveTransform({ Prop01_TranslateX: series(() => 43), Prop01_TranslateY: series(() => 10), Prop01_TranslateZ: series(() => 0),
    Prop01_RotateZ: series(() => 90) }, "prop01", ft); // MonsterMan-style names differ in case
  assert.deepEqual(curve.translation[1].slice(0, 3), [0.43, -0.1, 0]);
  const q = new THREE.Quaternion(...curve.rotation[1].slice(0, 4));
  const x = appToUe(new THREE.Vector3(1, 0, 0).applyQuaternion(q));
  assert.ok(Math.abs(x.y - 1) < 1e-6, "RotateZ is yaw: UE +X turns to +Y");
  const pitch = curveTransform({ p_RotateY: series(() => 90) }, "p", ft);
  assert.ok(Math.abs(appToUe(new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...pitch.rotation[1].slice(0, 4)))).z - 1) < 1e-6,
    "RotateY is pitch: UE +X turns up to +Z");
  assert.equal(curve.scale, undefined, "unit scale is left out");
  assert.equal(curveTransform({ Other_RotateX: series(() => 1) }, "prop01", ft), null, "no curves of that prefix");
});

test("curves are key-reduced on quaternions: constants keep two keys, a swing interpolates within 0.1 degree", () => {
  const swing = series(i => -86.88 * i / (frames - 1)); // MonsterMan pole: 0 -> -86.88 about Y
  const curve = curveTransform({ prop01_TranslateX: series(() => 43), prop01_RotateY: swing }, "prop01", ft);
  assert.deepEqual(curve.translation[0], [0, frames - 1], "a constant translation: first and last key");
  for (let f = 0; f <= frames - 1; f += 0.5) {
    const got = new THREE.Quaternion(...at(curve.rotation, f, 4)).normalize();
    const exact = curveTransform({ prop01_RotateY: series(() => -86.88 * f / (frames - 1)) }, "prop01", ft);
    const want = new THREE.Quaternion(...exact.rotation[1].slice(0, 4));
    assert.ok(THREE.MathUtils.radToDeg(got.angleTo(want)) < 0.15, `frame ${f}`);
  }
  // An Euler wrap (RotateX 179 -> -179, PilotCheckList's pen does this) is a 2-degree turn, not a 358-degree spin.
  const wrap = curveTransform({ p_RotateX: series(i => i < 15 ? 179 : -179) }, "p", ft);
  const a = new THREE.Quaternion(...at(wrap.rotation, 14, 4)), b = new THREE.Quaternion(...at(wrap.rotation, 15, 4));
  assert.ok(a.dot(b) > 0, "one hemisphere");
  const mid = new THREE.Quaternion(...at(wrap.rotation, 14.5, 4)).normalize();
  assert.ok(THREE.MathUtils.radToDeg(mid.angleTo(a)) < 1.5, "the in-between frame stays between them");
});

// --- Blueprint child components (SCS) ------------------------------------------------------------------------------
const ref = (cls, name, path = "/Game/T") => ({ ObjectName: `${cls}'${name}'`, ObjectPath: `${path}.0` });
function scsNode(name, template, props = {}) {
  return { Type: "SCS_Node", Name: name, Properties: { ComponentTemplate: ref("SkeletalMeshComponent", `BP_C:${template}`), ...props } };
}
function component(type, name, props = {}) { return { Type: type, Name: name, Properties: props }; }

test("SCS children keep their parent and their AttachToName socket (Puppeteer doll, CoconutRider cans)", () => {
  const leader = { SkeletalMesh: ref("SkeletalMesh", "_3P_MasterSkeletonNullMesh", "/Game/Null"), AnimClass: ref("AnimBlueprintGeneratedClass", "ABP_C", "/Game/ABP") };
  const exports = [
    scsNode("SCS_Node_1", "SkeletalMesh_GEN_VARIABLE", { ParentComponentOrVariableName: "Mesh",
      ChildNodes: [ref("SCS_Node", "BP_C:SimpleConstructionScript_0.SCS_Node_2"), ref("SCS_Node", "BP_C:SimpleConstructionScript_0.SCS_Node_4")] }),
    scsNode("SCS_Node_2", "MeshProxy_GEN_VARIABLE"),
    scsNode("SCS_Node_4", "StaticMesh_GEN_VARIABLE", { AttachToName: "prop_01" }),
    component("SkeletalMeshComponent", "SkeletalMesh_GEN_VARIABLE", { ...leader, RelativeScale3D: { X: 0.3, Y: 0.3, Z: 0.3 } }),
    component("SkeletalMeshComponent", "MeshProxy_GEN_VARIABLE", { SkeletalMesh: ref("SkeletalMesh", "SK_EmoteProxyCharacter", "/Game/Proxy") }),
    component("StaticMeshComponent", "StaticMesh_GEN_VARIABLE", { StaticMesh: ref("StaticMesh", "SM_SodaCan_01_Emote", "/Game/Can") }),
    component("StaticMeshComponent", "Mesh", {}),
  ];
  const s = surveyActor(exports, "BP_Test_Proxy_Prop");
  const by = Object.fromEntries(s.components.map(c => [c.name, c]));
  assert.equal(by.SkeletalMesh_GEN_VARIABLE.parent, "Mesh", "a root node's inherited parent");
  assert.equal(by.MeshProxy_GEN_VARIABLE.parent, "SkeletalMesh_GEN_VARIABLE", "the doll under its 0.3-scaled leader");
  assert.equal(by.StaticMesh_GEN_VARIABLE.parent, "SkeletalMesh_GEN_VARIABLE");
  assert.equal(by.StaticMesh_GEN_VARIABLE.attachSocket, "prop_01", "the can on the leader's bone");
  assert.equal(by.MeshProxy_GEN_VARIABLE.attachSocket, null);
});
