// Numerical GPU acceptance from the independently frozen source oracle. Layer metadata comes
// through the catalog's public contract; expected pixels do not call implementation helpers.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
const generated='scripts/generated/shader-probe/paint-contracts-astra-v1';
const oracle=JSON.parse(fs.readFileSync('_docs/paint-contracts-2026-09-11/astra-numeric-oracle.json'));
const catalog=JSON.parse(fs.readFileSync('src/data/items.json'));
const png=async(bytes)=>'data:image/png;base64,'+(await sharp(Buffer.from(bytes),{raw:{width:bytes.length/4,height:1,channels:4}}).png().toBuffer()).toString('base64');
const fixtures={color:await png(oracle.colourBytes.flat()),surface:await png(oracle.surfaceBytes)};
const tests=oracle.contracts.map(c=>{
  const layer=catalog.find(i=>i.id===c.id)?.decal?.layers.find(l=>l.target===c.target);
  assert(layer?.colorPath?.startsWith('models/reconstructed-paint-contracts-v1/'),c.id+' not activated by new scoped preparer');
  // The product forwards the remaining source fields; replace only asset paths with fixtures.
  const {colorPath,surfacePath,maskPath,...fields}=layer;
  assert(!maskPath,c.id+' should use source colour alpha, not the legacy guessed mask');
  return {...c,layer:{...fields,colorUrl:fixtures.color,...(surfacePath?{surfaceUrl:fixtures.surface}:{})}};
});
const baseline=process.argv.includes('--old-renderer');
const browser=await chromium.launch({channel:'msedge',headless:true});
let report;
try{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.routeWebSocket('**/*',socket=>socket.close());
  if(baseline){const modules=JSON.parse(fs.readFileSync(`${generated}/baseline-modules.json`));
    await page.route(url=>new URL(url).pathname==='/src/rig/BodyDecals.ts',route=>route.fulfill({contentType:'application/javascript',body:modules['/src/rig/BodyDecals.ts']}));}
  await page.goto('http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});
  report=await page.evaluate(async({tests,oracle})=>{
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const {BodyDecalManager}=await import('/src/rig/BodyDecals.ts');
    const samples=[...oracle.sampleU.map(u=>({u,v:oracle.sampleRawV})),{u:0.5,v:1},{u:0.5,v:0},{u:0.5,v:-0.5}];
    const renderer=new THREE.WebGLRenderer();renderer.setSize(samples.length,1);
    renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
    const scene=new THREE.Scene();const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const rows=[];
    for(const reconstructed of [false,true])for(const c of tests)for(const mode of ['colour','surface']){
      const mat=new THREE.MeshStandardMaterial({color:new THREE.Color(...oracle.baseLinear),roughness:oracle.baseSurface[0],metalness:oracle.baseSurface[1]});
      mat.userData.reconstructed=reconstructed;
      let baseCalls=0;
      mat.onBeforeCompile=shader=>{
        baseCalls++;
        if(reconstructed)shader.fragmentShader=shader.fragmentShader
          .replace('#include <map_fragment>','struct ProbeSurface { float roughness; float metalness; };\nProbeSurface recovered = ProbeSurface(0.2,0.4);\n// recovered_surface_ready')
          .replace('#include <roughnessmap_fragment>','float roughnessFactor = recovered.roughness;')
          .replace('#include <metalnessmap_fragment>','float metalnessFactor = recovered.metalness;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',mode==='colour'
          ?'gl_FragColor=vec4(diffuseColor.rgb,1.0);':'gl_FragColor=vec4(roughnessFactor,metalnessFactor,0.0,1.0);')
          .replace('#include <tonemapping_fragment>','').replace('#include <colorspace_fragment>','')
          .replace('#include <fog_fragment>','').replace('#include <premultiplied_alpha_fragment>','').replace('#include <dithering_fragment>','');
      };
      const meshes=[];
      for(let i=0;i<samples.length;i++){
        const s=samples[i],g=new THREE.PlaneGeometry(2/samples.length,2);
        const uv=g.getAttribute('uv'),extra=new Float32Array(uv.count*2);
        const rawU=(s.u-c.offset)/c.scale;
        for(let j=0;j<uv.count;j++){
          uv.setXY(j,c.uv===0?rawU:-10,c.uv===0?s.v:-10);
          extra[2*j]=c.uv===1?rawU:-10;extra[2*j+1]=c.uv===1?s.v:-10;
        }
        g.setAttribute('uv1',new THREE.BufferAttribute(extra,2));
        const mesh=new THREE.Mesh(g,mat);mesh.position.x=-1+(2*i+1)/samples.length;scene.add(mesh);meshes.push(mesh);
      }
      const decals=new BodyDecalManager(new THREE.TextureLoader(),'unused-nail-mask');
      decals.registerTarget(c.target,[mat]);await decals.set('bodyPaint',{layers:[c.layer]});
      const rt=new THREE.WebGLRenderTarget(samples.length,1);
      const pixels=()=>{renderer.setRenderTarget(rt);renderer.render(scene,camera);const bytes=new Uint8Array(samples.length*4);renderer.readRenderTargetPixels(rt,0,0,samples.length,1,bytes);return [...bytes];};
      const applied=pixels();decals.clear('bodyPaint');const cleared=pixels();
      rows.push({id:c.id,target:c.target,reconstructed,mode,applied,cleared,baseCalls});
      decals.clearAll();for(const m of meshes){scene.remove(m);m.geometry.dispose();}mat.dispose();rt.dispose();
    }
    renderer.dispose();return {samples,rows};
  },{tests,oracle});
  report.errors=errors.filter(e=>!e.startsWith('[vite] failed to connect to websocket.\n'));
  const clamp=v=>Math.max(0,Math.min(1,v));
  const linear=v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
  const colour=oracle.colourBytes[0].slice(0,3).map(v=>linear(v/255));
  const failures=[];
  for(const row of report.rows){
    const c=oracle.contracts.find(c=>c.id===row.id&&c.target===row.target);
    assert(row.baseCalls>=1,'Base material callback lost');
    for(let i=0;i<report.samples.length;i++){
      const s=report.samples[i],v=s.v-Math.floor(s.v),g=s.u>0&&s.u<1&&v>0&&v<1?1:0;
      const index=Math.max(0,Math.min(2,Math.floor(s.u*3))),alpha=oracle.colourBytes[index][3]/255;
      const a=g*alpha;
      const expected=row.mode==='surface'?[...oracle.baseSurface.map((b,k)=>
        (c.surface?b*(1-a)+(oracle.surfaceBytes[k+2]/255)*a:b)*255),0,255]
        :[...oracle.baseLinear.map((b,k)=>{
          const ink=colour[k];
          const product=c.kind==='tattoo'?b*(1+g*(ink-1)):b*clamp(ink+1-clamp(a+g*c.nonMasked));
          const target=c.kind==='tattoo'?1+g*(ink-1):ink;
          return (product*(1-a*c.override)+target*a*c.override)*255;
        }),255];
      const clear=row.mode==='colour'?[...oracle.baseLinear.map(v=>v*255),255]:[...oracle.baseSurface.map(v=>v*255),0,255];
      for(let ch=0;ch<4;ch++){
        if(Math.abs(row.applied[i*4+ch]-expected[ch])>2)failures.push({id:row.id,target:row.target,mode:row.mode,reconstructed:row.reconstructed,sample:i,channel:ch,actual:row.applied[i*4+ch],expected:expected[ch]});
        assert(Math.abs(row.cleared[i*4+ch]-clear[ch])<=1,`${row.id}: clear changed base ${row.mode}`);
      }
    }
  }
  report.failures=failures;report.oldRenderer=baseline;assert.deepEqual(report.errors,[],'Browser/shader errors');
  if(baseline){assert(failures.length>0,'Old renderer unexpectedly passes new source contracts');report.oldBehaviourFailureConfirmed=true;}
  else assert.deepEqual(failures,[],'Source formula GPU mismatch');
  report.passed=!baseline;
}finally{if(report)fs.writeFileSync(`${generated}/numeric-${baseline?'old':'new'}-checks.json`,JSON.stringify({at:new Date().toISOString(),...report},null,2)+'\n');await browser.close();}
console.log(`${baseline?'EXPECTED OLD FAILURE':'PASS'}: ${report.rows.length} numeric cases on standard and reconstructed paths; ${report.failures.length} mismatched channels.`);
