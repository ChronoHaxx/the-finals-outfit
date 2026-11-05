// (w98b cel family, decision #5) The runtime camera basis: a worldSurface program that reads the rendering
// camera's world axes (the cel eyes MI's fake highlight, cb0[24..26] = View.CameraViewToTranslatedWorld's
// right/up/forward rows; reads.cameraBasis in scripts/shader-probe/attachment_family_programs.json) gets them
// live from the camera's world matrix, in the source-world frame geometry.view and geometry.position use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import * as THREE from "three";
import { loadReconstructedMaterial } from "../../src/rig/ReconstructedMaterial";

(globalThis as { window?: unknown }).window ??= { location: { href: "https://camera-basis.test/" } };

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const pixel = new Uint8Array([1, 2, 3, 255]);
const shader = "uniform sampler2D u_t0;\n";
const texture = {
  id: "tex", slot: "t0", file: "texture.bin", array: false, depth: 1, srgb: false, wrapS: "TA_Wrap", wrapT: "TA_Wrap",
  sha256: sha(pixel), mips: [{ width: 1, height: 1, offset: 0, bytes: 4 }],
};
// The attachment-family worldSurface manifest shape (the cel eyes MI's, in the cut-out test's minimal form).
const family = (fields: string[], extra: Record<string, unknown> = {}) => ({
  formatVersion: 1, itemId: "camera-basis-test", shader: "surface.glsl", shaderSha256: sha(shader), requiredUvSets: [0],
  worldSurface: true, geometryFrame: "source-world", normalSpace: "tangent", twoSided: true, blendMode: "BLEND_Masked",
  surfaceKind: "attachment-family", attachmentFamily: true, textures: [texture], requiredGeometryFields: fields,
  ...extra,
});

type TestContext = { mock: { method: (object: object, name: string, implementation: unknown) => unknown } };

function serve(t: TestContext, manifests: Record<string, unknown>) {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const name = String(input).slice("https://camera-basis.test/".length);
    if (name in manifests) return new Response(JSON.stringify(manifests[name]));
    if (name === "surface.glsl") return new Response(shader);
    if (name === "texture.bin") return new Response(new Uint8Array(gzipSync(pixel)));
    return new Response("", { status: 404 });
  });
}

async function fragment(t: TestContext, manifest: unknown) {
  serve(t, { "family.json": manifest });
  const loaded = await loadReconstructedMaterial("https://camera-basis.test/family.json");
  const g = new THREE.PlaneGeometry();
  g.computeTangents();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  loaded.apply(mesh, undefined, { boundsOrigin: [0, 0, 150] });
  const material = mesh.material as THREE.MeshPhysicalMaterial;
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(s as never, {} as THREE.WebGLRenderer);
  return { material, fragment: s.fragmentShader, cacheKey: material.customProgramCacheKey() };
}

const RIGHT = "recoveredGeometry.cameraRight = (transpose(mat3(viewMatrix)) * vec3(1.0, 0.0, 0.0)).xzy;";
const UP = "recoveredGeometry.cameraUp = (transpose(mat3(viewMatrix)) * vec3(0.0, 1.0, 0.0)).xzy;";
const FORWARD = "recoveredGeometry.cameraForward = (transpose(mat3(viewMatrix)) * vec3(0.0, 0.0, -1.0)).xzy;";

test("the camera axes are supplied only when the manifest's inputs need them", async t => {
  const plain = await fragment(t, family(["position", "normal", "view"]));
  for (const line of [RIGHT, UP, FORWARD])
    assert.ok(!plain.fragment.includes(line), line);
  assert.ok(!plain.cacheKey.includes(":world-camera-basis"));

  // The real eyes MI folds row 26 dead (FakeHighlightPosition.z = 0), so its manifest lists right and up only.
  const eyes = await fragment(t, family(["position", "normal", "view", "faceSign", "cameraRight", "cameraUp"]));
  assert.ok(eyes.fragment.includes(RIGHT));
  assert.ok(eyes.fragment.includes(UP));
  assert.ok(!eyes.fragment.includes(FORWARD));
  assert.ok(eyes.cacheKey.includes(":world-camera-basis"));

  const all = await fragment(t, family(["position", "normal", "view", "cameraRight", "cameraUp", "cameraForward"]));
  assert.ok(all.fragment.includes(RIGHT));
  assert.ok(all.fragment.includes(UP));
  assert.ok(all.fragment.includes(FORWARD));
});

test("a camera basis outside the worldSurface family route fails closed", async t => {
  serve(t, {
    "skin.json": family(["position", "normal", "view", "cameraRight"], { skinSurface: true }),
    "geometry.json": family(["position", "normal", "view", "cameraRight"], { geometryDependentNormals: true }),
  });
  for (const name of ["skin.json", "geometry.json"])
    await assert.rejects(loadReconstructedMaterial(`https://camera-basis.test/${name}`), /camera basis contract/, name);
});

// The emitted expression evaluated exactly as the shader would: transpose(mat3(viewMatrix)) is the view-to-world
// rotation, so its product with a view basis vector is that camera axis in three's world frame; .xzy is the
// source-world conversion every worldSurface vector takes (SourceTransform: UE (X, Y, Z) = three (x, z, y)).
function cameraAxes(camera: THREE.PerspectiveCamera) {
  const toWorld = new THREE.Matrix3().setFromMatrix4(camera.matrixWorldInverse).transpose();
  const axis = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix3(toWorld);
  const source = (v: THREE.Vector3) => new THREE.Vector3(v.x, v.z, v.y);
  return {
    right: source(axis(1, 0, 0)), up: source(axis(0, 1, 0)), forward: source(axis(0, 0, -1)),
    forwardWorld: axis(0, 0, -1),
  };
}

// The same axes derived independently from the camera's world matrix columns: right = +X, up = +Y, forward = -Z.
function expectedAxes(camera: THREE.PerspectiveCamera) {
  const e = camera.matrixWorld.elements;
  const column = (i: number) => new THREE.Vector3(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]);
  const source = (v: THREE.Vector3) => new THREE.Vector3(v.x, v.z, v.y);
  return { right: source(column(0)), up: source(column(1)), forward: source(column(2)).negate() };
}

const POSES: [THREE.Vector3, THREE.Euler][] = [
  [new THREE.Vector3(0, 0, 0), new THREE.Euler(0, 0, 0)],
  [new THREE.Vector3(3, -2, 7), new THREE.Euler(0.3, 0.8, 0.1)],
  [new THREE.Vector3(-1.5, 2.25, -4), new THREE.Euler(-1.1, -2.4, 0.6)],
];

test("a known camera pose maps to the expected source-world vectors", async t => {
  const compiled = await fragment(t, family(["position", "normal", "view", "cameraRight", "cameraUp", "cameraForward"]));
  assert.ok(compiled.fragment.includes(RIGHT) && compiled.fragment.includes(UP) && compiled.fragment.includes(FORWARD));
  for (const [position, rotation] of POSES) {
    const camera = new THREE.PerspectiveCamera();
    camera.position.copy(position);
    camera.rotation.copy(rotation);
    camera.updateMatrixWorld(true);
    const axes = cameraAxes(camera);
    const expected = expectedAxes(camera);
    for (const key of ["right", "up", "forward"] as const) {
      assert.ok(axes[key].distanceTo(expected[key]) < 1e-9, `${key}: ${axes[key]} != ${expected[key]}`);
      assert.ok(Math.abs(axes[key].length() - 1) < 1e-9, `${key}: not unit length`);
    }
  }
});

test("cameraForward agrees with geometry.view at the screen centre, with the opposite sign", async t => {
  await fragment(t, family(["position", "normal", "view", "cameraForward"]));
  for (const [position, rotation] of POSES) {
    const camera = new THREE.PerspectiveCamera();
    camera.position.copy(position);
    camera.rotation.copy(rotation);
    camera.updateMatrixWorld(true);
    const { forward, forwardWorld } = cameraAxes(camera);
    // The fragment at the screen centre sits exactly on the camera axis. The worldSurface block's view is
    // transpose(mat3(viewMatrix)) * vViewPosition with three's NEGATED vViewPosition, so it points from the
    // fragment TOWARD the camera; the camera's forward axis points away from the camera into the scene:
    // geometry.view = -|view| * cameraForward, i.e. cameraForward = -normalize(geometry.view).
    const world = camera.position.clone().addScaledVector(forwardWorld, 5);
    const viewPosition = world.clone().applyMatrix4(camera.matrixWorldInverse).negate();
    const worldView = viewPosition.applyMatrix3(
      new THREE.Matrix3().setFromMatrix4(camera.matrixWorldInverse).transpose());
    const geometryView = new THREE.Vector3(worldView.x, worldView.z, worldView.y).multiplyScalar(100);
    const centreForward = geometryView.clone().normalize().negate();
    assert.ok(centreForward.distanceTo(forward) < 1e-9, `${centreForward} != ${forward}`);
  }
});

test("right x up has the handedness the source frame needs", async t => {
  await fragment(t, family(["position", "normal", "view", "cameraRight", "cameraUp", "cameraForward"]));
  for (const [position, rotation] of POSES) {
    const camera = new THREE.PerspectiveCamera();
    camera.position.copy(position);
    camera.rotation.copy(rotation);
    camera.updateMatrixWorld(true);
    const { right, up, forward } = cameraAxes(camera);
    // UE's camera basis is left-handed with the standard cross product over its stored coordinates: the
    // right x up of CameraViewToTranslatedWorld's rows is its forward row. The source-world frame keeps UE's
    // coordinate order, so the supplied axes must satisfy the same relation.
    const cross = right.clone().cross(up);
    assert.ok(cross.distanceTo(forward) < 1e-9, `${cross} != ${forward}`);
  }
});
