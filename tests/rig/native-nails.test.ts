import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { CharacterRig, type RigDecal } from "../../src/rig/CharacterRig.ts";
import type { SourceRigPart } from "../../src/rig/SourceAssembly.ts";

// Native nails are a source assembly in the nailPolish slot, which older catalog data fills with a
// broad grey tint composited onto the body skin. The two must never show together: committing the
// source nail is what removes the tint, including when a covering glove leaves the nail with no
// visible part. Texture loads are released by hand, so ordering is asserted rather than raced.

const ORIGIN = "http://nails.test/";
const MASK = "models/decals/_shared/nailmask.webp"; // the rig's default shared nail mask
const NAILS_MESH = "/Game/Discovery/Characters/Nails/SK_Nails_M.SK_Nails_M";
const BLACK = "/Game/Discovery/Characters/BodyCosmetics/Nails/Black_01/MI_Nails_Black_01.MI_Nails_Black_01";
const WHITE = "/Game/Discovery/Characters/BodyCosmetics/Nails/White_01/MI_Nails_White_01.MI_Nails_White_01";
const GREY: RigDecal = { layers: [{ target: "nails", tint: "#9898a8" }] };

// A recovered material with a real hashed shader file and no textures: enough for the loader.
const files = new Map<string, string>();
for (const id of ["nails-black", "nails-white"]) {
  const shader = `ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1) {\n  ReconstructedSurface surface; // ${id}\n  return surface;\n}\n`;
  files.set(`${ORIGIN}materials/${id}.glsl`, shader);
  files.set(`${ORIGIN}materials/${id}.json`, JSON.stringify({ formatVersion: 1, itemId: id, shader: `${id}.glsl`,
    shaderSha256: createHash("sha256").update(shader).digest("hex"), textures: [], requiredUvSets: [0] }));
}
globalThis.fetch = (async (input: string | URL | Request) => {
  const body = files.get(String(input));
  return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
}) as typeof fetch;
(globalThis as { window?: unknown }).window = { location: { href: ORIGIN } };

// The preserved GLB's shape: one skinned section named by its source slot, bones named like the body.
function nailScene(): THREE.Group {
  const root = new THREE.Bone(); root.name = "root";
  const hand = new THREE.Bone(); hand.name = "hand_r"; root.add(hand);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const material = new THREE.MeshStandardMaterial({ name: "MI_Nails_Placeholder" });
  material.userData.sourceSlot = { MaterialSlotName: "Nails" };
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const scene = new THREE.Group().add(root, mesh);
  mesh.bind(new THREE.Skeleton([root, hand]));
  return scene;
}

function harness() {
  const driverRoot = new THREE.Bone(); driverRoot.name = "root";
  const driverHand = new THREE.Bone(); driverHand.name = "hand_r"; driverRoot.add(driverHand);
  const rig = new CharacterRig({ loadAsync: async () => ({ scene: nailScene() }) } as never);
  const internals = rig as unknown as {
    skeleton: THREE.Skeleton; bonesByName: Map<string, THREE.Bone>; bodyRestInverses: Map<string, THREE.Matrix4>;
    texLoader: { load: (url: string, onLoad: (t: THREE.Texture) => void, p?: unknown, onError?: (e: unknown) => void) => THREE.Texture };
    decals: { registerTarget: (name: "body", materials: THREE.MeshStandardMaterial[]) => void };
  };
  internals.skeleton = new THREE.Skeleton([driverRoot, driverHand]);
  internals.bonesByName = new Map([["root", driverRoot], ["hand_r", driverHand]]);
  internals.bodyRestInverses = new Map([["root", new THREE.Matrix4()], ["hand_r", new THREE.Matrix4()]]);
  const open: { url: string; texture: THREE.Texture; onLoad: (t: THREE.Texture) => void }[] = [];
  internals.texLoader.load = (url, onLoad) => {
    const texture = new THREE.Texture();
    open.push({ url, texture, onLoad });
    return texture;
  };
  const body = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  internals.decals.registerTarget("body", [body]);
  return {
    rig, body, driverHand, internals,
    // set() issues the shared mask request only after its per-layer loads settle.
    async release(url: string) {
      await new Promise(resolve => setImmediate(resolve));
      const request = open.find(r => r.url === url);
      assert.ok(request, `no open request for ${url}`);
      open.splice(open.indexOf(request), 1);
      request.onLoad(request.texture);
    },
    key: () => body.customProgramCacheKey(),
    patched: () => body.userData.decalPatched === true,
    nail: () => rig.root.children.find(o => o.userData.rigItemId?.startsWith("bodycosmetics-nails-")),
  };
}

const part = (id: "nails-black" | "nails-white", source: string): SourceRigPart => ({
  sourceIndex: 0, sourceMesh: NAILS_MESH, url: `${ORIGIN}meshes/SK_Nails_M.glb`,
  materials: { Nails: { url: `${ORIGIN}materials/${id}.json`, source } },
});
const nail = (id: string, parts: SourceRigPart[]) => ({ id, slot: "nailPolish" as const, url: "", sourceParts: parts });
const skinnedMesh = (root: THREE.Object3D | undefined) =>
  root?.getObjectsByProperty("isSkinnedMesh", true)[0] as THREE.SkinnedMesh | undefined;

test("a committed source nail removes the legacy grey tint from its slot and keeps other body paint", async () => {
  const h = harness();
  const tint = h.rig.equipDecal("nailPolish", GREY);
  h.release(MASK);
  await tint;
  const tattoo = h.rig.equipDecal("tattoo", { layers: [{ target: "body", colorUrl: "tattoo_c.webp" }] });
  h.release("tattoo_c.webp");
  await tattoo;
  assert.match(h.key(), /nailsmt/, "fixture: the grey nail tint is composited before the source nail");

  await h.rig.equip(nail("bodycosmetics-nails-black-01", [part("nails-black", BLACK)]));
  assert.doesNotMatch(h.key(), /nails/, "the source nail and the legacy grey tint are shown together");
  assert.match(h.key(), /bodyc/, "an unrelated tattoo was removed with the nail tint");
  const mesh = skinnedMesh(h.nail());
  assert.ok(mesh, "the source nail geometry was not attached");
  assert.equal(h.rig.sourceAssemblyId("nailPolish"), "bodycosmetics-nails-black-01");
  const material = mesh.material as THREE.Material;
  assert.equal(material.userData.reconstructed, true);
  assert.equal(material.userData.sourceMaterial, BLACK);
  assert.ok(mesh.skeleton.bones.includes(h.driverHand), "the nail must skin from the body's driver bones");
});

test("a glove-covered source nail with no visible part still suppresses the legacy tint", async () => {
  const h = harness();
  const tint = h.rig.equipDecal("nailPolish", GREY);
  h.release(MASK);
  await tint;
  await h.rig.equip(nail("bodycosmetics-nails-black-01", []));
  assert.equal(h.patched(), false, "the hidden source nail brought the grey fallback back");
  assert.equal(h.rig.sourceAssemblyId("nailPolish"), "bodycosmetics-nails-black-01");
  assert.equal(skinnedMesh(h.nail()), undefined, "a covered nail must not attach geometry");
  // A face/skin swap re-registers the body target; a removed tint must not be revived by it.
  h.internals.decals.registerTarget("body", [h.body]);
  assert.equal(h.patched(), false, "re-registering the body revived the removed nail tint");
});

test("a legacy tint still loading when the source nail commits never appears", async () => {
  const h = harness();
  const tint = h.rig.equipDecal("nailPolish", GREY); // the shared mask request is still open
  await h.rig.equip(nail("bodycosmetics-nails-black-01", [part("nails-black", BLACK)]));
  h.release(MASK);
  await tint;
  assert.equal(h.patched(), false, "a superseded grey tint painted over the committed source nail");
});

test("swapping and removing source nails replaces and releases their meshes and materials", async () => {
  const h = harness();
  await h.rig.equip(nail("bodycosmetics-nails-black-01", [part("nails-black", BLACK)]));
  const black = skinnedMesh(h.nail())!;
  const released: string[] = [];
  (black.material as THREE.Material).addEventListener("dispose", () => released.push("black material"));
  black.geometry.addEventListener("dispose", () => released.push("black geometry"));

  await h.rig.equip(nail("bodycosmetics-nails-white-01", [part("nails-white", WHITE)]));
  const white = skinnedMesh(h.nail())!;
  assert.deepEqual(released.sort(), ["black geometry", "black material"]);
  assert.equal((white.material as THREE.Material).userData.sourceMaterial, WHITE);
  assert.equal(h.rig.root.children.filter(o => o.userData.rigItemId?.startsWith("bodycosmetics-nails-")).length, 1);

  let whiteReleased = false;
  (white.material as THREE.Material).addEventListener("dispose", () => { whiteReleased = true; });
  h.rig.unequip("nailPolish");
  assert.equal(whiteReleased, true);
  assert.equal(h.nail(), undefined);
  assert.equal(h.rig.equippedItemId("nailPolish"), undefined);
  assert.equal(h.patched(), false, "removing the nail must leave the bare body material");
});
