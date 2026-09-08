import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CharacterRig, type RigMaterialBinding } from "../../src/rig/CharacterRig.ts";
import { MaterialBindingSchema } from "../../src/lib/item.ts";

function mesh(material: THREE.Material | THREE.Material[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 1, 0, 1, 1, 0, 0, 2, 0], 3));
  return new THREE.Mesh(geometry, material);
}

function setup(scene: THREE.Group, fail: string[] = []) {
  const loaded = new Map<string, THREE.Texture>();
  const disposed = new Set<string>();
  const rig = new CharacterRig({ loadAsync: async () => ({ scene }) } as never);
  const internals = rig as unknown as {
    skeleton: THREE.Skeleton;
    texLoader: { loadAsync: (url: string) => Promise<THREE.Texture> };
  };
  internals.skeleton = new THREE.Skeleton([]);
  internals.texLoader.loadAsync = async (url) => {
    if (fail.includes(url)) throw new Error(`fixture failed: ${url}`);
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.addEventListener("dispose", () => disposed.add(url));
    loaded.set(url, texture);
    return texture;
  };
  return { rig, loaded, disposed };
}

const led: RigMaterialBinding = {
  family: "led", doubleSided: false,
  ledScreen: {
    animation: "led.webp", colorRamp: "ramp.webp", normal: "visor-normal.webp",
    brightness: 25, frameCount: 16, trackCount: 8, animationTrack: 0,
    animationSpeed: 15, uvScale: 0.54, uvOffsetV: -0.08, captureTime: 0,
  },
};

test("helmet shell and LED visor keep distinct bindings across shared and array materials", async () => {
  const embedded = new THREE.Texture();
  const shell = new THREE.MeshStandardMaterial({ map: embedded, side: THREE.DoubleSide });
  shell.name = "MI_Helmet_Helmet";
  const visor = new THREE.MeshStandardMaterial({ map: embedded, normalMap: embedded, side: THREE.DoubleSide });
  visor.name = "MI_Helmet_Visor";
  const unknown = new THREE.MeshStandardMaterial({ map: embedded, roughness: 0.12 });
  unknown.name = "Untouched";
  const combined = mesh([shell, visor]);
  const repeated = mesh(shell);
  const untouched = mesh(unknown);
  const scene = new THREE.Group().add(combined, repeated, untouched);
  const { rig, loaded, disposed } = setup(scene);
  let embeddedDisposed = false;
  embedded.addEventListener("dispose", () => { embeddedDisposed = true; });
  await rig.equip({ id: "helmet", slot: "headwear", url: "helmet.glb",
    material: { bakedSet: { albedo: "wrong.webp", normal: "wrong-normal.webp", orm: "wrong-orm.webp" } },
    materialBindings: {
      MI_Helmet_Helmet: {
        family: "layered", doubleSided: false,
        bakedSet: { albedo: "shell.webp", normal: "shell-normal.webp", orm: "shell-orm.webp" },
        garmentDecals: [{ region: -1, url: "logo.webp", place: [0, 0, 1, 0] }],
      },
      MI_Helmet_Visor: led,
      MissingMaterial: { family: "layered", emissiveMapUrl: "unused.webp" },
    },
  });
  assert.equal(shell.map, loaded.get("shell.webp"));
  assert.equal(shell.normalMap, loaded.get("shell-normal.webp"));
  assert.equal(shell.side, THREE.FrontSide);
  assert.equal((combined.material as THREE.Material[])[0], repeated.material);
  assert.notEqual(visor.map, shell.map);
  assert.equal(visor.normalMap, loaded.get("visor-normal.webp"));
  assert.equal(visor.roughnessMap, null);
  assert.equal(visor.side, THREE.FrontSide);
  assert.equal(visor.transparent, false);
  assert.equal(unknown.map, embedded);
  assert.equal(unknown.roughness, 0.12);
  assert.equal(embeddedDisposed, false, "unbound material still owns the shared embedded map");
  assert.equal(loaded.has("wrong.webp"), false, "authoritative bindings must not load the item-wide material");
  assert.equal(loaded.has("unused.webp"), false, "absent material names must not allocate textures");
  const shader = { uniforms: {}, fragmentShader: "#include <map_fragment>\n#include <emissivemap_fragment>" };
  visor.onBeforeCompile(shader as never, {} as never);
  assert.match(shader.fragmentShader, /uLedAnimation/);
  assert.match(shader.fragmentShader, /vec2\(8\.0, 16\.0\)/, "atlas uses tracks in columns and frames in rows");
  assert.doesNotMatch(shader.fragmentShader, /uGDecal/);
  rig.unequip("headwear");
  for (const url of ["shell.webp", "shell-normal.webp", "shell-orm.webp", "logo.webp", "led.webp", "ramp.webp", "visor-normal.webp"]) {
    assert.ok(disposed.has(url), `${url} must be disposed on unequip`);
  }
});

test("source glass properties replace visor shell maps and unknown bindings preserve embedded data", async () => {
  const visor = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), emissiveMap: new THREE.Texture(), metalness: 1 });
  visor.name = "MI_Helmet_Visor";
  const unknown = new THREE.MeshStandardMaterial({ color: "#123456", roughness: 0.17 });
  unknown.name = "Unknown";
  const lining = new THREE.MeshStandardMaterial({ color: "#654321", roughness: 0.21 });
  lining.name = "UnbakedLining";
  const scene = new THREE.Group().add(mesh(visor), mesh(unknown), mesh(lining));
  const { rig, loaded } = setup(scene);
  await rig.equip({ id: "glass", slot: "headwear", url: "glass.glb", material: { regionColors: ["#ff0000"] },
    materialBindings: {
      MI_Helmet_Visor: { family: "glass", doubleSided: true,
        glass: { color: "#171a18", opacity: 0.65, roughness: 0.45, normal: "glass-normal.webp" } },
      Unknown: { family: "unknown", doubleSided: false, regionColors: undefined, roughness: undefined },
      UnbakedLining: { family: "layered", doubleSided: true },
    },
  });
  assert.equal(visor.map, null);
  assert.equal(visor.emissiveMap, null);
  assert.equal(visor.normalMap, loaded.get("glass-normal.webp"));
  assert.equal(visor.color.getHexString(), "171a18");
  assert.equal(visor.opacity, 0.65);
  assert.equal(visor.roughness, 0.45);
  assert.equal(visor.metalness, 0);
  assert.equal(visor.side, THREE.DoubleSide);
  assert.equal(visor.depthWrite, false);
  assert.equal(unknown.color.getHexString(), "123456");
  assert.equal(unknown.roughness, 0.17);
  assert.equal(lining.color.getHexString(), "654321");
  assert.equal(lining.roughness, 0.21);
  assert.equal(lining.side, THREE.DoubleSide);
  rig.dispose();
});

test("failed binding textures release successful siblings and never borrow shell maps", async () => {
  const visor = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  visor.name = "MI_Helmet_Visor";
  const shell = new THREE.MeshStandardMaterial();
  shell.name = "Shell";
  const scene = new THREE.Group().add(mesh(visor), mesh(shell));
  const { rig, disposed } = setup(scene, ["led.webp", "broken-normal.webp"]);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await rig.equip({ id: "failed", slot: "headwear", url: "failed.glb", materialBindings: {
      MI_Helmet_Visor: led,
      Shell: { family: "layered", bakedSet: { albedo: "loaded-albedo.webp", normal: "broken-normal.webp", orm: "loaded-orm.webp" } },
    } });
  } finally {
    console.warn = warn;
  }
  assert.equal(visor.map, null, "missing LED animation must not restore the wrong shell texture");
  assert.equal(visor.emissiveMap, null);
  for (const url of ["ramp.webp", "visor-normal.webp", "loaded-albedo.webp", "loaded-orm.webp"]) {
    assert.ok(disposed.has(url), `${url} must be disposed after its set fails`);
  }
  rig.dispose();
});

test("legacy items still receive their material when no explicit bindings exist", async () => {
  const material = new THREE.MeshStandardMaterial();
  const { rig } = setup(new THREE.Group().add(mesh(material)));
  await rig.equip({ id: "legacy", slot: "headwear", url: "legacy.glb", material: { regionColors: ["#ff0000"], roughness: 0.3 } });
  assert.equal(material.color.getHexString(), "ff0000");
  assert.equal(material.roughness, 0.3);
  rig.dispose();
});

test("an identified LED material without an animation payload cannot display the shell texture", async () => {
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture() });
  material.name = "Display";
  const { rig } = setup(new THREE.Group().add(mesh(material)));
  await rig.equip({ id: "missing-display", slot: "headwear", url: "missing.glb",
    materialBindings: { Display: { family: "led", doubleSided: false } },
  });
  assert.equal(material.map, null);
  assert.equal(material.normalMap, null);
  assert.equal(material.emissive.getHex(), 0);
  rig.dispose();
});

test("inspector side changes preserve a shared LED shader with independently owned textures", async () => {
  const material = new THREE.MeshStandardMaterial();
  material.name = "MI_Helmet_Visor";
  const first = mesh(material);
  const second = mesh(material);
  const { rig } = setup(new THREE.Group().add(first, second));
  await rig.equip({ id: "shared-led", slot: "headwear", url: "shared-led.glb",
    materialBindings: { MI_Helmet_Visor: led },
  });
  rig.setMeshSide(first.uuid, "double");
  const copy = first.material as THREE.MeshStandardMaterial;
  assert.notEqual(copy, material);
  assert.equal(copy.side, THREE.DoubleSide);
  assert.equal(material.side, THREE.FrontSide);
  assert.notEqual(copy.userData.ledAnimationTexture, material.userData.ledAnimationTexture);
  const shader = { uniforms: {} as Record<string, { value: unknown }>, fragmentShader: "#include <emissivemap_fragment>" };
  copy.onBeforeCompile(shader as never, {} as never);
  assert.match(shader.fragmentShader, /uLedAnimation/);
  assert.equal(shader.uniforms.uLedAnimation.value, copy.userData.ledAnimationTexture);
  assert.equal(shader.uniforms.uLedColorRamp.value, copy.userData.ledColorRampTexture);
  assert.notEqual(copy.customProgramCacheKey(), material.customProgramCacheKey());
  let disposed = false;
  (copy.userData.ledAnimationTexture as THREE.Texture).addEventListener("dispose", () => { disposed = true; });
  rig.dispose();
  assert.equal(disposed, true);
});

test("binding schema rejects invalid LED atlas dimensions and retains source shader metadata", () => {
  assert.deepEqual(MaterialBindingSchema.parse(led), led);
  assert.equal(MaterialBindingSchema.safeParse({ ...led, ledScreen: { ...led.ledScreen, frameCount: 0 } }).success, false);
  assert.equal(MaterialBindingSchema.safeParse({ family: "inferred-glass" }).success, false);
});
