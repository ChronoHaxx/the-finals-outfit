// Runtime checks of the M_FloatingHologram preview contract (src/rig/ReconstructedMaterial.ts hologram route,
// src/rig/StableFrameState.ts, src/rig/StableFrameAccumulator.ts, src/rig/OutfitExport.ts), in the real app page
// through the real loader, on a separate WebGL2 context. Design: the main repo's
// _docs/goal-100-2026-10-11/floatinghologram-contract/design-study.md section 6 "Runtime".
//
// check-webgl feeds fixture view inputs straight into the emitted function, so it never exercises the loader's view
// plumbing, blend state, single-pass DoubleSide draw, render-target tone mapping or the accumulator. Synthetic
// manifests (hash-consistent, served to this browser only by request interception; nothing is written to the app)
// cover those; the 7 real probe manifests are then compiled, rendered and compared with their own emitted GLSL.
//   viewUv       the program's viewport UV ((fragCoord - rectMin) * invSize) with an offset viewport in a render
//                target: exact, rows counted from the top (the y-flip). Negative control: GL bottom-up conventions.
//                Also the raw fields, and the drawing-buffer path (canvas) within one 8-bit step.
//   blend        B + E over a pre-filled HDR target, alpha unchanged; E with alpha 0 over a cleared one.
//   folded       a front quad and a coincident back quad give exactly 2E in one draw call; FrontSide gives E; the
//                two-pass control (forceSinglePass off) also gives 2E but in two draws, so the call count decides.
//   toneMapping  E reaches the HDR target unchanged under ACES, exposure 1.7 and an sRGB output; the canvas does not.
//   samplerSplit t3_s1 (clamp) and t3_s3 (wrap) from one file, sampled outside [0, 1]: each matches its own address
//                mode. Negative control: the clamp expectation applied to the wrap binding.
//   accumulator  activation only for a visible additive material; B + E over geometry and E over the empty backdrop
//                (alpha 0 pass-through) at the output; a masked-only scene keeps the old output (no define, 0).
//   shadow       a hologram forced to castShadow leaves the receiver exactly as with no blocker; an opaque one darkens.
//   export       the developer .glb export leaves the hologram out with a warning and still bakes other meshes.
//   probes       every real manifest compiles and renders finite, constant values through an offset viewport (nothing
//                outside it) with constant textures. Its own emitted GLSL, evaluated on the CPU in float32 per
//                statement with the sample values the GPU returns for each binding (same quad, viewport and sampler
//                objects), must match within 2e-5 relative; swapping the two t3 bindings must not. Those sample
//                values must be within 2^-8 of the exact sRGB decode of the bytes (texture-unit precision, reported).
// Usage (dev server running; MSYS_NO_PATHCONV=1 in Git Bash):
//   node scripts/shader-probe/check-hologram-runtime.mjs <reportPath> [probeFolderUrl]
import { chromium } from "playwright-core";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import path from "node:path";

const [reportPath, probeUrl = "/models/hologram-probe-v1"] = process.argv.slice(2);
if (!reportPath) throw new Error("Usage: check-hologram-runtime.mjs <reportPath> [probeFolderUrl]");
if (existsSync(reportPath)) throw new Error(`Report exists: ${reportPath}`);
const REPO = process.env.MAIN_REPO ?? "E:/Coding/the-finals-outfit";
const APP = (process.env.APP_URL ?? "http://127.0.0.1:5174").replace(/\/$/, "");
const PROBE_DIR = path.join(REPO, "public", probeUrl.replace(/^\//, ""));
const sha = (data) => createHash("sha256").update(data).digest("hex");

// ---- synthetic manifests -------------------------------------------------------------------------------------------
const PROGRAM = "538e2b69d7363ccdf0fcd21735877c3699ecc5051b1e3e5a923f3c5b5a6a3d57";
const VIEW_STRUCT = "struct ReconstructedView { vec2 fragCoord; vec2 rectMin; vec2 invSize; };";
const surface = (samplers, body) => [...samplers.map((s) => `uniform highp sampler2D ${s};`), VIEW_STRUCT,
  "ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedView view) {", "  ReconstructedSurface surface;",
  `  surface.emissive = ${body};`, "  return surface;", "}", ""].join("\n");
const E = [0.5, 1.25, 3.0]; // exact in half and single precision
const shaders = {
  "view-uv.glsl": surface([], "vec3((view.fragCoord - view.rectMin) * view.invSize, 0.0)"),
  "view-a.glsl": surface([], "vec3(view.fragCoord, view.rectMin.y)"),
  "view-b.glsl": surface([], "vec3(view.rectMin.x, view.invSize)"),
  "constant.glsl": surface([], `vec3(${E.map((v) => v.toFixed(2)).join(", ")})`),
  "split.glsl": surface(["u_t3_s1", "u_t3_s3"], "vec3(texture(u_t3_s1, uv0).x, texture(u_t3_s3, uv0).x, 0.0)"),
};
// A 2 x 2 linear texture (red channel per texel, row 0 first = v in [0, 0.5)); one file, two bindings.
const SPLIT_TEXELS = [10, 80, 160, 240];
const splitBytes = new Uint8Array(SPLIT_TEXELS.flatMap((r) => [r, 0, 0, 255]));
const splitSpec = (slot, id, wrap, sampler) => ({ slot, id, file: "split.bin", array: false, depth: 1, srgb: false,
  wrapS: wrap, wrapT: wrap, sha256: sha(splitBytes), mips: [{ width: 2, height: 2, offset: 0, bytes: 16 }],
  textureSlot: "t3", sampler });
const manifest = (name, textures = []) => ({
  formatVersion: 1, itemId: `hologram-check-${name}`, shader: `${name}.glsl`, shaderSha256: sha(shaders[`${name}.glsl`]),
  textures, requiredUvSets: [0], hologramSurface: true, surfaceKind: "hologram", recoveredEmissive: true,
  blendMode: "BLEND_Additive", shadingModel: "MSM_Unlit", twoSided: true, requiredViewFields: ["fragCoord", "invSize", "rectMin"],
  hologramProgram: { textSha256: PROGRAM, qualityLevel: "High" }, timePolicy: { gameTime: 0 }, fogPolicy: { fog: "none" },
});
const files = {
  ...Object.fromEntries(Object.entries(shaders).map(([k, v]) => [k, { body: v, type: "text/plain" }])),
  "split.bin": { body: gzipSync(splitBytes), type: "application/octet-stream" },
  ...Object.fromEntries(["view-uv", "view-a", "view-b", "constant"].map((n) => [`${n}.json`, { body: JSON.stringify(manifest(n)), type: "application/json" }])),
  "split.json": { body: JSON.stringify(manifest("split", [splitSpec("t3_s1", "split@TA_Clamp", "TA_Clamp", "s1"),
    splitSpec("t3_s3", "split", "TA_Wrap", "s3")])), type: "application/json" },
};

// ---- real probe manifests ------------------------------------------------------------------------------------------
const probes = readdirSync(PROBE_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("build-")).sort();
const PROBE_BYTES = { t3_s1: [200, 150, 90, 255], t3_s3: [120, 60, 230, 255], t4: [170, 170, 170, 255] };

const browser = await chromium.launch({ channel: "msedge", headless: true });
let result;
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
  await page.route((url) => new URL(url).pathname.startsWith("/__hologram-check/"), (route) => {
    const name = new URL(route.request().url()).pathname.slice("/__hologram-check/".length);
    const file = files[name];
    return file ? route.fulfill({ status: 200, contentType: file.type, body: file.body }) : route.fulfill({ status: 404, body: "" });
  });
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__THREE, undefined, { timeout: 60000 });
  result = await page.evaluate(runChecks, { E, SPLIT_TEXELS, probes: probes.map((f) => `${probeUrl}/${f}`), PROBE_BYTES });
} finally { await browser.close(); }

// Everything below runs in the page.
async function runChecks({ E, SPLIT_TEXELS, probes, PROBE_BYTES }) {
  const THREE = window.__THREE;
  const { loadReconstructedMaterial } = await import("/src/rig/ReconstructedMaterial.ts");
  const { StableFrameAccumulator } = await import("/src/rig/StableFrameAccumulator.ts");
  const { exportOutfit } = await import("/src/rig/OutfitExport.ts");
  const out = {};
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(64, 48, false);
  out.floatBlend = renderer.extensions.has("EXT_float_blend");
  const blendType = out.floatBlend ? THREE.FloatType : THREE.HalfFloatType;
  const url = (name) => `/__hologram-check/${name}`;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 2); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const scratch = new THREE.MeshStandardMaterial();
  async function hologram(name, geometry = new THREE.PlaneGeometry(2, 2)) {
    const loader = await loadReconstructedMaterial(name.startsWith("/") ? name : url(name));
    const mesh = new THREE.Mesh(geometry, scratch.clone());
    loader.apply(mesh);
    return { loader, mesh, material: mesh.material };
  }
  // Exact readback: half-float targets are copied into a float target first (texelFetch, no blending).
  const copyMaterial = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { src: { value: null } },
    vertexShader: "in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "precision highp float; uniform highp sampler2D src; out vec4 color; void main() { color = texelFetch(src, ivec2(gl_FragCoord.xy), 0); }",
    depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const copyScene = new THREE.Scene();
  const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial); copyQuad.frustumCulled = false; copyScene.add(copyQuad);
  function read(target) {
    const { width: w, height: h } = target;
    let readable = target;
    if (target.texture.type !== THREE.FloatType) {
      readable = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: false });
      copyMaterial.uniforms.src.value = target.texture;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(readable); renderer.render(copyScene, camera); renderer.setRenderTarget(previous);
    }
    const pixels = new Float32Array(w * h * 4);
    renderer.readRenderTargetPixels(readable, 0, 0, w, h, pixels);
    if (readable !== target) readable.dispose();
    return pixels;
  }
  const px = (pixels, w, x, y) => Array.from(pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
  function draw(target, scene, { clear = [0, 0, 0, 0], viewport } = {}) {
    renderer.setRenderTarget(target);
    renderer.setClearColor(new THREE.Color().setRGB(clear[0], clear[1], clear[2]), clear[3]);
    target.viewport.set(0, 0, target.width, target.height);
    renderer.setRenderTarget(target); renderer.clear();
    if (viewport) { target.viewport.set(...viewport); renderer.setRenderTarget(target); }
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
  }
  const sceneOf = (...objects) => { const s = new THREE.Scene(); s.add(...objects); return s; };
  renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // viewUv: offset viewport in a 64 x 48 target; inside every pixel exact, outside untouched.
  {
    const W = 64, H = 48, V = [8, 4, 32, 16];
    const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
    const rows = {};
    for (const name of ["view-uv", "view-a", "view-b"]) {
      const { mesh } = await hologram(`${name}.json`);
      draw(target, sceneOf(mesh), { viewport: V });
      rows[name] = read(target);
    }
    // Negative control: the same program with GL's bottom-up conventions (fragCoord.y = gl_FragCoord.y, rectMin.y = vy).
    const control = await hologram("view-uv.json");
    const compile = control.material.onBeforeCompile;
    control.material.onBeforeCompile = (shader, r) => {
      compile(shader, r);
      shader.fragmentShader = shader.fragmentShader
        .replace("vec2(gl_FragCoord.x, uRecoveredTargetHeight - gl_FragCoord.y)", "gl_FragCoord.xy")
        .replace("recoveredView.rectMin = uRecoveredViewRect.xy;", "recoveredView.rectMin = vec2(uRecoveredViewRect.x, uRecoveredTargetHeight - uRecoveredViewRect.y - 1.0 / uRecoveredViewRect.w);");
    };
    control.material.customProgramCacheKey = () => "hologram-check-gl-convention";
    draw(target, sceneOf(control.mesh), { viewport: V });
    const gl = read(target);
    let maxError = 0, maxFieldError = 0, outsideNonZero = 0, controlMax = 0, inside = 0;
    const samples = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const isInside = i >= V[0] && i < V[0] + V[2] && j >= V[1] && j < V[1] + V[3];
      const uv = px(rows["view-uv"], W, i, j), a = px(rows["view-a"], W, i, j), b = px(rows["view-b"], W, i, j);
      if (!isInside) { if ([...uv, ...a, ...b].some((v) => v !== 0)) outsideNonZero++; continue; }
      inside++;
      const fragCoord = [i + 0.5, H - (j + 0.5)], rectMin = [V[0], H - V[1] - V[3]], invSize = [1 / V[2], 1 / V[3]];
      const expected = [(fragCoord[0] - rectMin[0]) * invSize[0], (fragCoord[1] - rectMin[1]) * invSize[1]];
      maxError = Math.max(maxError, Math.abs(uv[0] - expected[0]), Math.abs(uv[1] - expected[1]), Math.abs(uv[2]));
      maxFieldError = Math.max(maxFieldError, Math.abs(a[0] - fragCoord[0]), Math.abs(a[1] - fragCoord[1]), Math.abs(a[2] - rectMin[1]),
        Math.abs(b[0] - rectMin[0]), Math.abs(b[1] - Math.fround(invSize[0])), Math.abs(b[2] - Math.fround(invSize[1])));
      const c = px(gl, W, i, j);
      controlMax = Math.max(controlMax, Math.abs(c[1] - expected[1]));
      if (i === V[0] && (j === V[1] || j === V[1] + V[3] - 1)) samples.push({ glPixel: [i, j], uv: uv.slice(0, 2), expected });
    }
    // Drawing-buffer path: the canvas, an offset viewport, 8-bit readback.
    renderer.setRenderTarget(null);
    renderer.setSize(64, 48, false);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.setViewport(V[0], V[1], V[2], V[3]);
    const { mesh } = await hologram("view-uv.json");
    renderer.render(sceneOf(mesh), camera);
    renderer.setViewport(0, 0, 64, 48);
    const ctx = renderer.getContext(), bytes = new Uint8Array(64 * 48 * 4);
    ctx.readPixels(0, 0, 64, 48, ctx.RGBA, ctx.UNSIGNED_BYTE, bytes);
    let canvasMax = 0;
    for (let j = V[1]; j < V[1] + V[3]; j++) for (let i = V[0]; i < V[0] + V[2]; i++) {
      const ev = (ctx.drawingBufferHeight - (j + 0.5) - (ctx.drawingBufferHeight - V[1] - V[3])) / V[3];
      const eu = (i + 0.5 - V[0]) / V[2];
      const k = (j * 64 + i) * 4;
      canvasMax = Math.max(canvasMax, Math.abs(bytes[k] / 255 - eu), Math.abs(bytes[k + 1] / 255 - ev));
    }
    out.viewUv = { target: [W, H], viewport: V, insidePixels: inside, maxError, maxFieldError, outsideNonZero,
      glConventionControlMaxError: controlMax, samples, canvasMaxError: canvasMax,
      pass: inside === V[2] * V[3] && maxError === 0 && maxFieldError === 0 && outsideNonZero === 0 && controlMax > 0.5
        && canvasMax <= 0.6 / 255 };
    target.dispose();
  }

  // blend: B + E over a pre-filled target (three premultiplies the clear colour; B is read back, not assumed).
  {
    const target = new THREE.WebGLRenderTarget(8, 8, { type: blendType });
    const { mesh, material } = await hologram("constant.json");
    const empty = new THREE.Scene();
    draw(target, empty, { clear: [0.25, 0.5, 2.0, 0.375] });
    const before = px(read(target), 8, 4, 4);
    draw(target, sceneOf(mesh), { clear: [0.25, 0.5, 2.0, 0.375] });
    const after = px(read(target), 8, 4, 4);
    draw(target, sceneOf(mesh), { clear: [0, 0, 0, 0] });
    const backdrop = px(read(target), 8, 4, 4);
    const rgbError = Math.max(...[0, 1, 2].map((c) => Math.abs(after[c] - (before[c] + E[c]))));
    out.blend = { targetType: blendType === THREE.FloatType ? "float32" : "float16", before, after, backdrop, rgbError,
      alphaUnchanged: after[3] === before[3], state: { transparent: material.transparent, blending: material.blending,
        src: material.blendSrc, dst: material.blendDst, srcAlpha: material.blendSrcAlpha, dstAlpha: material.blendDstAlpha,
        depthWrite: material.depthWrite, depthTest: material.depthTest, side: material.side, forceSinglePass: material.forceSinglePass },
      pass: rgbError === 0 && after[3] === before[3] && before[3] > 0 && backdrop[3] === 0
        && [0, 1, 2].every((c) => backdrop[c] === E[c]) };
    target.dispose();
  }

  // folded: a front-facing quad plus a coincident back-facing copy (reversed winding).
  {
    const target = new THREE.WebGLRenderTarget(8, 8, { type: blendType });
    const plane = new THREE.PlaneGeometry(2, 2);
    const index = Array.from(plane.index.array);
    const folded = plane.clone();
    folded.setIndex([...index, ...[...index].reverse()]);
    const run = async (configure) => {
      const { mesh, material } = await hologram("constant.json", folded.clone());
      configure?.(material);
      renderer.info.autoReset = true;
      draw(target, sceneOf(mesh));
      const calls = renderer.info.render.calls;
      return { value: px(read(target), 8, 4, 4), calls };
    };
    const single = await run();
    const front = await run((m) => { m.side = THREE.FrontSide; });
    const twoPass = await run((m) => { m.forceSinglePass = false; });
    const twice = E.map((v) => 2 * v);
    out.folded = { single, frontSide: front, twoPassControl: twoPass,
      pass: [0, 1, 2].every((c) => single.value[c] === twice[c]) && single.calls === 1
        && [0, 1, 2].every((c) => front.value[c] === E[c]) && twoPass.calls === 2 };
    target.dispose();
  }

  // toneMapping: the HDR target receives the linear emission whatever the renderer's display transform.
  {
    const target = new THREE.WebGLRenderTarget(8, 8, { type: blendType });
    const { mesh, material } = await hologram("constant.json");
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.7;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    draw(target, sceneOf(mesh));
    const value = px(read(target), 8, 4, 4);
    renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(sceneOf(mesh), camera);
    const ctx = renderer.getContext(), bytes = new Uint8Array(4);
    ctx.readPixels(32, 24, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, bytes);
    renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    out.toneMapping = { materialToneMapped: material.toneMapped, target: value, canvasBytes: Array.from(bytes),
      pass: material.toneMapped === true && [0, 1, 2].every((c) => value[c] === E[c])
        && Math.abs(bytes[0] / 255 - Math.min(E[0], 1)) > 0.01 };
    target.dispose();
  }

  // samplerSplit: uv0 spans [-0.5, 1.5] across a 40 x 40 target; nearest filtering isolates the address modes.
  {
    const N = 40;
    const geometry = new THREE.PlaneGeometry(2, 2);
    const uv = geometry.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 2 - 0.5, (1 - uv.getY(k)) * 2 - 0.5);
    const { mesh, material } = await hologram("split.json", geometry);
    const clamp = material.userData["split@TA_Clamp"], wrap = material.userData.split;
    for (const t of [clamp, wrap]) { t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.needsUpdate = true; }
    const target = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType });
    draw(target, sceneOf(mesh));
    const pixels = read(target);
    const texel = (u, v, mode) => {
      const index = (c) => mode === "clamp" ? Math.min(1, Math.max(0, Math.floor(Math.min(1, Math.max(0, c)) * 2)))
        : ((Math.floor(c * 2) % 2) + 2) % 2;
      return SPLIT_TEXELS[index(v) * 2 + index(u)] / 255;
    };
    let clampError = 0, wrapError = 0, controlDiffers = 0, outside = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      // Plane uv (0,0) is the bottom-left vertex; uv0 = (2x - 0.5, 2(1 - y) - 0.5), v grows downward on screen.
      const x = (i + 0.5) / N, y = (j + 0.5) / N;
      const u0 = 2 * x - 0.5, v0 = 2 * (1 - y) - 0.5;
      const value = px(pixels, N, i, j);
      if (u0 < 0 || u0 > 1 || v0 < 0 || v0 > 1) outside++;
      clampError = Math.max(clampError, Math.abs(value[0] - Math.fround(texel(u0, v0, "clamp"))));
      wrapError = Math.max(wrapError, Math.abs(value[1] - Math.fround(texel(u0, v0, "wrap"))));
      if (Math.abs(value[1] - Math.fround(texel(u0, v0, "clamp"))) > 1e-3) controlDiffers++;
    }
    out.samplerSplit = { resources: material.userData.recoveredSamplers, distinctTextures: clamp !== wrap,
      wraps: { t3_s1: [clamp.wrapS, clamp.wrapT], t3_s3: [wrap.wrapS, wrap.wrapT] }, pixelsOutsideUnitSquare: outside,
      clampError, wrapError, clampExpectationOnWrapBindingDiffers: controlDiffers,
      pass: clamp !== wrap && clamp.wrapS === THREE.ClampToEdgeWrapping && wrap.wrapS === THREE.RepeatWrapping
        && clampError < 1e-6 && wrapError < 1e-6 && controlDiffers > 0 && outside > 0 };
    target.dispose();
  }

  // accumulator: an opaque quad on the left half behind a full-screen hologram.
  {
    const W = 32, H = 16;
    const B = [0.25, 0.5, 0.75];
    const opaque = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...B) }));
    opaque.position.set(-0.5, 0, -0.5);
    const { mesh: holo, material: holoMaterial } = await hologram("constant.json");
    const masked = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff, alphaHash: true }));
    masked.material.userData.reconstructed = true; masked.position.set(0.9, 0.9, -0.9); // a masked recovered stand-in
    const dest = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
    // The accumulator restores renderer.getViewport() (the canvas viewport) for its output draw, also when the
    // destination is a render target; the app always presents to the canvas. Match the canvas to the float
    // destination so the output lands 1:1 and can be read back unclipped.
    renderer.setSize(W, H, false); renderer.setViewport(0, 0, W, H);
    const run = (scene) => {
      const accumulator = new StableFrameAccumulator(4);
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(dest);
      for (let k = 0; k < 6; k++) accumulator.render(renderer, scene, camera);
      renderer.setRenderTarget(null);
      const status = { ...accumulator.status }, defines = Object.keys(accumulator.output?.defines ?? {});
      const pixels = read(dest);
      accumulator.dispose();
      return { status, defines, left: px(pixels, W, 6, 8), right: px(pixels, W, 22, 8) };
    };
    const opaqueOnly = run(sceneOf(opaque.clone()));
    const withHologram = run(sceneOf(opaque.clone(), holo));
    holoMaterial.visible = false;
    const invisible = run(sceneOf(opaque.clone(), holo));
    holoMaterial.visible = true; holo.visible = false;
    const hidden = run(sceneOf(opaque.clone(), holo));
    holo.visible = true;
    const maskedOnly = run(sceneOf(opaque.clone(), masked));
    const both = run(sceneOf(opaque.clone(), masked.clone(), holo));
    const eq = (a, b) => [0, 1, 2].every((c) => a[c] === b[c]);
    out.accumulator = { opaqueOnly, withHologram, invisible, hidden, maskedOnly, both,
      pass: !opaqueOnly.status.active && !invisible.status.active && !hidden.status.active
        && withHologram.status.active && withHologram.status.additive && withHologram.defines.includes("ADDITIVE_PASS_THROUGH")
        && eq(withHologram.left, B.map((b, c) => b + E[c])) && withHologram.left[3] === 1
        && eq(withHologram.right, E) && withHologram.right[3] === 0
        && maskedOnly.status.active && !maskedOnly.status.additive && !maskedOnly.defines.includes("ADDITIVE_PASS_THROUGH")
        && eq(maskedOnly.right, [0, 0, 0]) && maskedOnly.right[3] === 0 && eq(maskedOnly.left, B)
        && both.status.active && both.defines.includes("ADDITIVE_PASS_THROUGH") && eq(both.right, E) };
    dest.dispose();
    renderer.setSize(64, 48, false); renderer.setViewport(0, 0, 64, 48);
  }

  // shadow: the blocker sits off screen (behind the camera) and shadows the viewed receiver.
  {
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(3, 3, 0); light.target.position.set(0, 0, 0); light.castShadow = true;
    Object.assign(light.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 12 });
    light.shadow.mapSize.set(256, 256); light.shadow.bias = -0.001;
    const receiver = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    receiver.rotation.x = -Math.PI / 2; receiver.receiveShadow = true;
    const view = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.05, 1);
    view.position.set(0, 0.6, 0); view.up.set(0, 0, -1); view.lookAt(0, 0, 0); view.updateMatrixWorld();
    const target = new THREE.WebGLRenderTarget(16, 16, { type: THREE.FloatType });
    const shoot = (blocker) => {
      const scene = new THREE.Scene(); scene.add(light, light.target, receiver);
      if (blocker) { blocker.position.set(1, 1, 0); blocker.lookAt(4, 4, 0); blocker.castShadow = true; scene.add(blocker); }
      renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, view);
      renderer.setRenderTarget(null);
      return px(read(target), 16, 8, 8);
    };
    const none = shoot(null);
    const opaqueBlocker = shoot(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
    const { mesh } = await hologram("constant.json", new THREE.PlaneGeometry(1, 1));
    const castAfterApply = mesh.castShadow;
    const hologramBlocker = shoot(mesh); // castShadow forced on, as CharacterRig.enableShadows does after equipping
    renderer.shadowMap.enabled = false;
    out.shadow = { none, opaqueBlocker, hologramBlocker, castShadowAfterApply: castAfterApply,
      pass: castAfterApply === false && opaqueBlocker[0] < none[0] * 0.5 && [0, 1, 2, 3].every((c) => hologramBlocker[c] === none[c]) };
    target.dispose();
  }

  // export: a plain mesh and a hologram mesh through the developer .glb export.
  {
    const root = new THREE.Group();
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x808080 }));
    plain.name = "plain-quad";
    const { mesh } = await hologram("constant.json", new THREE.PlaneGeometry(1, 1));
    mesh.name = "hologram-quad";
    root.add(plain, mesh);
    const exported = await exportOutfit(root, renderer, camera, { textureSize: 16, pose: "preview" });
    const view = new DataView(exported.glb);
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(exported.glb, 20, jsonLength)));
    const names = (json.nodes ?? []).map((n) => n.name);
    out.export = { warnings: exported.warnings, bakedSections: exported.bakedSections, keptSections: exported.keptSections,
      nodes: names, meshes: (json.meshes ?? []).length,
      pass: exported.warnings.some((w) => w.startsWith("hologram-quad[0]: additive hologram left out")) && names.includes("plain-quad")
        && !names.includes("hologram-quad") && exported.bakedSections === 1 && (json.meshes ?? []).length === 1 };
  }

  // probes: the real manifests with constant textures, through an offset viewport.
  {
    const W = 96, H = 64, V = [16, 8, 48, 32];
    out.probes = [];
    for (const manifestUrl of probes) {
      const row = { manifestUrl };
      try {
        const manifest = await (await fetch(manifestUrl)).json();
        const { loader, mesh, material } = await hologram(manifestUrl);
        const textures = {};
        const buffers = new Set();
        for (const spec of manifest.textures) {
          const texture = material.userData[spec.id];
          if (!texture?.isTexture || !Array.isArray(texture.mipmaps)) throw new Error(`Texture ${spec.slot} is not loaded`);
          const bytes = PROBE_BYTES[spec.slot];
          if (!bytes) throw new Error(`No constant for ${spec.slot}`);
          for (const m of texture.mipmaps) { buffers.add(m.data.buffer); for (let p = 0; p < m.data.length; p += 4) m.data.set(bytes, p); }
          texture.needsUpdate = true;
          textures[spec.slot] = { id: spec.id, srgb: spec.srgb, wrap: [texture.wrapS, texture.wrapT], colorSpace: texture.colorSpace,
            mips: texture.mipmaps.length, bytes };
        }
        const target = new THREE.WebGLRenderTarget(W, H, { type: blendType });
        draw(target, sceneOf(mesh), { viewport: V });
        const pixels = read(target);
        // What the GPU returns for each bound texture (decode and filtering), on the same quad, viewport and sampler
        // objects: the CPU evaluation then isolates the program arithmetic and plumbing from texture-unit precision.
        const sampled = {};
        for (const spec of manifest.textures) {
          const probe = new THREE.ShaderMaterial({ uniforms: { src: { value: material.userData[spec.id] } }, toneMapped: false,
            vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
            fragmentShader: "uniform sampler2D src; varying vec2 vUv; void main() { gl_FragColor = texture2D(src, vUv); }" });
          const sampler = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
          draw(sampler, sceneOf(new THREE.Mesh(mesh.geometry, probe)), { viewport: V });
          sampled[spec.slot] = px(read(sampler), W, V[0] + V[2] / 2, V[1] + V[3] / 2);
          probe.dispose(); sampler.dispose();
        }
        const diagnostics = renderer.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length;
        let finite = true, negative = 0, outsideNonZero = 0;
        const inside = [];
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          const v = px(pixels, W, i, j);
          if (!v.every(Number.isFinite)) finite = false;
          const isInside = i >= V[0] && i < V[0] + V[2] && j >= V[1] && j < V[1] + V[3];
          if (isInside) { inside.push(v); if (v.slice(0, 3).some((c) => c < 0)) negative++; }
          else if (v.some((c) => c !== 0)) outsideNonZero++;
        }
        const first = inside[0];
        const spread = Math.max(...inside.map((v) => Math.max(...[0, 1, 2].map((c) => Math.abs(v[c] - first[c])))));
        Object.assign(row, { itemId: manifest.itemId, shader: manifest.shader, shaderSha256: manifest.shaderSha256, textures,
          separateBuffers: buffers.size >= manifest.textures.length, plan: material.userData.recoveredSamplers,
          state: { blending: material.blending, forceSinglePass: material.forceSinglePass, side: material.side, depthWrite: material.depthWrite,
            castShadow: mesh.castShadow }, compileFailures: diagnostics, finite, negative, outsideNonZero,
          insidePixels: inside.length, rendered: first, insideSpread: spread, sampled });
        loader.dispose(); target.dispose();
      } catch (error) { row.error = String(error?.message ?? error); }
      out.probes.push(row);
    }
  }
  renderer.dispose();
  return out;
}

// ---- CPU side: each probe's own emitted GLSL for the same constant textures ----------------------------------------
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const ALLOWED_NAMES = new Set(["v", "uv0", "view", "fragCoord", "rectMin", "invSize", "f", "tex", "vec2", "floatBitsToUint",
  "uintBitsToFloat", "isnan", "max"]);
function evaluateSurface(glsl, sample, uv0 = [0.25, 0.75], view = { fragCoord: [40.5, 30.5], rectMin: [16, 24], invSize: [1 / 48, 1 / 32] }) {
  const f = Math.fround, lines = glsl.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.startsWith("ReconstructedSurface recoveredSurface("));
  if (start < 0) throw new Error("No recoveredSurface function");
  const u32 = new Uint32Array(1), f32 = new Float32Array(u32.buffer);
  const helpers = { f, tex: (name, coords) => sample(name, coords), vec2: (a, b) => [a, b],
    floatBitsToUint: (x) => { f32[0] = x; return u32[0]; }, uintBitsToFloat: (x) => { u32[0] = x >>> 0; return f32[0]; },
    isnan: Number.isNaN, max: (a, b) => Math.max(a, b) };
  const v = [];
  let emissive = null, statements = 0;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line || line === "ReconstructedSurface surface;" || line === "return surface;" || line === "}") continue;
    let m = line.match(/^surface\.emissive = vec3\(n(\d+), n(\d+), n(\d+)\);$/);
    if (m) { emissive = m.slice(1).map((k) => v[+k]); continue; }
    m = line.match(/^(float|uint|vec4) n(\d+) = (.+);$/);
    if (!m) throw new Error(`Unsupported GLSL line: ${line}`);
    const expr = m[3]
      .replace(/texture\((u_\w+), /g, 'tex("$1", ')
      .replace(/\b0xffffffffu\b/g, "4294967295").replace(/\b(\d+)u\b/g, "$1")
      .replace(/(?<![\w.\[])(\d+\.\d+(?:e[-+]?\d+)?)/g, "f($1)")
      .replace(/\bn(\d+)\.([xyzw])\b/g, (_, k, c) => `v[${k}][${"xyzw".indexOf(c)}]`)
      .replace(/\bn(\d+)\b/g, "v[$1]")
      .replace(/\buv0\.([xy])\b/g, (_, c) => `uv0[${"xy".indexOf(c)}]`)
      .replace(/\bview\.(fragCoord|rectMin|invSize)\.([xy])\b/g, (_, field, c) => `view.${field}[${"xy".indexOf(c)}]`);
    // The input is the hash-checked emitter output, but the translated expression is still confined to the straight-line
    // subset it uses: these identifiers, sampler names, numbers and arithmetic, comparison and ternary operators.
    const names = expr.replace(/"u_t\d+(?:_s\d+)?"/g, "").replace(/\d+\.\d+(?:e[-+]?\d+)?/g, "").match(/[A-Za-z_]\w*/g) ?? [];
    if (!/^[\w\s.()[\],+\-*/?:<>=!"]*$/.test(expr) || !names.every((n) => ALLOWED_NAMES.has(n)))
      throw new Error(`Unsupported GLSL expression: ${m[3]}`);
    const value = new Function("v", "uv0", "view", ...Object.keys(helpers), `return (${expr});`)(v, uv0, view, ...Object.values(helpers));
    v[+m[2]] = m[1] === "float" ? f(value) : m[1] === "uint" ? value >>> 0 : value.map(f);
    statements++;
  }
  if (!emissive) throw new Error("No emissive output");
  return { emissive, statements };
}

// Program arithmetic and plumbing: the emitted GLSL on the CPU (float32 per statement) fed the sample values the GPU
// returned for each binding, against the rendered emission: within 2e-5 relative (2e-3 on a half-float target).
// Texture-unit precision: those sample values against the exact decode of the constant bytes (sRGB EOTF), at most
// 2^-8 relative. The formula-fed CPU value is reported too (its gap is that precision propagated through the program).
const TOLERANCE = 2e-5, DECODE_TOLERANCE = 1 / 256;
const halfTarget = !result.floatBlend;
for (const row of result.probes) {
  if (row.error) { row.pass = false; continue; }
  const glslFile = path.join(PROBE_DIR, row.shader);
  const glsl = readFileSync(glslFile, "utf8");
  row.glslSha256Matches = sha(readFileSync(glslFile)) === row.shaderSha256;
  const formula = (slot) => row.textures[slot].bytes.map((b, c) =>
    Math.fround(c < 3 && row.textures[slot].srgb ? srgbToLinear(b / 255) : b / 255));
  const swap = (slot) => (slot === "t3_s1" ? "t3_s3" : slot === "t3_s3" ? "t3_s1" : slot);
  const measured = (slot) => row.sampled[slot].map(Math.fround);
  const own = evaluateSurface(glsl, (name) => measured(name.slice(2)));
  const fromFormula = evaluateSurface(glsl, (name) => formula(name.slice(2)));
  const swapped = evaluateSurface(glsl, (name) => measured(swap(name.slice(2))));
  const rel = (a, b) => Math.max(...[0, 1, 2].map((c) => Math.abs(a[c] - b[c]) / Math.max(Math.abs(b[c]), 1e-3)));
  row.decodeDeviation = Object.fromEntries(Object.keys(row.textures).map((slot) => [slot,
    Math.max(...[0, 1, 2].map((c) => Math.abs(row.sampled[slot][c] - formula(slot)[c]) / Math.max(formula(slot)[c], 1e-3)))]));
  row.cpu = own.emissive; row.cpuStatements = own.statements; row.cpuFromDecodeFormula = fromFormula.emissive;
  row.relativeError = rel(row.rendered, own.emissive);
  row.relativeErrorFromDecodeFormula = rel(row.rendered, fromFormula.emissive);
  row.swappedBindingRelativeError = rel(row.rendered, swapped.emissive);
  const tolerance = halfTarget ? 2e-3 : TOLERANCE;
  row.tolerance = tolerance;
  row.pass = row.glslSha256Matches && row.compileFailures === 0 && row.finite && row.negative === 0 && row.outsideNonZero === 0
    && row.insidePixels === 48 * 32 && row.insideSpread <= tolerance * Math.max(...row.cpu.map(Math.abs))
    && row.relativeError <= tolerance && row.swappedBindingRelativeError > 100 * tolerance && row.separateBuffers
    && Object.values(row.decodeDeviation).every((d) => d <= DECODE_TOLERANCE)
    && row.cpu.some((c) => c > 0) && row.state.forceSinglePass && row.state.castShadow === false;
}

const checks = ["viewUv", "blend", "folded", "toneMapping", "samplerSplit", "accumulator", "shadow", "export"];
const summary = Object.fromEntries(checks.map((k) => [k, !!result[k]?.pass]));
summary.probes = `${result.probes.filter((r) => r.pass).length}/${result.probes.length}`;
const pass = errors.length === 0 && checks.every((k) => summary[k]) && result.probes.length === probes.length
  && result.probes.every((r) => r.pass);
const report = { at: new Date().toISOString(), app: APP, probeUrl, floatBlend: result.floatBlend, pass, summary, errors, ...result };
writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify({ pass, summary, errors: errors.slice(0, 5),
  probes: result.probes.map((r) => ({ item: r.itemId ?? r.manifestUrl, pass: r.pass, rel: r.relativeError,
    relFromDecodeFormula: r.relativeErrorFromDecodeFormula, decode: r.decodeDeviation, swapped: r.swappedBindingRelativeError,
    error: r.error })) }));
if (!pass) process.exitCode = 1;
