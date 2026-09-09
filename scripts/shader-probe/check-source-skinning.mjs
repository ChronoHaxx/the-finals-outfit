// Synthetic fixtures exercise influences 5–8 on the GPU and the CPU picking path.
// No extracted game assets are needed for the fixtures themselves.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  mkdirSync("scripts/generated/shader-probe", { recursive: true });
  writeFileSync("scripts/generated/shader-probe/source-harness.html", `<!doctype html>
    <html><head><title>Source skinning fixtures</title><link rel="icon" href="data:,"></head><body>
    <script type="module">import * as THREE from 'three'; window.__THREE=THREE;</script></body></html>`);
  await page.goto("http://127.0.0.1:5173/scripts/generated/shader-probe/source-harness.html", { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__THREE);
  const report = await page.evaluate(async () => {
    const T = window.__THREE;
    const { enableSourceSkinning } = await import("/src/rig/SourceMesh.ts");
    const { createGltfLoader } = await import("/src/rig/loaders.ts");
    const { BodyDecalManager } = await import("/src/rig/BodyDecals.ts");
    // A valid eight-weight GLB whose first set sums to zero reproduces the
    // loader's destructive four-weight normalization unless our plugin saves it.
    const fixture = { asset: { version: "2.0" }, scene: 0,
      scenes: [{ nodes: Array.from({length: 9}, (_, i) => i) }],
      nodes: [{ mesh: 0, skin: 0 }, ...Array.from({length: 8}, (_, i) => ({ name: `bone_${i}` }))],
      skins: [{ joints: [1,2,3,4,5,6,7,8] }], meshes: [{ primitives: [{ attributes: {} }] }],
      accessors: [], bufferViews: [], buffers: [] };
    const chunks = [];
    let bytes = 0;
    const attribute = (name, values, type, componentType = 5126) => {
      const array = componentType === 5123 ? new Uint16Array(values) : new Float32Array(values);
      const index = fixture.accessors.length;
      fixture.bufferViews.push({ buffer: 0, byteOffset: bytes, byteLength: array.byteLength });
      fixture.accessors.push({ bufferView: index, componentType, count: 3, type,
        ...(name === "POSITION" ? { min: [0,0,0], max: [1,1,0] } : {}) });
      fixture.meshes[0].primitives[0].attributes[name] = index;
      chunks.push(new Uint8Array(array.buffer)); bytes += array.byteLength;
    };
    attribute("POSITION", [0,0,0,1,0,0,0,1,0], "VEC3");
    attribute("JOINTS_0", [0,1,2,3,0,1,2,3,0,1,2,3], "VEC4", 5123);
    attribute("WEIGHTS_0", Array(12).fill(0), "VEC4");
    attribute("JOINTS_1", [4,5,6,7,4,5,6,7,4,5,6,7], "VEC4", 5123);
    attribute("WEIGHTS_1", [0,0,0,1,0,0,0,1,0,0,0,1], "VEC4");
    fixture.buffers.push({ byteLength: bytes });
    const json = new TextEncoder().encode(JSON.stringify(fixture));
    const jsonLength = Math.ceil(json.length/4)*4;
    const glb = new Uint8Array(28 + jsonLength + bytes);
    const header = new DataView(glb.buffer);
    [0x46546c67,2,glb.length,jsonLength,0x4e4f534a].forEach((n,i)=>header.setUint32(i*4,n,true));
    glb.fill(32,20,20+jsonLength); glb.set(json,20);
    header.setUint32(20+jsonLength,bytes,true); header.setUint32(24+jsonLength,0x004e4942,true);
    let offset=28+jsonLength; for (const chunk of chunks) { glb.set(chunk,offset); offset+=chunk.length; }
    const loaded = await createGltfLoader().parseAsync(glb.buffer, "");
    const imported = loaded.scene.children.find(o=>o.isSkinnedMesh);
    if (!imported || imported.geometry.attributes.skinWeight.array.some(w=>w!==0)
      || imported.geometry.attributes.skinWeight1.getW(0)!==1 || imported.userData.sourceSkinInfluences!==8)
      throw new Error("GLTFLoader changed the original eight-influence weights");
    imported.skeleton.dispose(); imported.geometry.dispose(); imported.material.dispose();
    imported.customDepthMaterial.dispose(); imported.customDistanceMaterial.dispose();
    const renderer = new T.WebGLRenderer();
    const target = new T.WebGLRenderTarget(1, 1, { type: T.FloatType, depthBuffer: false });
    const scene = new T.Scene();
    const camera = new T.Camera();
    const baseP = new T.Vector3(.23, .41, -.13);
    const baseN = new T.Vector3(.2, .3, 1).normalize();
    const baseT = new T.Vector3(1, -.1, -.17).normalize();
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(Array(3).fill(baseP.toArray()).flat(), 3));
    geometry.setAttribute("normal", new T.Float32BufferAttribute(Array(3).fill(baseN.toArray()).flat(), 3));
    geometry.setAttribute("tangent", new T.Float32BufferAttribute(Array(3).fill([...baseT.toArray(), -1]).flat(), 4));
    geometry.setAttribute("corner", new T.Float32BufferAttribute([-1, -1, 3, -1, -1, 3], 2));
    geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute([0,1,2,3,0,1,2,3,0,1,2,3], 4));
    geometry.setAttribute("skinIndex1", new T.Uint16BufferAttribute([4,5,6,7,4,5,6,7,4,5,6,7], 4));
    geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(new Float32Array(12), 4));
    geometry.setAttribute("skinWeight1", new T.Float32BufferAttribute(new Float32Array(12), 4));
    const material = new T.ShaderMaterial({
      defines: { USE_TANGENT: "" }, uniforms: { recordMode: { value: 0 } },
      vertexShader: `attribute vec2 corner;
        varying vec2 vMapUv;
        uniform int recordMode;
        varying vec3 recorded;
        #include <common>
        #include <skinning_pars_vertex>
        void main() {
          #include <begin_vertex>
          #include <beginnormal_vertex>
          #include <skinbase_vertex>
          #include <skinnormal_vertex>
          #include <skinning_vertex>
          recorded = recordMode == 0 ? transformed : recordMode == 1 ? objectNormal : objectTangent;
          vMapUv = vec2(0.0);
          gl_Position = vec4(corner, 0.0, 1.0);
        }`,
      fragmentShader: `varying vec3 recorded; varying vec2 vMapUv;
        uniform sampler2D map;
        void main() {
          vec4 diffuseColor = vec4(1.0);
          #include <map_fragment>
          gl_FragColor = vec4(recorded, 1.0);
        }`,
    });
    const bones = Array.from({ length: 8 }, () => new T.Bone());
    bones.forEach(b => scene.add(b));
    const mesh = new T.SkinnedMesh(geometry, material);
    mesh.bind(new T.Skeleton(bones, bones.map(() => new T.Matrix4())), new T.Matrix4());
    mesh.frustumCulled = false;
    enableSourceSkinning(mesh);
    scene.add(mesh);
    const sourceCompile = material.onBeforeCompile;
    const sourceKey = material.customProgramCacheKey;
    const decals = new BodyDecalManager(new T.TextureLoader(), "");
    decals.registerTarget("body", [material]);
    const mask = document.createElement("canvas");
    mask.width = mask.height = 1;
    mask.getContext("2d").fillRect(0, 0, 1, 1);
    const maskUrl = mask.toDataURL();
    const cases = [];
    const fixtures = [[0,0,0,0,0,0,0,1], [.01,.02,.03,.04,.1,.2,.25,.35], [.2,0,.1,0,.3,0,.4,0]];
    // The recorded shader isolates GPU skinning; check-coverage-tiles.mjs checks
    // actual fragment discards. Mask/decal rebuilds must preserve this callback.
    for (const phase of ["bare", "coverage", "coverage-and-decal", "decal", "cleared"]) {
      if (phase === "coverage") decals.setBodyHideMasks([maskUrl]);
      if (phase === "coverage-and-decal") await decals.set("bodyPaint", { layers: [{ target: "body", tint: "#ffffff" }] });
      if (phase === "decal") decals.setBodyHideMasks([]);
      if (phase === "cleared") decals.clear("bodyPaint");
      await decals.whenBodyHidesReady();
      if (phase === "cleared" && (material.onBeforeCompile !== sourceCompile || material.customProgramCacheKey !== sourceKey))
        throw new Error("Clearing body coverage/decals did not restore the source skinning hooks");
    for (let pose = 0; pose < 2; pose++) for (const weights of fixtures) {
      for (let i = 0; i < 8; i++) {
        bones[i].position.set(pose ? i*.031 : 0, pose ? -i*.017 : 0, pose ? i*.013 : 0);
        bones[i].rotation.set(pose ? i*.071 : 0, pose ? i*-.053 : 0, pose ? i*.029 : 0);
      }
      for (let v = 0; v < 3; v++) {
        geometry.attributes.skinWeight.setXYZW(v, ...weights.slice(0, 4));
        geometry.attributes.skinWeight1.setXYZW(v, ...weights.slice(4));
      }
      geometry.attributes.skinWeight.needsUpdate = geometry.attributes.skinWeight1.needsUpdate = true;
      scene.updateMatrixWorld(true);
      for (let mode = 0; mode < 3; mode++) {
        const original = [baseP, baseN, baseT][mode];
        const expected = new T.Vector4();
        bones.forEach((bone, i) => expected.addScaledVector(
          new T.Vector4(original.x, original.y, original.z, mode ? 0 : 1).applyMatrix4(bone.matrixWorld), weights[i]));
        material.uniforms.recordMode.value = mode;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const actual = new Float32Array(4);
        renderer.readRenderTargetPixels(target, 0, 0, 1, 1, actual);
        let maxError = Math.max(...actual.slice(0,3).map((v,i)=>Math.abs(v-expected.getComponent(i))));
        if (mode === 0) {
          const cpu = mesh.applyBoneTransform(0, baseP.clone());
          maxError = Math.max(maxError, cpu.distanceTo(new T.Vector3(expected.x, expected.y, expected.z)));
        }
        cases.push({ phase, pose, weights, mode, maxError, actual: [...actual] });
      }
    }
    }
    decals.clearAll();
    mesh.skeleton.dispose();
    geometry.dispose(); material.dispose(); mesh.customDepthMaterial.dispose(); mesh.customDistanceMaterial.dispose();
    target.dispose(); renderer.dispose();
    return cases;
  });
  assert.deepEqual(errors, []);
  for (const test of report) assert(test.maxError < 2e-6 && test.actual[3] === 1, JSON.stringify(test));
  mkdirSync("visual-diff/reconstructed", { recursive: true });
  writeFileSync("visual-diff/reconstructed/source-skinning-checks.json", JSON.stringify(report, null, 2));
  console.log(`${report.length} GPU/CPU skinning cases passed; maximum error ${Math.max(...report.map(r=>r.maxError))}`);
} finally {
  await browser.close();
}
