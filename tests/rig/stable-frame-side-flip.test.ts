import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { StableFrameState } from "../../src/rig/StableFrameState";

// w133 (5 Nov 2026, _docs/goal-100-2026-10-11/w133-material-reset/). three r184's renderObject draws a transparent
// double-sided material back side then front side, setting needsUpdate before each (version + 2 per draw), and its
// transmission pass does the same for a double-sided transmissive one. The stable-frame state recorded that version, so
// the football helmet's glass visor reset the accumulator on every frame and the default view never converged.

const renderer = { toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1, outputColorSpace: THREE.SRGBColorSpace,
  shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap }, getClearColor: (c: THREE.Color) => c.set(0),
  getClearAlpha: () => 0 } as unknown as THREE.WebGLRenderer;
const camera = new THREE.PerspectiveCamera();

/** Exactly what WebGLRenderer.renderObject does around a transparent double-sided draw (and the transmission pass
 *  around a double-sided transmissive one): flip the side, needsUpdate, draw, then restore DoubleSide. */
function threeSideFlip(material: THREE.Material) {
  material.side = THREE.BackSide; material.needsUpdate = true;
  material.side = THREE.FrontSide; material.needsUpdate = true;
  material.side = THREE.DoubleSide;
}

function sceneWith(material: THREE.Material) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), material));
  const state = new StableFrameState();
  state.capture(scene, camera, renderer);
  assert.equal(state.capture(scene, camera, renderer).changed, "", "the fixture is stable before any render");
  return { scene, state };
}

const glass = () => new THREE.MeshPhysicalMaterial({ transparent: true, side: THREE.DoubleSide, opacity: 0.3 });

test("three's own side-flip bumps during the accumulator's render are not an input change", () => {
  const material = glass();
  const { scene, state } = sceneWith(material);
  for (let frame = 0; frame < 3; frame++) {
    state.renderDiscountingSideFlips(() => { threeSideFlip(material); threeSideFlip(material); }); // two draws
    assert.equal(state.capture(scene, camera, renderer).changed, "", `frame ${frame} reuses the history`);
  }
  assert.equal(material.version, 12, "three's bookkeeping still ran: six draws, two bumps each");
});

test("a double-sided transmissive material is discounted the same way", () => {
  const material = new THREE.MeshPhysicalMaterial({ transmission: 0.6, side: THREE.DoubleSide });
  const { scene, state } = sceneWith(material);
  state.renderDiscountingSideFlips(() => threeSideFlip(material));
  assert.equal(state.capture(scene, camera, renderer).changed, "");
});

test("a needsUpdate outside the render, or on a material three never flips, still resets", () => {
  const material = glass();
  const { scene, state } = sceneWith(material);
  material.needsUpdate = true; // an edit: a define or onBeforeCompile change signals only through the version
  assert.equal(state.capture(scene, camera, renderer).changed, "material");
  assert.equal(state.capture(scene, camera, renderer).changed, "");

  for (const other of [new THREE.MeshStandardMaterial(),
    new THREE.MeshStandardMaterial({ transparent: true, side: THREE.DoubleSide, forceSinglePass: true }),
    new THREE.MeshStandardMaterial({ transparent: true, side: THREE.FrontSide })]) {
    const fixture = sceneWith(other);
    fixture.state.renderDiscountingSideFlips(() => { other.needsUpdate = true; });
    assert.equal(fixture.state.capture(fixture.scene, camera, renderer).changed, "material",
      `side ${other.side}, transparent ${other.transparent}, single pass ${other.forceSinglePass}`);
  }
});

test("a real change made during the render is still seen beside the discounted bumps", () => {
  const material = glass();
  const { scene, state } = sceneWith(material);
  state.renderDiscountingSideFlips(() => { threeSideFlip(material); material.opacity = 0.5; });
  assert.equal(state.capture(scene, camera, renderer).changed, "material");
});
