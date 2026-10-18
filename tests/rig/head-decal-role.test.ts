import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { headDecalRole } from "../../src/rig/CharacterRig.ts";

const material = (name: string, slot?: string) => {
  const m = new THREE.MeshStandardMaterial({ name });
  if (slot) m.userData.sourceSlot = { MaterialSlotName: slot };
  return m;
};

test("source head sections are classified by their slot, whatever the recovered material is called", () => {
  // Recovered materials on 21 of 22 faces are named after a hashed manifest id.
  assert.equal(headDecalRole(material("skin-8373c1d3d21fd03ef3f298c5:recovered", "shader_head_shader")), "head");
  assert.equal(headDecalRole(material("skin-58112ea674f87d5f062df368:recovered", "shader_eyeLeft_shader")), "eyes");
  assert.equal(headDecalRole(material("skin-58112ea674f87d5f062df368:recovered", "shader_eyeRight_shader")), "eyes");
  for (const slot of ["shader_eyelashes_shader", "shader_teeth_shader", "shader_eyeshell_shader", "shader_eyeEdge_shader"])
    assert.equal(headDecalRole(material("skin-b38d50ca99c780941e271da9:recovered", slot)), null, slot);
  // A slot always wins over a misleading name.
  assert.equal(headDecalRole(material("eyes-face-01:recovered", "shader_head_shader")), "head");
});

test("a legacy material without a source slot keeps the name rule", () => {
  assert.equal(headDecalRole(material("MI_Head_Face_01_Base_Head")), "head");
  assert.equal(headDecalRole(material("MI_Head_Face_01_Base_Eyes")), "eyes");
  for (const name of ["MI_Head_Face_01_Base_EyeShell", "MI_Head_Face_01_Base_Eyelashes", "MI_Head_HeadMaster_Base_Teeth"])
    assert.equal(headDecalRole(material(name)), null, name);
});
