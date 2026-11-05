// Decision #19 (w131, 4 Nov 2026): AlphaHashSampling patches three's real alpha-hash templates for the surface and
// shadow programs, shares the accumulator's sample uniforms, and validates the sample it is told to draw. The
// convergence itself is GPU behaviour: _docs/goal-100-2026-10-11/w131-alpha-hash-seed/probe-convergence.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  alphaHashSalt, alphaHashSample, alphaHashSampleBits, installSampledAlphaHash, setAlphaHashSample,
} from "../../src/rig/AlphaHashSampling";

const program = (name: "physical" | "depth" | "distance") => ({
  vertexShader: THREE.ShaderLib[name].vertexShader, fragmentShader: THREE.ShaderLib[name].fragmentShader,
  uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib[name].uniforms),
}) as unknown as THREE.WebGLProgramParametersWithUniforms;

for (const name of ["physical", "depth", "distance"] as const) {
  test(`the ${name} program draws its alpha-hash test through the sampled threshold`, () => {
    const shader = program(name), material = new THREE.MeshPhysicalMaterial();
    installSampledAlphaHash(shader, material);
    assert.equal(shader.uniforms.alphaHashSample, alphaHashSample, "the accumulator's shared sample uniform");
    assert.equal(shader.uniforms.alphaHashSampleBits, alphaHashSampleBits);
    assert.equal(shader.uniforms.alphaHashSalt.value, alphaHashSalt(material.uuid));
    assert.ok(!shader.fragmentShader.includes("#include <alphahash_fragment>"), "three's own test is replaced");
    assert.match(shader.fragmentShader, /diffuseColor\.a < sampledAlphaHashThreshold\( vPosition \)/);
    // three's spatial hash stays the index-0 path, so it must still be declared before the sampled threshold.
    const pars = shader.fragmentShader.indexOf("#include <alphahash_pars_fragment>");
    assert.ok(pars >= 0 && pars < shader.fragmentShader.indexOf("float sampledAlphaHashThreshold"));
    assert.match(shader.vertexShader, /#include <begin_vertex>\s*#ifdef USE_ALPHAHASH\s*vAlphaHashVertex = uint\( gl_VertexID \);/);
    assert.ok(shader.vertexShader.startsWith("#ifdef USE_ALPHAHASH\nflat varying uint vAlphaHashVertex;"));
  });
}

test("a changed three chunk is refused, not silently skipped", () => {
  const shader = program("depth");
  shader.fragmentShader = shader.fragmentShader.replace("#include <alphahash_fragment>", "");
  assert.throws(() => installSampledAlphaHash(shader, new THREE.MeshDepthMaterial()), /alphahash_fragment/);
});

test("materials get distinct stable salts", () => {
  assert.equal(alphaHashSalt("a"), alphaHashSalt("a"));
  assert.notEqual(alphaHashSalt(new THREE.MeshPhysicalMaterial().uuid), alphaHashSalt(new THREE.MeshPhysicalMaterial().uuid));
  assert.ok(alphaHashSalt("x") < 2 ** 24);
});

test("the sample strata cover the sample count", () => {
  try {
    setAlphaHashSample(31, 32); assert.deepEqual([alphaHashSample.value, alphaHashSampleBits.value], [31, 5]);
    setAlphaHashSample(5, 24); assert.equal(alphaHashSampleBits.value, 5, "24 samples draw from 32 strata");
    setAlphaHashSample(255, 256); assert.equal(alphaHashSampleBits.value, 8);
    for (const [index, count] of [[32, 32], [-1, 32], [1.5, 32], [0, 0], [0, 257]])
      assert.throws(() => setAlphaHashSample(index, count), /Invalid alpha-hash sample/);
  } finally {
    setAlphaHashSample(0);
  }
  assert.equal(alphaHashSample.value, 0, "index 0 is three's own hash");
});
