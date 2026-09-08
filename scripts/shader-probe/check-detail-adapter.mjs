// Synthetic GPU checks of real runtime cube/HDR uploads and cutout surface mapping.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DataUtils } from 'three';
import { chromium } from 'playwright-core';

const output = 'visual-diff/reconstructed/reference-details-01';
mkdirSync(output, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const payloads = new Map(), samples = [];
function textureSpec(id, cube, half, srgb) {
  const chunks = [], mips = []; let offset = 0;
  for (const [level, size] of [4,2,1].entries()) {
    const data = half ? new Uint16Array(size*size*4) : new Uint8Array(size*size*4*6);
    for (let face = 0; face < (cube ? 6 : 1); face++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const values = half ? [2+x/8, (y+1)/32, (level+1)/1000, 1] : [7+face*37+x*7, 11+level*61+y*9, 31+x*13+y*5, 255];
      const encoded = half ? values.map(DataUtils.toHalfFloat) : values;
      data.set(encoded, (face*size*size+y*size+x)*4);
      const s = 2*(x+.5)/size-1, t = 2*(y+.5)/size-1;
      const direction = [[1,-t,-s],[-1,-t,s],[s,1,t],[s,-1,-t],[s,-t,1],[-s,-t,-1]][face];
      const linear = n => { const v = n/255; return srgb ? v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4 : v; };
      samples.push({ id, level, face, x, y, direction, uv: [(x+.5)/size,(y+.5)/size],
        expected: half ? encoded.slice(0,3).map(DataUtils.fromHalfFloat) : values.slice(0,3).map(linear) });
    }
    const bytes = Buffer.from(data.buffer); chunks.push(bytes);
    mips.push({ width: size, height: size, offset, bytes: bytes.length }); offset += bytes.length;
  }
  const bytes = Buffer.concat(chunks), file = id+'.bin'; payloads.set(file, gzipSync(bytes));
  return { id, slot: cube ? 't3' : 't4', file, array: false, ...(cube ? { cube: true } : {}),
    ...(half ? { componentType: 'float16' } : {}), depth: cube ? 6 : 1, srgb,
    wrapS: 'TA_Clamp', wrapT: 'TA_Clamp', sha256: hash(bytes), mips };
}
const textures = [textureSpec('cube', true, false, true), textureSpec('hdr', false, true, false)];
const textureShader = `uniform highp samplerCube u_t3;
uniform highp sampler2D u_t4;
uniform vec3 testDirection; uniform vec2 testUv; uniform float testLevel; uniform int testTexture;
ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1) {
  ReconstructedSurface s;
  s.baseColor = testTexture == 0 ? textureLod(u_t3,testDirection,testLevel).rgb : textureLod(u_t4,testUv,testLevel).rgb;
  s.normal=vec3(0,0,1); s.roughness=.5; s.metalness=0.0; s.specular=.5; s.ao=1.0; return s;
}`;
const cutoutShader = `uniform float testCoverage;
struct ReconstructedGeometry { vec3 position; vec3 tangent; vec3 normal; vec3 view; float handedness; vec3 objectPosition; };
ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedGeometry g) {
  ReconstructedSurface s; s.baseColor=vec3(1); s.normal=g.normal;
  s.roughness=.5; s.metalness=0.0; s.specular=0.0; s.ao=1.0; s.opacity=testCoverage; return s;
}`;
function manifest(id, shader, fields = {}) {
  return { formatVersion: 1, itemId: id, shader: id+'.glsl', shaderSha256: hash(shader), requiredUvSets: [0], textures: [], ...fields };
}
const manifests = { texture: manifest('texture', textureShader, { textures }),
  cutout: manifest('cutout', cutoutShader, { worldSurface: true, surfaceKind: 'eyelash', normalSpace: 'world', twoSided: true,
    coverageShader: 'cutout.glsl', coverageShaderSha256: hash(cutoutShader), coverageGeometryFields: [] }) };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/__detail_fixture__/*', route => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1);
    if (payloads.has(file)) return route.fulfill({ body: payloads.get(file), contentType: 'application/octet-stream' });
    if (file.endsWith('.json')) return route.fulfill({ json: manifests[file.split('.')[0]] });
    return route.fulfill({ body: file === 'texture.glsl' ? textureShader : cutoutShader, contentType: 'text/plain' });
  });
  const outfit = '1.' + Buffer.from(JSON.stringify({ slots: {} })).toString('base64url');
  await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rigIdle);
  const report = await page.evaluate(async samples => {
    const T = window.__THREE;
    const { loadReconstructedMaterial } = await import('/src/rig/ReconstructedMaterial.ts');
    const { enableSourceSkinning } = await import('/src/rig/SourceMesh.ts');
    const renderer = new T.WebGLRenderer(); renderer.setSize(256,256); renderer.setClearColor(0,0);
    renderer.outputColorSpace = T.LinearSRGBColorSpace;
    const target = new T.WebGLRenderTarget(256,256,{type:T.FloatType,depthBuffer:false});
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1,1,1,-1,.01,10);
    camera.position.z=3; camera.updateMatrixWorld(true);
    const geometry = new T.PlaneGeometry(2,2);
    geometry.setAttribute('tangent',new T.Float32BufferAttribute(Array.from({length:4},()=>[1,0,0,1]).flat(),4));
    const attr = (name,values,type=T.Float32BufferAttribute) => geometry.setAttribute(name,new type(Array.from({length:4},()=>values).flat(),4));
    attr('skinIndex',[0,1,2,3],T.Uint16BufferAttribute); attr('skinIndex1',[4,5,6,7],T.Uint16BufferAttribute);
    attr('skinWeight',[0,0,0,0]); attr('skinWeight1',[0,0,0,1]);
    const mesh = new T.SkinnedMesh(geometry,new T.MeshPhysicalMaterial()), bones=Array.from({length:8},()=>new T.Bone());
    const group=new T.Group(); scene.add(group); group.add(mesh,...bones);
    mesh.bind(new T.Skeleton(bones,bones.map(()=>new T.Matrix4())),new T.Matrix4());
    mesh.frustumCulled=false;
    const recovered = await loadReconstructedMaterial('/__detail_fixture__/texture.json','baseColor'); recovered.apply(mesh);
    enableSourceSkinning(mesh);
    const values = { testTexture:{value:0}, testLevel:{value:0}, testDirection:{value:new T.Vector3()}, testUv:{value:new T.Vector2()} };
    const before = mesh.material.onBeforeCompile;
    mesh.material.onBeforeCompile = function(shader,r) { before.call(this,shader,r); Object.assign(shader.uniforms,values); };
    const checks = [];
    for (const sample of samples) {
      values.testTexture.value = sample.id === 'cube' ? 0 : 1; values.testLevel.value = sample.level;
      values.testDirection.value.fromArray(sample.direction); values.testUv.value.fromArray(sample.uv);
      renderer.setRenderTarget(target); renderer.render(scene,camera);
      const pixel = new Float32Array(4); renderer.readRenderTargetPixels(target,128,128,1,1,pixel);
      const error = Math.max(...sample.expected.map((v,i)=>Math.abs(v-pixel[i])));
      // Fixed-function sRGB decoding uses the GPU's approximation to the transfer
      // curve. Allow half an 8-bit code value; linear half-float uploads stay strict.
      const tolerance = sample.id === 'cube' ? .5/255 : 2e-5;
      if (!Number.isFinite(error) || error > tolerance) throw new Error(`Texture ${JSON.stringify(sample)}: ${pixel} error ${error}`);
      checks.push({name:`${sample.id} mip=${sample.level} face=${sample.face} texel=${sample.x},${sample.y}`,maxError:error,passed:true});
    }
    const cutout = await loadReconstructedMaterial('/__detail_fixture__/cutout.json');
    cutout.apply(mesh,undefined,{boundsOrigin:[0,0,0]}); enableSourceSkinning(mesh); recovered.dispose();
    const visibleMaterial=mesh.material;
    const coverage = {value:1}, normalOutput = {value:false}, compile = mesh.material.onBeforeCompile;
    mesh.material.toneMapped=false;
    mesh.material.onBeforeCompile = function(shader,r) {
      compile.call(this,shader,r); shader.uniforms.testCoverage=coverage; shader.uniforms.testNormal=normalOutput;
      shader.fragmentShader='uniform bool testNormal;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
        'outgoingLight=testNormal ? normal*.5+.5 : vec3(1);\n#include <opaque_fragment>');
    };
    for (const alpha of [0,.1,.35,.7,1]) {
      coverage.value=alpha; renderer.setRenderTarget(target); renderer.render(scene,camera);
      const pixels = new Float32Array(256*256*4); renderer.readRenderTargetPixels(target,0,0,256,256,pixels);
      let count=0; for(let i=0;i<pixels.length;i+=4) if(pixels[i]>.5) count++;
      const actual=count/(256*256), error=Math.abs(actual-alpha);
      if (error > .025) throw new Error(`Raw coverage ${alpha}: ${actual}`);
      checks.push({name:`Raw cutout coverage ${alpha}`,actual,maxError:error,passed:true});
    }
    for (const shadow of [mesh.customDepthMaterial,mesh.customDistanceMaterial]) {
      if (!shadow.userData.recoveredCoverage) throw new Error('Missing shadow coverage adapter');
      const before=shadow.onBeforeCompile;
      shadow.onBeforeCompile=function(shader,r) {
        before.call(this,shader,r); shader.uniforms.testCoverage=coverage;
        shader.fragmentShader=shader.fragmentShader.replace(/\n\}\s*$/, '\n gl_FragColor=vec4(1.0);\n}');
      };
    }
    // Standalone distance-pass rendering needs the light binding normally supplied
    // by WebGLShadowMap before it calls refreshUniformsDistance.
    renderer.properties.get(mesh.customDistanceMaterial).light=new T.PointLight();
    const mask = material => {
      mesh.material=material; renderer.setRenderTarget(target); renderer.render(scene,camera);
      const pixels=new Float32Array(256*256*4); renderer.readRenderTargetPixels(target,0,0,256,256,pixels);
      return pixels.filter((_,i)=>i%4===0).map(v=>v>.5 ? 1 : 0);
    };
    for (const pose of [0,1]) for (const alpha of [0,.35,1]) {
      bones[7].position.set(pose*.23,pose*-.17,0); coverage.value=alpha;
      const visible=mask(visibleMaterial);
      for (const [name,material] of [['depth',mesh.customDepthMaterial],['distance',mesh.customDistanceMaterial]]) {
        const shadow=mask(material), mismatch=shadow.reduce((sum,v,i)=>sum+Math.abs(v-visible[i]),0);
        if (mismatch) throw new Error(`Shadow ${name} pose=${pose} alpha=${alpha}: ${mismatch} differing pixels`);
        checks.push({name:`${name} coverage matches visible pass, eighth influence pose=${pose} alpha=${alpha}`,pixels:visible.length,passed:true});
      }
    }
    mesh.material=visibleMaterial; bones[7].position.set(0,0,0);
    coverage.value=1; normalOutput.value=true;
    for (const [angle,side] of [[0,1],[.6,1],[-.4,-1]]) {
      group.rotation.set(.2,angle,.1); group.updateMatrixWorld(true);
      const normal=new T.Vector3(0,0,1).applyQuaternion(group.quaternion);
      camera.position.copy(normal).multiplyScalar(3*side).add(new T.Vector3(.25,.1,0)); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
      const expected=normal.clone().multiplyScalar(side).transformDirection(camera.matrixWorldInverse).multiplyScalar(.5).addScalar(.5).toArray();
      renderer.setRenderTarget(target); renderer.render(scene,camera);
      const pixel=new Float32Array(4); renderer.readRenderTargetPixels(target,128,128,1,1,pixel);
      const error=Math.max(...expected.map((v,i)=>Math.abs(v-pixel[i])));
      if (!Number.isFinite(error)||error>2e-5) throw new Error(`World normal side=${side} ${pixel} != ${expected}`);
      checks.push({name:`World normal angle=${angle} side=${side}`,maxError:error,passed:true});
    }
    mesh.material.dispose(); mesh.customDepthMaterial.dispose(); mesh.customDistanceMaterial.dispose();
    mesh.skeleton.dispose(); geometry.dispose(); cutout.dispose(); target.dispose(); renderer.dispose();
    return checks;
  }, samples);
  assert.deepEqual(errors,[]);
  writeFileSync(`${output}/detail-adapter-checks.json`,JSON.stringify(report,null,2));
  console.log(`${report.length} cube/HDR mip, visible/shadow coverage and world-normal GPU checks passed`);
} finally { await browser.close(); }
