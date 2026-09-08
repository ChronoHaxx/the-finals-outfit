// Compare the actual decoded eye-depth texture with the GPU's native BC6H decoder.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const sourceBase='/scripts/generated/shader-probe/reference-details-01/textures-v2';
const materialBase='/models/reconstructed-details-v2';
const source=JSON.parse(readFileSync('scripts/generated/shader-probe/reference-details-01/textures-v2/textures.json','utf8'))
  .find(t=>t.format==='PF_BC6H');
assert(source);
const browser=await chromium.launch({channel:'msedge',headless:true}), errors=[];
try {
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error') errors.push(e.text());});
  await page.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle'});
  const report=await page.evaluate(async ({source,sourceBase,materialBase})=>{
    const T=window.__THREE;
    const {loadReconstructedMaterial}=await import('/src/rig/ReconstructedMaterial.ts');
    const renderer=new T.WebGLRenderer();
    if(!renderer.extensions.has('EXT_texture_compression_bptc')) {
      renderer.dispose(); return {available:false,reason:'Native BPTC texture decoding is unavailable on this GPU'};
    }
    const descriptor=await (await fetch(`${materialBase}/eyes-face-01.json`)).json();
    const spec=descriptor.textures.find(t=>t.sourceFormat==='PF_BC6H');
    const geometry=new T.PlaneGeometry(2,2);
    geometry.setAttribute('tangent',new T.Float32BufferAttribute(Array.from({length:4},()=>[1,0,0,1]).flat(),4));
    const mesh=new T.Mesh(geometry,new T.MeshPhysicalMaterial());
    const recovered=await loadReconstructedMaterial(`${materialBase}/eyes-face-01.json`);
    recovered.apply(mesh,undefined,{boundsOrigin:[0,0,0]});
    const decoded=mesh.material.userData[spec.id];
    const originalMips=[];
    for(const mip of source.mips) {
      const bytes=await (await fetch(`${sourceBase}/${mip.file}`)).arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(hash.toUpperCase()!==mip.sha256) throw new Error('Source compressed mip hash mismatch');
      originalMips.push({width:mip.width,height:mip.height,data:new Uint8Array(bytes)});
    }
    const original=new T.CompressedTexture(originalMips,source.mips[0].width,source.mips[0].height,T.RGB_BPTC_UNSIGNED_Format);
    for(const texture of [decoded,original]) {
      texture.minFilter=T.NearestMipmapNearestFilter; texture.magFilter=T.NearestFilter;
      texture.wrapS=T.ClampToEdgeWrapping; texture.wrapT=T.ClampToEdgeWrapping;
      texture.flipY=false; texture.generateMipmaps=false; texture.needsUpdate=true;
    }
    const uniforms={sourceTexture:{value:original},level:{value:0},dimensions:{value:new T.Vector2()}};
    const material=new T.RawShaderMaterial({glslVersion:T.GLSL3,uniforms,
      vertexShader:'in vec3 position; void main(){gl_Position=vec4(position,1);}',
      fragmentShader:'precision highp float; uniform sampler2D sourceTexture; uniform float level; uniform vec2 dimensions; out vec4 result; void main(){result=textureLod(sourceTexture,gl_FragCoord.xy/dimensions,level);}'});
    const scene=new T.Scene(),camera=new T.Camera(), target=new T.WebGLRenderTarget(1,1,{type:T.FloatType,depthBuffer:false});
    scene.add(new T.Mesh(geometry,material));
    const checks=[];
    for(const [level,mip] of source.mips.entries()) {
      uniforms.level.value=level; uniforms.dimensions.value.set(mip.width,mip.height); target.setSize(mip.width,mip.height);
      const renders=[];
      for(const texture of [original,decoded]) {
        uniforms.sourceTexture.value=texture; renderer.setRenderTarget(target); renderer.render(scene,camera);
        const pixels=new Float32Array(mip.width*mip.height*4); renderer.readRenderTargetPixels(target,0,0,mip.width,mip.height,pixels); renders.push(pixels);
      }
      let maxError=0;
      for(let i=0;i<renders[0].length;i++) {
        const error=Math.abs(renders[0][i]-renders[1][i]);
        if(!Number.isFinite(error)||error>3e-5) throw new Error(`BC6H mip=${level} component=${i}: ${renders[0][i]} != ${renders[1][i]}`);
        maxError=Math.max(maxError,error);
      }
      checks.push({level,width:mip.width,height:mip.height,pixels:mip.width*mip.height,maxError,passed:true});
    }
    original.dispose(); recovered.dispose(); mesh.material.dispose(); geometry.dispose(); material.dispose(); target.dispose(); renderer.dispose();
    return {available:true,decoder:source.mips[0].decoded.decoder,source:source.path,checks};
  },{source,sourceBase,materialBase});
  assert.deepEqual(errors,[]);
  writeFileSync('scripts/generated/shader-probe/reference-details-01/hdr-gpu-checks.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
