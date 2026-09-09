// Real material, skinning, decal and shadow adapters with synthetic neck coverage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const output = 'visual-diff/reconstructed/reference-neck-01';
const code = `uniform float testCoverage;
struct ReconstructedGeometry { vec3 position; vec3 tangent; vec3 normal; vec3 view; float handedness; vec3 objectPosition; };
ReconstructedSurface recoveredSurface(vec2 uv0, vec2 uv1, ReconstructedGeometry g) {
 ReconstructedSurface s; s.baseColor=vec3(.25); s.normal=vec3(0,0,1); s.roughness=.5;
 s.metalness=0.0; s.specular=.5; s.ao=1.0; s.subsurfaceColor=vec3(0); s.opacity=testCoverage; return s;
}`;
const hash = createHash('sha256').update(code).digest('hex');
const manifest = { formatVersion:1, itemId:'synthetic-neck', shader:'shader.glsl', shaderSha256:hash,
 coverageShader:'shader.glsl', coverageShaderSha256:hash, coverageGeometryFields:[],
 skinSurface:true, skinCoverage:'neck-fade', requiredUvSets:[0], textures:[] };
const browser = await chromium.launch({channel:'msedge',headless:true}), errors=[];
try {
 const page = await browser.newPage();
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error') errors.push(e.text());});
 await page.route('**/__neck_fixture__/*',route=>route.request().url().endsWith('.json')
  ? route.fulfill({json:manifest}) : route.fulfill({body:code,contentType:'text/plain'}));
 await page.goto('http://127.0.0.1:5173/?outfit=1.eyJzbG90cyI6e319',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__rigIdle);
 const checks = await page.evaluate(async()=>{
  const T=window.__THREE;
  const {loadReconstructedMaterial}=await import('/src/rig/ReconstructedMaterial.ts');
  const {enableSourceSkinning}=await import('/src/rig/SourceMesh.ts');
  const {BodyDecalManager}=await import('/src/rig/BodyDecals.ts');
  const renderer=new T.WebGLRenderer({alpha:true}); renderer.setSize(256,256); renderer.setClearColor(0,0);
  renderer.outputColorSpace=T.LinearSRGBColorSpace;
  const target=new T.WebGLRenderTarget(256,256,{type:T.FloatType,depthBuffer:true});
  const scene=new T.Scene(), camera=new T.OrthographicCamera(-1,1,1,-1,.01,10); camera.position.z=3; camera.updateMatrixWorld(true);
  const geometry=new T.PlaneGeometry(2,2), n=geometry.attributes.position.count;
  const attr=(name,v,Type=T.Float32BufferAttribute)=>geometry.setAttribute(name,new Type(Array.from({length:n},()=>v).flat(),4));
  attr('tangent',[1,0,0,1]); attr('skinIndex',[0,1,2,3],T.Uint16BufferAttribute); attr('skinIndex1',[4,5,6,7],T.Uint16BufferAttribute);
  attr('skinWeight',[0,0,0,0]); attr('skinWeight1',[0,0,0,1]);
  geometry.morphTargetsRelative=true;
  geometry.morphAttributes.position=[new T.Float32BufferAttribute(Array.from({length:n},()=>[.08,.04,0]).flat(),3)];
  // A fully transparent legacy bake must not suppress recovered coverage.
  const legacyMap=new T.DataTexture(new Uint8Array([255,255,255,0]),1,1); legacyMap.needsUpdate=true;
  const mesh=new T.SkinnedMesh(geometry,new T.MeshStandardMaterial({map:legacyMap,alphaTest:.33}));
  const bones=Array.from({length:8},()=>new T.Bone()); scene.add(mesh,...bones);
  mesh.bind(new T.Skeleton(bones,bones.map(()=>new T.Matrix4())),new T.Matrix4()); mesh.frustumCulled=false;
  const recovered=await loadReconstructedMaterial('/__neck_fixture__/manifest.json');
  recovered.apply(mesh,undefined,{boundsOrigin:[0,0,0],preserveAlpha:true}); enableSourceSkinning(mesh);
  const material=mesh.material, coverage={value:1}, reports=[];
  const check=(name,condition,details={})=>{if(!condition)throw new Error(name+' '+JSON.stringify(details));reports.push({name,passed:true,...details});};
  check('source fade replaces baked alpha without a hard cutoff',material.alphaHash && material.alphaTest===0 && !material.transparent && !material.map);
  for(const pass of [material,mesh.customDepthMaterial,mesh.customDistanceMaterial]) {
   const compile=pass.onBeforeCompile;
   pass.toneMapped=false;
   pass.onBeforeCompile=function(shader,r){
    compile.call(this,shader,r); shader.uniforms.testCoverage=coverage;
    shader.fragmentShader=pass===material
     ? shader.fragmentShader.replace('#include <opaque_fragment>','outgoingLight=diffuseColor.rgb;\n#include <opaque_fragment>')
     : shader.fragmentShader.replace(/\n\}\s*$/,'\n gl_FragColor=vec4(1.0);\n}');
   };
  }
  renderer.properties.get(mesh.customDistanceMaterial).light=new T.PointLight();
  const draw=pass=>{mesh.material=pass;renderer.setRenderTarget(target);renderer.render(scene,camera);
   const data=new Float32Array(256*256*4);renderer.readRenderTargetPixels(target,0,0,256,256,data);return data;};
  for(const alpha of [0,.1,.35,.7,1]) {
   coverage.value=alpha; const data=draw(material);let count=0;
   for(let i=0;i<data.length;i+=4)if(data[i+3]>.5)count++;
   check('neck coverage '+alpha,Math.abs(count/65536-alpha)<.025,{actual:count/65536});
  }
  for(const pose of [0,1])for(const alpha of [0,.35,1]) {
   bones[7].position.set(pose*.19,pose*-.11,0);mesh.morphTargetInfluences[0]=pose;coverage.value=alpha;
   const visible=draw(material);
   for(const [name,pass] of [['depth',mesh.customDepthMaterial],['distance',mesh.customDistanceMaterial]]) {
    const shadow=draw(pass);let mismatch=0;
    for(let i=0;i<visible.length;i+=4)if((visible[i+3]>.5)!==(shadow[i+3]>.5))mismatch++;
    check(`${name} matches fade under eighth-bone and morph deformation pose=${pose} alpha=${alpha}`,mismatch===0,{pixels:65536});
   }
  }
  mesh.material=material;bones[7].position.set(0,0,0);mesh.morphTargetInfluences[0]=0;
  const decals=new BodyDecalManager(new T.TextureLoader(),'unused');decals.registerTarget('head',[material]);
  coverage.value=.35;const before=draw(material);
  await decals.set('makeup',{layers:[{target:'head',tint:'#ff0000'}]});const painted=draw(material);
  let mismatch=0,red=0;for(let i=0;i<before.length;i+=4){if(before[i+3]!==painted[i+3])mismatch++;if(painted[i]>0&&painted[i+1]===0)red++;}
  check('makeup preserves gradual coverage',mismatch===0&&red>0,{mismatch});
  decals.clear('makeup');const cleared=draw(material);
  check('clearing makeup preserves gradual coverage',before.every((v,i)=>Math.abs(v-cleared[i])<1e-6));
  // Opaque skin behind the fade must remain visible without transparency holes.
  const back=new T.Mesh(new T.PlaneGeometry(2,2).translate(0,0,-.1),new T.MeshBasicMaterial({color:new T.Color(0,0,1)}));scene.add(back);
  for(const alpha of [0,.35,1]){
   coverage.value=alpha;const pixels=draw(material);let holes=0;
   for(let i=3;i<pixels.length;i+=4)if(pixels[i]<.999)holes++;
   check('body behind fading skin remains opaque alpha='+alpha,holes===0,{holes});
  }
  decals.clearAll();recovered.dispose();geometry.dispose();material.dispose();mesh.skeleton.dispose();
  mesh.customDepthMaterial.dispose();mesh.customDistanceMaterial.dispose();back.geometry.dispose();back.material.dispose();target.dispose();renderer.dispose();
  return reports;
 });
 assert.deepEqual(errors,[]);mkdirSync(output,{recursive:true});writeFileSync(`${output}/adapter-checks.json`,JSON.stringify(checks,null,2));
 console.log(`${checks.length} neck fade, shadow, eight-weight/morph, makeup and opaque-background GPU checks passed`);
} finally {await browser.close();}
