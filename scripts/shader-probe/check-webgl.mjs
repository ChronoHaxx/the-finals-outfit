// Check the emitted GLSL against the forward SM5 interpreter's fixture outputs.
// Constant texture samples isolate shader arithmetic from filtering/lighting.
//
// The existing bare-node command stays valid on Node 22.15 through the project's
// installed tsx scoped import. The sampler plan is shared with the runtime loader.
// Planning happens in Node and is handed to the page through a
// binding, so the probe and the viewer always agree on which samplers exist.
//
// The probe keeps every slot's data independent: identity aliasing is disabled
// here because the fixtures deliberately give each slot a different synthetic
// value, so slots that the budget forces together become separate array layers
// and the original SM5 expected values still apply unchanged.
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { tsImport } from "tsx/esm/api";
const {
  RECOVERED_SAMPLER_TARGET, planReconstructedSamplers, rewriteSamplerGlsl,
  samplerPlanReport, samplerUniformBindings,
} = await tsImport("../../src/rig/ReconstructedSamplers.ts", import.meta.url);
const fixturePath = process.argv[2];
const materialBase = process.argv[3] ?? "/models/reconstructed";
const reportPath = process.argv[4] ?? `visual-diff/reconstructed/${process.argv[3] ? "assembly-webgl" : "webgl"}-checks.json`;
if (!fixturePath) throw new Error("Usage: node check-webgl.mjs <translation-fixtures.json> [materialBase] [reportPath]");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  // Plan and rewrite in Node with the shared planner; the page only receives
  // the resulting plan, uniform mapping and already-rewritten shader text.
  await page.exposeFunction("__recoveredSamplerProgram", ({ textures, shader, coverage }) => {
    const plan = planReconstructedSamplers(textures, { target: RECOVERED_SAMPLER_TARGET, deduplicate: false });
    return {
      plan, report: samplerPlanReport(plan), uniforms: samplerUniformBindings(plan),
      shader: rewriteSamplerGlsl(shader, plan),
      coverage: coverage === null ? null : rewriteSamplerGlsl(coverage, plan, { allowMissingDeclarations: true }),
    };
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
  // The app keeps loading preview assets, so the network never idles within the default timeout.
  // Only the test renderer modules are needed here: wait for the viewer to publish them.
  await page.goto(process.env.APP_URL ?? "http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__THREE, undefined, { timeout: 60000 });
  const report = await page.evaluate(async ({ cases, materialBase }) => {
    const THREE = window.__THREE;
    if (!THREE) throw new Error("No test renderer modules");
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(1, 1);
    if (!renderer.extensions.has("EXT_color_buffer_float")) throw new Error("Float render target unavailable");
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false, stencilBuffer: false });
    const scene = new THREE.Scene(), camera = new THREE.Camera();
    const geometry = new THREE.PlaneGeometry(2, 2);
    const grouped = Map.groupBy(cases, (c) => c.itemId);
    const report = [];
    for (const [id, group] of grouped) {
      const manifest = await (await fetch(`${materialBase}/${id}.json`)).json();
      let code = await (await fetch(`${materialBase}/${manifest.shader}`)).text();
      let coverageCode = '';
      if (manifest.coverageShader) {
        coverageCode = await (await fetch(`${materialBase}/${manifest.coverageShader}`)).text();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(coverageCode)))]
          .map(b=>b.toString(16).padStart(2,'0')).join('');
        if (hash !== manifest.coverageShaderSha256 || group.some(test=>test.coverageShaderSha256 !== hash))
          throw new Error(`Coverage fixture/shader hash mismatch for ${id}`);
      }
      const shaderHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)))]
        .map(b => b.toString(16).padStart(2, "0")).join("");
      if (shaderHash !== manifest.shaderSha256 || group.some(test => test.shaderSha256 !== shaderHash))
        throw new Error(`Fixture/shader hash mismatch for ${id}; regenerate fixtures with --materials`);
      // Original bytes are hashed first; only the runtime copies are retargeted.
      const program = await window.__recoveredSamplerProgram({ textures: manifest.textures, shader: code,
        coverage: manifest.coverageShader ? coverageCode : null });
      const plan = program.plan;
      code = program.shader;
      if (manifest.coverageShader) {
        // The full surface includes the same declarations and a superset of samplers.
        coverageCode = program.coverage.replace(/^uniform[^;]+;$/gm,'').replace(/struct ReconstructedGeometry \{[^}]+\};/g,'')
          .replace('recoveredSurface(', 'recoveredCoverage(');
      }
      const world = !!manifest.skinSurface || !!manifest.worldSurface;
      const coverage = ['hair', 'eyelash'].includes(manifest.surfaceKind) || !!manifest.skinCoverage;
      const quad = !!manifest.geometryDependentNormals || world;
      target.setSize(quad ? 2 : 1, quad ? 2 : 1);
      const uniforms = { testUv: { value: new THREE.Vector4() }, testOutput: { value: 0 }, testView: { value: new THREE.Vector3() },
        ...Object.fromEntries(["Position", "Tangent", "Normal", "View", "ObjectPosition"].map(name =>
          [`testGeometry${name}`, { value: Array.from({ length: 4 }, () => new THREE.Vector3()) }])),
        testGeometryHandedness: { value: new Float32Array(4) },
        testGeometryColor: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) } };
      // One float texture per planned sampler. Packed slots each own a layer, so
      // their independent fixture values stay independent.
      const textures = new Map();
      for (const resource of plan.resources) {
        const spec = resource.kind === "pack" ? null : resource.texture;
        const depth = resource.kind === "pack" ? resource.layout.depth : spec.depth;
        const texture = resource.kind !== "pack" && spec.cube
          ? new THREE.CubeTexture(Array.from({length: 6}, () => new THREE.DataTexture(new Float32Array(4), 1, 1)))
          : resource.kind === "pack" || spec.array
            ? new THREE.DataArrayTexture(new Float32Array(depth * 4), 1, 1, depth)
            : new THREE.DataTexture(new Float32Array(4), 1, 1);
        texture.type = THREE.FloatType; texture.format = THREE.RGBAFormat;
        texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
        texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
        texture.generateMipmaps = false;
        textures.set(resource.key, texture);
      }
      for (const binding of program.uniforms) uniforms[binding.name] = { value: textures.get(binding.resource) };
      const material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, uniforms,
        vertexShader: "in vec3 position; void main() { gl_Position = vec4(position, 1.0); }",
        fragmentShader: `precision highp float; precision highp int;
          uniform vec4 testUv; uniform int testOutput; uniform vec3 testView; out vec4 result;
          ${quad ? `uniform vec3 testGeometryPosition[4], testGeometryTangent[4], testGeometryNormal[4], testGeometryView[4];
            uniform float testGeometryHandedness[4];` : ""}
          ${world ? "uniform vec3 testGeometryObjectPosition[4];" : ""}
          ${manifest.surfaceKind === 'hair' ? "uniform vec4 testGeometryColor[4];" : ""}
          struct ReconstructedSurface { vec3 baseColor; vec3 normal; float roughness; float metalness; float specular; float ao; vec3 subsurfaceColor; float opacity; float scatter; };
          ${code}
          ${coverageCode}
          void main() {
            ${quad ? `int lane = int(gl_FragCoord.x) + 2 * (1 - int(gl_FragCoord.y));
              ReconstructedGeometry geometry = ReconstructedGeometry(testGeometryPosition[lane], testGeometryTangent[lane],
                testGeometryNormal[lane], testGeometryView[lane], testGeometryHandedness[lane]${world ? ", testGeometryObjectPosition[lane]" : ""}${manifest.surfaceKind === 'hair' ? ", testGeometryColor[lane]" : ""});` : ""}
            ReconstructedSurface s = recoveredSurface(testUv.xy, testUv.zw${manifest.viewDependentCloth ? ", testView" : ""}${quad ? ", geometry" : ""});
            if (testOutput == 0) result = vec4(s.baseColor, s.roughness);
            else if (testOutput == 1) result = vec4(s.normal, s.metalness);
            else if (testOutput == 2) result = vec4(s.specular, s.ao, 0.0, 1.0);
            ${manifest.skinSurface ? "else if (testOutput == 3) result = vec4(s.subsurfaceColor, 1.0);" : ""}
            ${coverage ? `else if (testOutput == ${manifest.skinSurface ? 4 : 3}) result = vec4(s.opacity, ${manifest.surfaceKind === 'hair' ? 's.scatter' : '0.0'}, 0.0, 1.0);` : ""}
            ${coverageCode ? 'else result = vec4(recoveredCoverage(testUv.xy, testUv.zw, geometry).opacity, 0.0, 0.0, 1.0);' : ''}
          }`,
      });
      const mesh = new THREE.Mesh(geometry, material); scene.add(mesh);
      let maxAbsoluteError = 0, completedCases = 0, failure;
      try { for (const test of group) {
        uniforms.testUv.value.fromArray(test.uv);
        uniforms.testView.value.fromArray(test.viewTangent ?? [0, 0, 1]);
        if (quad) {
          if (test.geometry?.length !== 4) throw new Error("Missing geometry quad fixture");
          for (const [i, geometry] of test.geometry.entries()) {
            for (const name of ["Position", "Tangent", "Normal", "View"])
              uniforms[`testGeometry${name}`].value[i].fromArray(geometry[name.toLowerCase()]);
            if (world) uniforms.testGeometryObjectPosition.value[i].fromArray(geometry.objectPosition);
            if (manifest.surfaceKind === 'hair') uniforms.testGeometryColor.value[i].fromArray(geometry.color);
            uniforms.testGeometryHandedness.value[i] = geometry.handedness;
          }
        }
        for (const binding of plan.bindings) {
          const samples = test.textures[binding.slot];
          const texture = textures.get(binding.resource);
          if (binding.kind === "alias") throw new Error(`Probe plan aliased ${id}/${binding.slot}; fixtures are independent`);
          if (binding.kind === "layer") {
            if (samples.length !== 1) throw new Error(`Fixture array depth mismatch for ${id}/${binding.slot}; regenerate with --materials`);
            texture.image.data.set(samples[0], binding.layer * 4);
          } else if (texture.isDataArrayTexture) {
            if (samples.length !== texture.image.depth)
              throw new Error(`Fixture array depth mismatch for ${id}/${binding.slot}; regenerate with --materials`);
            texture.image.data.set(samples.flat());
          } else if (texture.isCubeTexture) {
            if (samples.length !== 6) throw new Error(`Fixture cube face count mismatch for ${id}/${binding.slot}`);
            texture.images.forEach((face, i) => face.image.data.set(samples[i]));
          } else texture.image.data.set(samples[0]);
          texture.needsUpdate = true;
        }
        const expected = Array.from({ length: quad ? 4 : 1 }, (_, lane) => {
          const value = name => quad ? test.expected[name][lane] : test.expected[name];
          return [[...value("baseColor"), ...value("roughness")], [...value("normal"), ...value("metalness")],
            [...value("specular"), ...value("ao"), 0, 1], ...(manifest.skinSurface ? [[...value("subsurfaceColor"), 1]] : []),
            ...(coverage ? [[...value('opacity'), ...(manifest.surfaceKind === 'hair' ? value('scatter') : [0]), 0, 1]] : []),
            ...(coverageCode ? [[...value('opacity'),0,0,1]] : [])];
        });
        for (let output = 0; output < expected[0].length; output++) {
          uniforms.testOutput.value = output;
          renderer.setRenderTarget(target); renderer.render(scene, camera);
          const actual = new Float32Array(quad ? 16 : 4);
          renderer.readRenderTargetPixels(target, 0, 0, quad ? 2 : 1, quad ? 2 : 1, actual);
          for (let lane = 0; lane < expected.length; lane++) for (let c = 0; c < 4; c++) {
            const pixel = quad ? [2, 3, 0, 1][lane] : 0;
            const value = actual[pixel*4+c], want = expected[lane][output][c];
            const error = Math.abs(value - want);
            if (!Number.isFinite(value) || error > 0.00005)
              throw new Error(`${id} uv=${test.uv} lane=${lane} output=${output}.${c}: ${value} vs ${want}`);
            maxAbsoluteError = Math.max(maxAbsoluteError, error);
          }
        }
        completedCases++;
      } } catch (error) { failure = String(error); }
      report.push({ itemId: id, cases: completedCases, expectedCases: group.length,
        maxAbsoluteError, samplerPlan: { ...program.report, maxTextureImageUnits: renderer.capabilities.maxTextures },
        ...(failure ? { error: failure } : {}) });
      scene.remove(mesh); material.dispose(); textures.forEach((t) => t.dispose());
    }
    geometry.dispose(); target.dispose(); renderer.dispose();
    return report;
  }, { cases: fixtures, materialBase });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length || report.some(r => r.error)) throw new Error([
    ...errors, ...report.filter(r => r.error).map(r => r.error),
  ].join("\n"));
} finally {
  await browser.close();
}
