// Disposable diagnosis: retain skin material, lighting and fitting; neutralize only its coverage sampler.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {outfitUrl,waitIdle,servePreviewIndex,shoot,watch,classify} from './coverage-preview-harness.mjs';
const [configFile,dir]=process.argv.slice(2);
assert(configFile&&dir,'Usage: capture-mask-controls.mjs CONFIG NEW_OUTPUT');
const {cases}=JSON.parse(fs.readFileSync(configFile,'utf8'));
assert(Array.isArray(cases)&&cases.length>0);
assert(new Set(cases.map(c=>c.id)).size===cases.length);
for(const c of cases){
 assert(typeof c.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(c.id));
 assert(typeof c.preview==='string'&&c.preview.startsWith('public/models/')&&!c.preview.split('/').includes('..'));
 assert(c.slots&&Object.values(c.slots).every(v=>typeof v==='string'&&v.length));
 assert(typeof c.camera==='string'&&c.camera.split(',').length===6&&c.camera.split(',').every(v=>v.trim()&&Number.isFinite(Number(v))));
}
assert(!fs.existsSync(dir));fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const report={at:new Date().toISOString(),scope:'Local disposable mask-only isolation; no source/runtime file mutation.',passed:false,cases:[]};
try{for(const c of cases){
 const page=await browser.newPage({viewport:{width:1100,height:850}}),log=watch(page);
 await servePreviewIndex(page,c.preview);
 const slots=c.slots;
 await page.goto(outfitUrl(slots,{cam:c.camera,extra:'&temporal=0'}).replace('/?','/thesecret-dev-mode-ganyu-only/?'),{waitUntil:'domcontentloaded'});await waitIdle(page);
 await shoot(page,`${dir}/${c.id}-original.png`);
 const before=await page.evaluate(()=>{
  const body=window.__rigRoot.getObjectsByProperty('isSkinnedMesh',true).find(m=>m.userData.sourceBody),mat=body.material;
  const prior=mat.onBeforeCompile, key=mat.customProgramCacheKey();
  const zero=new window.__THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);zero.needsUpdate=true;
  window.__maskOnly={uniformFound:false,body,mat,weights:[...body.morphTargetInfluences]};
  mat.onBeforeCompile=function(shader,renderer){prior.call(this,shader,renderer);if(shader.uniforms.uBodyHide){shader.uniforms.uBodyHide.value=zero;window.__maskOnly.uniformFound=true;}};
  mat.customProgramCacheKey=()=>key+':mask-only-diagnostic';mat.needsUpdate=true;
  return {material:mat.name,morphNames:body.morphTargetDictionary,weights:[...body.morphTargetInfluences]};
 });
 await page.waitForFunction(()=>window.__maskOnly.uniformFound);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await shoot(page,`${dir}/${c.id}-mask-zero.png`);
 const after=await page.evaluate(()=>({uniformFound:window.__maskOnly.uniformFound,material:window.__maskOnly.body.material.name,weights:[...window.__maskOnly.body.morphTargetInfluences]}));
 assert.deepEqual(after.weights,before.weights);assert.equal(after.material,before.material);
 const requests=classify(log);assert(!requests.errors.length&&!requests.failedRequests.length);
 report.cases.push({id:c.id,slots,camera:c.camera,before,after,requests});await page.close();
}report.passed=true;}finally{fs.writeFileSync(`${dir}/report.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({cases:report.cases.length,report:`${dir}/report.json`}));
