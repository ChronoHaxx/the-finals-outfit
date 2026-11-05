// M_FloatingHologram runtime (design _docs/goal-100-2026-10-11/floatinghologram-contract/design-study.md section 5): the
// hologram manifest validation, the additive unlit material state, the emitted GLSL, the view rectangle, the
// split-sampler slots, the stable-frame activation and the accumulator's alpha-0 pass-through define.
// GPU behaviour (blending, y-flip, 2E, tone mapping, the real probe manifests) is checked in the browser by
// scripts/shader-probe/check-hologram-runtime.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import * as THREE from "three";
import { OutputShader } from "three/examples/jsm/shaders/OutputShader.js";
import { loadReconstructedMaterial } from "../../src/rig/ReconstructedMaterial";
import { planReconstructedSamplers, rewriteSamplerGlsl, samplerUniformBindings } from "../../src/rig/ReconstructedSamplers";
import { StableFrameState } from "../../src/rig/StableFrameState";
import { StableFrameAccumulator } from "../../src/rig/StableFrameAccumulator";

const BASE = "https://hologram.test/";
(globalThis as { window?: unknown }).window ??= { location: { href: BASE } };

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const PROGRAM = "538e2b69d7363ccdf0fcd21735877c3699ecc5051b1e3e5a923f3c5b5a6a3d57";
const VIEW_STRUCT = "struct ReconstructedView { vec2 fragCoord; vec2 rectMin; vec2 invSize; };";
const surface = (body: string, view: boolean) => [
  "uniform highp sampler2D u_t3_s1;",
  "uniform highp sampler2D u_t3_s3;",
  ...(view ? [VIEW_STRUCT] : []),
  `ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1${view ? ", ReconstructedView view" : ""}) {`,
  "  ReconstructedSurface surface;",
  `  surface.emissive = ${body};`,
  "  return surface;",
  "}", ""].join("\n");
const SHADERS: Record<string, string> = {
  "view.glsl": surface("vec3(texture(u_t3_s1, uv0).x, texture(u_t3_s3, uv0).x, (view.fragCoord.y - view.rectMin.y) * view.invSize.y)", true),
  "plain.glsl": surface("vec3(texture(u_t3_s1, uv0).x, texture(u_t3_s3, uv0).x, 0.0)", false),
};
const pixel = new Uint8Array([200, 100, 50, 255]);
const mips = [{ width: 1, height: 1, offset: 0, bytes: 4 }];
// One authored file, two bindings: the View clamp sampler (s1) and the material wrap sampler (s3).
const TEXTURES = [
  { slot: "t3_s1", id: "base@TA_Clamp", file: "base.bin", array: false, depth: 1, srgb: true, wrapS: "TA_Clamp",
    wrapT: "TA_Clamp", mips, sha256: sha(pixel), textureSlot: "t3", sampler: "s1" },
  { slot: "t3_s3", id: "base", file: "base.bin", array: false, depth: 1, srgb: true, wrapS: "TA_Wrap",
    wrapT: "TA_Wrap", mips, sha256: sha(pixel), textureSlot: "t3", sampler: "s3" },
];
const hologram = {
  formatVersion: 1, itemId: "hologram-test", shader: "view.glsl", shaderSha256: sha(SHADERS["view.glsl"]),
  textures: TEXTURES, requiredUvSets: [0], hologramSurface: true, surfaceKind: "hologram", recoveredEmissive: true,
  blendMode: "BLEND_Additive", shadingModel: "MSM_Unlit", twoSided: true,
  requiredViewFields: ["fragCoord", "invSize", "rectMin"],
  hologramProgram: { textSha256: PROGRAM, qualityLevel: "High" },
  timePolicy: { gameTime: 0, register: "cb0[163].z" }, fogPolicy: { fog: "none" },
};
const plain = { ...hologram, itemId: "hologram-plain", shader: "plain.glsl", shaderSha256: sha(SHADERS["plain.glsl"]),
  requiredViewFields: [] };

type TestContext = { mock: { method: (object: object, name: string, implementation: unknown) => unknown } };
function serve(t: TestContext, manifests: Record<string, unknown>) {
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const name = String(input).slice(BASE.length);
    if (name in manifests) return new Response(JSON.stringify(manifests[name]));
    if (name in SHADERS) return new Response(SHADERS[name]);
    if (name === "base.bin") return new Response(new Uint8Array(gzipSync(pixel)));
    return new Response("", { status: 404 });
  });
}

function quad(material: THREE.Material | THREE.Material[] = new THREE.MeshStandardMaterial()) {
  return new THREE.Mesh(new THREE.PlaneGeometry(), material);
}

async function compiled(name: string, view: "lit" | "baseColor" = "lit") {
  const loaded = await loadReconstructedMaterial(BASE + name, view);
  const mesh = quad();
  loaded.apply(mesh);
  const material = mesh.material as THREE.MeshBasicMaterial;
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
  return { loaded, mesh, material, shader };
}

const without = (value: Record<string, unknown>, key: string) => {
  const copy = { ...value };
  delete copy[key];
  return copy;
};

test("a hologram manifest becomes an additive unlit single-pass material that casts no shadow", async t => {
  serve(t, { "h.json": hologram });
  const { mesh, material } = await compiled("h.json");
  assert.ok((material as THREE.Material as { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial);
  assert.equal(material.transparent, true);
  assert.equal(material.blending, THREE.CustomBlending);
  assert.deepEqual([material.blendEquation, material.blendSrc, material.blendDst],
    [THREE.AddEquation, THREE.OneFactor, THREE.OneFactor]);
  assert.deepEqual([material.blendEquationAlpha, material.blendSrcAlpha, material.blendDstAlpha],
    [THREE.AddEquation, THREE.ZeroFactor, THREE.OneFactor]);
  assert.equal(material.depthWrite, false);
  assert.equal(material.depthTest, true);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.forceSinglePass, true);
  assert.equal(material.fog, false);
  assert.equal(material.toneMapped, true);
  assert.equal(material.alphaHash, false);
  assert.equal(material.userData.recoveredAdditive, true);
  assert.equal(material.userData.reconstructed, true);
  assert.equal(material.userData.surfaceKind, "hologram");
  assert.equal(material.userData.recoveredManifest, BASE + "h.json");
  assert.equal(mesh.castShadow, false);
  assert.equal(mesh.userData.recoveredAdditive, true);
  for (const shadow of [mesh.customDepthMaterial!, mesh.customDistanceMaterial!]) {
    assert.equal(shadow.colorWrite, false);
    assert.equal(shadow.depthWrite, false);
  }
  // The split slots stay two resources with their own sampler state, from one fetched file.
  const clamp = material.userData["base@TA_Clamp"] as THREE.Texture, wrap = material.userData.base as THREE.Texture;
  assert.ok(clamp.isTexture && wrap.isTexture && clamp !== wrap);
  assert.deepEqual([clamp.wrapS, clamp.wrapT, wrap.wrapS, wrap.wrapT],
    [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.RepeatWrapping, THREE.RepeatWrapping]);
  assert.equal(clamp.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.userData.recoveredSamplers.samplers, 2);
});

test("the hologram GLSL fills the view struct from the viewport uniforms and outputs the emission only", async t => {
  serve(t, { "h.json": hologram, "plain.json": plain });
  const { shader, material } = await compiled("h.json");
  const f = shader.fragmentShader;
  for (const line of [
    "uniform vec4 uRecoveredViewRect;", "uniform float uRecoveredTargetHeight;",
    "recoveredView.fragCoord = vec2(gl_FragCoord.x, uRecoveredTargetHeight - gl_FragCoord.y);",
    "recoveredView.rectMin = uRecoveredViewRect.xy;", "recoveredView.invSize = uRecoveredViewRect.zw;",
    "ReconstructedSurface recovered = recoveredSurface(vRecoveredUv0, vRecoveredUv1, recoveredView);",
    "outgoingLight = recovered.emissive;\ndiffuseColor.a = 1.0;\n#include <opaque_fragment>",
  ]) assert.ok(f.includes(line), line);
  // The struct is the shader text's own; the runtime adds no second declaration.
  assert.equal(f.split("struct ReconstructedView").length, 2);
  assert.ok(!f.includes("#include <map_fragment>"));
  assert.ok(shader.vertexShader.includes("vRecoveredUv0 = uv;") && shader.vertexShader.includes("vRecoveredUv1 = vec2(0.0);"));
  assert.deepEqual(Object.keys(shader.uniforms).sort(), ["uRecoveredTargetHeight", "uRecoveredViewRect", "u_t3_s1", "u_t3_s3"]);
  assert.equal(shader.uniforms.u_t3_s1.value, material.userData["base@TA_Clamp"]);
  assert.equal(shader.uniforms.u_t3_s3.value, material.userData.base);
  assert.match(material.customProgramCacheKey(), /^recovered-hologram-v1:/);

  // No view inputs: no struct fill and no view argument.
  const other = await compiled("plain.json");
  assert.ok(other.shader.fragmentShader.includes("recoveredSurface(vRecoveredUv0, vRecoveredUv1);"));
  assert.ok(!other.shader.fragmentShader.includes("recoveredView"));
  // A surface debug view keeps the emission but skips tone mapping, as every recovered material does.
  assert.equal((await compiled("h.json", "baseColor")).material.toneMapped, false);
});

test("the view rectangle follows the bound target, its viewport and the drawing buffer", async t => {
  serve(t, { "h.json": hologram });
  const { material, shader } = await compiled("h.json");
  const rect = shader.uniforms.uRecoveredViewRect.value as THREE.Vector4, height = shader.uniforms.uRecoveredTargetHeight;
  const renderer = (viewport: number[], target: { height: number } | null, mip = 0, drawingBufferHeight = 0) => ({
    getCurrentViewport: (v: THREE.Vector4) => v.fromArray(viewport),
    getRenderTarget: () => target, getActiveMipmapLevel: () => mip,
    getContext: () => ({ drawingBufferHeight }),
  }) as unknown as THREE.WebGLRenderer;
  const draw = (r: THREE.WebGLRenderer) => material.onBeforeRender(r, new THREE.Scene(), new THREE.Camera(),
    new THREE.BufferGeometry(), new THREE.Object3D() as THREE.Mesh, null as unknown as THREE.Group);
  // An offset viewport in a 48-pixel-high target: rectMin.y counts from the top, as SV_Position does.
  draw(renderer([8, 4, 32, 16], { height: 48 }));
  assert.deepEqual(rect.toArray(), [8, 48 - 4 - 16, 1 / 32, 1 / 16]);
  assert.equal(height.value, 48);
  draw(renderer([0, 0, 640, 360], null, 0, 360));
  assert.deepEqual(rect.toArray(), [0, 0, 1 / 640, 1 / 360]);
  assert.equal(height.value, 360);
  draw(renderer([0, 0, 16, 8], { height: 32 }, 2));
  assert.equal(height.value, 8);
});

test("hologram manifests that leave the signed-off contract fail closed", async t => {
  const invalid: Record<string, unknown> = {
    "no-selector.json": without(hologram, "hologramSurface"),
    "no-kind.json": without(hologram, "surfaceKind"),
    "kind-glass.json": { ...hologram, surfaceKind: "glass" },
    "selector-false.json": { ...hologram, hologramSurface: false },
    "translucent.json": { ...hologram, blendMode: "BLEND_Translucent" },
    "lit.json": { ...hologram, shadingModel: "MSM_DefaultLit" },
    "one-sided.json": { ...hologram, twoSided: false },
    "no-emission.json": without(hologram, "recoveredEmissive"),
    "unknown-view.json": { ...hologram, requiredViewFields: ["fragCoord", "worldPosition"] },
    "duplicate-view.json": { ...hologram, requiredViewFields: ["fragCoord", "fragCoord"] },
    "no-view-list.json": without(hologram, "requiredViewFields"),
    "other-program.json": { ...hologram, hologramProgram: { textSha256: "0".repeat(64) } },
    "no-program.json": without(hologram, "hologramProgram"),
    "animated.json": { ...hologram, timePolicy: { gameTime: 0.5 } },
    "no-time.json": without(hologram, "timePolicy"),
    "fogged.json": { ...hologram, fogPolicy: { fog: "height" } },
    "view-without-hologram.json": { ...without(without(hologram, "hologramSurface"), "surfaceKind") },
    "struct-missing.json": { ...plain, requiredViewFields: ["fragCoord"] },
    "struct-unlisted.json": { ...hologram, requiredViewFields: [] },
  };
  for (const field of ["geometryDependentNormals", "viewDependentCloth", "twoSidedSign", "glassSurface", "worldSurface",
    "skinSurface", "skinCoverage", "maskedClip", "parametricOpacity", "geometryFrame", "requiredGeometryFields",
    "normalSpace", "coverageShader", "coverageShaderSha256", "coverageGeometryFields", "requiresVertexColor"])
    invalid[`field-${field}.json`] = { ...hologram, [field]: field === "requiredGeometryFields" ? [] : field === "normalSpace" ? "tangent" : true };
  serve(t, invalid);
  for (const name of Object.keys(invalid))
    await assert.rejects(loadReconstructedMaterial(BASE + name), /Unsupported recovered hologram contract/, name);
  // A view field on an ordinary manifest is refused as well (view inputs exist only on the hologram route).
  const ordinary = without(without(without(hologram, "hologramSurface"), "surfaceKind"), "requiredViewFields");
  serve(t, { "ordinary-view.json": { ...ordinary, blendMode: "BLEND_Opaque", requiredViewFields: ["fragCoord"] } });
  await assert.rejects(loadReconstructedMaterial(BASE + "ordinary-view.json"), /hologram contract: route selector/);
});

test("a hologram on a multi-section mesh or another section is refused", async t => {
  serve(t, { "h.json": hologram });
  const loaded = await loadReconstructedMaterial(BASE + "h.json");
  assert.throws(() => loaded.apply(quad([new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()])),
    /single-section mesh/);
  assert.throws(() => loaded.apply(quad(), 1), /single-section mesh/);
  const single = quad([new THREE.MeshStandardMaterial()]);
  loaded.apply(single, 0);
  assert.ok(Array.isArray(single.material) && single.material[0].userData.recoveredAdditive);
});

test("split sampler slots: register_sampler names, register-number order and packed rewrites", () => {
  const spec = (slot: string, id: string, wrap = "TA_Wrap") => ({ slot, id, file: `${id}.bin`, array: false, depth: 1,
    srgb: false, wrapS: wrap, wrapT: wrap, sha256: id, mips: [{ width: 2, height: 2, offset: 0, bytes: 16 }] });
  for (const slot of ["t3_", "t3_x1", "s1", "t3_s", "t_s1", "T3_s1", "t3_s1_s2"])
    assert.throws(() => planReconstructedSamplers([spec(slot, "a")]), /Invalid recovered texture slot/, slot);
  const plan = planReconstructedSamplers([spec("t3_s1", "a@TA_Clamp", "TA_Clamp"), spec("t3_s3", "a"), spec("t4", "b")]);
  assert.equal(plan.counts.samplers, 3);
  assert.deepEqual(samplerUniformBindings(plan).map(b => b.name), ["u_t3_s1", "u_t3_s3", "u_t4"]);
  // Equal-size pack candidates are taken in register-number order: t3_s* (3) before t10 (10), whatever the manifest
  // order. Number("3_s1") would be NaN and leave the t10 bucket first.
  const order = planReconstructedSamplers([spec("t10", "c"), spec("t11", "d"), spec("t3_s1", "a@TA_Clamp", "TA_Clamp"),
    spec("t3_s2", "e", "TA_Clamp")], { target: 3 });
  assert.deepEqual(order.bindings.filter(b => b.kind === "layer").map(b => b.slot), ["t3_s1", "t3_s2"]);
  // Forced packing (target 1): compatible split slots become array layers, and every sample call is retargeted.
  const packed = planReconstructedSamplers([spec("t3_s3", "a"), spec("t10", "c"), spec("t3_s4", "b")], { target: 1 });
  assert.equal(packed.counts.packs, 1);
  assert.deepEqual(packed.bindings.map(b => [b.slot, b.layer]), [["t3_s3", 0], ["t10", 1], ["t3_s4", 2]]);
  const glsl = rewriteSamplerGlsl([
    "uniform highp sampler2D u_t3_s3;", "uniform highp sampler2D u_t10;", "uniform highp sampler2D u_t3_s4;",
    "vec4 a = texture(u_t3_s3, uv0); vec4 b = texture(u_t3_s4, uv0, 0.0); vec4 c = texture(u_t10, uv0);"].join("\n"), packed);
  assert.ok(!/u_t3_s3|u_t3_s4|u_t10/.test(glsl));
  assert.ok(glsl.includes("texture(u_recoveredPack0, vec3((uv0), 0.0))"));
  assert.ok(glsl.includes("texture(u_recoveredPack0, vec3((uv0), 2.0), 0.0)"));
});

test("only a visible additive material reports additive to the stable-frame accumulator", () => {
  const renderer = { toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1, outputColorSpace: THREE.SRGBColorSpace,
    shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap }, getClearColor: (c: THREE.Color) => c.set(0),
    getClearAlpha: () => 0 } as unknown as THREE.WebGLRenderer;
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const additive = new THREE.MeshBasicMaterial();
  additive.userData.recoveredAdditive = true;
  const holo = quad(additive), opaque = quad();
  group.add(holo);
  scene.add(group, opaque);
  const state = new StableFrameState();
  assert.deepEqual(state.capture(scene, camera, renderer), { changed: "camera", masked: false, additive: true });
  assert.deepEqual(state.capture(scene, camera, renderer), { changed: "", masked: false, additive: true });
  additive.visible = false;
  assert.equal(state.capture(scene, camera, renderer).additive, false);
  additive.visible = true; holo.visible = false;
  assert.equal(state.capture(scene, camera, renderer).additive, false);
  holo.visible = true; group.visible = false;
  assert.equal(state.capture(scene, camera, renderer).additive, false);
  group.visible = true; holo.layers.set(3);
  assert.equal(state.capture(scene, camera, renderer).additive, false);
  // A scene without additive materials records exactly what it did before: stable on the second capture.
  scene.remove(group);
  state.capture(scene, camera, renderer);
  assert.deepEqual(state.capture(scene, camera, renderer), { changed: "", masked: false, additive: false });
});

// The accumulator's output fragment as the code before the hologram runtime built it.
const OUTPUT_BEFORE = OutputShader.fragmentShader
  .replace("uniform sampler2D tDiffuse;", "uniform sampler2D tDiffuse; uniform float historyScale;")
  .replace("gl_FragColor = texture2D( tDiffuse, vUv );", `
        gl_FragColor = texture2D(tDiffuse, vUv) * historyScale;
        gl_FragColor.a = clamp(gl_FragColor.a, 0.0, 1.0);
        gl_FragColor.rgb = gl_FragColor.a > 0.000001 ? gl_FragColor.rgb / gl_FragColor.a : vec3(0.0);`)
  .replace(/}\s*$/, "#ifdef PREMULTIPLIED_OUTPUT\n gl_FragColor.rgb *= gl_FragColor.a;\n #endif\n }");

// Resolve only the ADDITIVE_PASS_THROUGH conditionals, leaving every other directive in place.
function resolvePassThrough(source: string, defined: boolean) {
  const out: string[] = [], stack: boolean[] = [];
  let depth = 0; // nesting of other #if blocks inside a pass-through block
  for (const line of source.split("\n")) {
    const directive = line.trim();
    if (directive === "#ifdef ADDITIVE_PASS_THROUGH") { stack.push(defined); continue; }
    if (stack.length && depth === 0 && directive === "#else") { stack[stack.length - 1] = !stack[stack.length - 1]; continue; }
    if (stack.length && depth === 0 && directive === "#endif") { stack.pop(); continue; }
    if (stack.length && /^#if/.test(directive)) depth++;
    else if (stack.length && depth && directive === "#endif") depth--;
    if (stack.every(Boolean)) out.push(line);
  }
  return out.join("\n");
}
const tokens = (glsl: string) => glsl.split(/\s+/).filter(Boolean);

test("without the pass-through define the accumulator output program is token-identical to before", () => {
  const accumulator = new StableFrameAccumulator();
  const output = (accumulator as unknown as { output: THREE.RawShaderMaterial }).output;
  const now = output.fragmentShader;
  assert.deepEqual(tokens(resolvePassThrough(now, false)), tokens(OUTPUT_BEFORE));
  const pass = resolvePassThrough(now, true);
  assert.ok(pass.includes("bool additivePassThrough = gl_FragColor.a <= 0.000001;"));
  assert.ok(pass.includes("gl_FragColor.rgb = additivePassThrough ? gl_FragColor.rgb : gl_FragColor.rgb / gl_FragColor.a;"));
  assert.match(pass, /if \(!additivePassThrough\)\s+gl_FragColor\.rgb \*= gl_FragColor\.a;/);
  assert.equal(accumulator.status.additive, false);
  accumulator.dispose();
});
