import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { CharacterRig } from "../../src/rig/CharacterRig.ts";

const ROOT = process.cwd();
const SKI_BLADE = join(ROOT, "public", "models", "cosmetics", "attachments-ski-blade.glb");

function glbJson(file: string): { nodes?: { name?: string; mesh?: number }[]; meshes?: { primitives?: { material?: number }[] }[] } {
  const buf = readFileSync(file);
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.toString("utf8", 20, 20 + jsonLength));
}

test("the known ski-blade GLB really reuses one material across mesh nodes", () => {
  assert.ok(existsSync(SKI_BLADE), "the extracted ski-blade fixture is required for this regression");
  const glb = glbJson(SKI_BLADE);
  const users = new Map<number, string[]>();
  for (const node of glb.nodes ?? []) {
    if (node.mesh == null) continue;
    for (const primitive of glb.meshes?.[node.mesh]?.primitives ?? []) {
      if (primitive.material == null) continue;
      const names = users.get(primitive.material) ?? [];
      names.push(node.name ?? "(unnamed)");
      users.set(primitive.material, names);
    }
  }
  assert.ok([...users.values()].some((names) => new Set(names).size >= 2), "expected a material shared by two nodes");
});

test("side toggles isolate shared meshes, retain live inspector state, and dispose overrides", () => {
  const rig = new CharacterRig({} as never);
  const body = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const shared = new THREE.MeshStandardMaterial({ map: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) });
  shared.map!.needsUpdate = true;
  const selected = new THREE.Mesh(geometry, shared);
  selected.name = "Skiblades_Left";
  const sibling = new THREE.Mesh(geometry, shared);
  sibling.name = "Skiblades_Right";
  const solo = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  solo.name = "Solo";
  body.add(selected, sibling, solo);
  rig.root.add(body);
  (rig as unknown as { bodyScene: THREE.Object3D }).bodyScene = body;

  rig.setMeshSide(selected.uuid, "double");
  assert.equal(selected.material.side, THREE.DoubleSide);
  assert.equal(sibling.material.side, THREE.FrontSide);
  assert.notEqual(selected.material, shared, "the selected mesh should own a material override");
  assert.equal(shared.map, sibling.material.map, "the source texture remains on the sibling material");
  assert.notEqual(selected.material.map, shared.map, "the override owns its cloned texture");

  const inspected = rig.inspect().flatMap((group) => group.meshes);
  assert.equal(inspected.find((mesh) => mesh.uuid === selected.uuid)?.materials[0].side, "double");
  assert.equal(inspected.find((mesh) => mesh.uuid === sibling.uuid)?.materials[0].side, "front");

  rig.setMeshSide(selected.uuid, "front");
  assert.equal(selected.material.side, THREE.FrontSide, "toggling a second time updates the existing copy");
  assert.equal(sibling.material.side, THREE.FrontSide);

  rig.setMeshSide(solo.uuid, "double");
  assert.equal(solo.material.side, THREE.DoubleSide, "unshared materials still toggle in place");

  let overrideDisposed = false;
  selected.material.addEventListener("dispose", () => {
    overrideDisposed = true;
  });
  rig.dispose();
  assert.equal(overrideDisposed, true, "the cloned material is disposed with its owning scene");
});
