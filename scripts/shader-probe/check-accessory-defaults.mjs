// Eight-view and source-part acceptance of an additive default-material batch.
// Run from the repo root: APP_URL=http://127.0.0.1:5174 node scripts/shader-probe/check-accessory-defaults.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import sharp from 'sharp';
import {APP_URL,BASE_OUTFIT,outfitUrl,servePreviewIndex,watch,classify,waitIdle,rigState,shoot,read} from './coverage-preview-harness.mjs';
const preview=process.argv[2]??'public/models/reconstructed-accessory-defaults-preview-v1';
const work=process.argv[3]??'scripts/generated/shader-probe/accessory-defaults-v1';
const out=process.argv[4]??'visual-diff/reconstructed/accessory-defaults-astra-v1';
const viewports={width:1100,height:900};
const views=[['front',0],['front-left',Math.PI/4],['left',Math.PI/2],['back-left',3*Math.PI/4],
  ['back',Math.PI],['back-right',-3*Math.PI/4],['right',-Math.PI/2],['front-right',-Math.PI/4]];
const ids=read(`${preview}/preview.json`).implemented;
const supported=new Map(read(`${preview}/supported-items.json`).ready.map(e=>[e.id,e]));
const original=new Map(read('_docs/accessory-defaults-2026-09-12/cohort.json').items.map(e=>[e.id,e]));
fs.mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),app:APP_URL,preview,views,viewport:viewports,cases:[],passed:false,
  meaning:'Real renderer captures and source-part checks. Natural head/body occlusion remains; visual review and human acceptance are separate.'};
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 for(const id of ids){
  const source=original.get(id),expected=supported.get(id),slots={...BASE_OUTFIT,[source.slot]:id};
  const page=await browser.newPage({viewport:viewports});
  const log=watch(page);await servePreviewIndex(page,preview);
  const entry={id,slot:source.slot,views:[],passed:false};report.cases.push(entry);
  try{
   await page.goto(outfitUrl(slots,{cam:'0,1.2,3,0,1.2,0',extra:'&temporal=0'}),{waitUntil:'domcontentloaded'});
   await waitIdle(page);
   entry.bounds=await page.evaluate(id=>{const g=window.__rigRoot?.children.find(c=>c.userData.rigItemId===id);if(!g)return null;const b=new window.__THREE.Box3().setFromObject(g);return b.isEmpty()?null:{min:b.min.toArray(),max:b.max.toArray()}},id);
   assert(entry.bounds,`No visible bounds: ${id}`);
   const {min,max}=entry.bounds,cy=(min[1]+max[1])/2,span=Math.max(max[1]-min[1],Math.max(max[0]-min[0],max[2]-min[2])/(viewports.width/viewports.height))*2.4;
   const distance=Math.max(span/2/Math.tan(28*Math.PI/360),0.7)+(max[2]-min[2])/2;
   entry.camera=`0,${cy},${distance},0,${cy},0`;
   await page.goto(outfitUrl(slots,{cam:entry.camera,extra:'&temporal=0'}),{waitUntil:'domcontentloaded'});await waitIdle(page);
   const state=await rigState(page),item=state.assemblies.find(e=>e.id===id);
   assert(item?.sourceAssembly&&item.groupVisible&&item.visibleMeshes>0,`Missing source assembly ${id}`);
   const originalParts=source.resolved.parts.filter(p=>!p.hidden);
   assert.deepEqual(item.parts.map(p=>p.sourceIndex),originalParts.map(p=>p.sourceIndex),`${id}: all original parts required`);
   assert.equal(item.parts.length,expected.parts.length);
   for(const p of item.parts){
    const want=expected.parts.find(e=>e.sourceIndex===p.sourceIndex),raw=originalParts.find(e=>e.sourceIndex===p.sourceIndex);
    assert.equal(p.sourceMesh,raw.staticMesh||raw.skeletalMesh);
    assert.deepEqual(p.materials.map(m=>m.sourceMaterial).sort(),Object.values(want.materials).map(m=>m.source).sort());
    assert(p.materials.every(m=>m.reconstructed&&m.visible),`${id}: hidden or fallback section`);
   }
   entry.state=item;
   for(const [view,radians] of views){
    await page.evaluate(async a=>{window.__rigRoot.rotation.y=a;window.__rigRoot.updateMatrixWorld(true);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))},radians);
    const file=`${id}.${view}.png`;await shoot(page,path.join(out,file));entry.views.push({view,file});
   }
   entry.requests=classify(log);
   assert.equal(entry.requests.errors.length,0,JSON.stringify(entry.requests.errors));
   assert.equal(entry.requests.failedRequests.length,0,JSON.stringify(entry.requests.failedRequests));
   const delivered=new Set(log.requests.filter(r=>r.outcome==='finished'&&r.status<400).map(r=>new URL(r.url).pathname));
   for(const p of expected.parts){
    for(const url of [p.url,...Object.values(p.materials).map(m=>m.url)]){
     const request=new URL(url,`${APP_URL}/models/reconstructed-assemblies-v1/assets.json`).pathname;
     assert(delivered.has(request),`Required asset never completed: ${request}`);
    }
   }
   entry.passed=true;
  }catch(error){entry.error=String(error)}finally{await page.close()}
  fs.writeFileSync(`${work}/astra-captures.json`,JSON.stringify(report,null,2)+'\n');
  console.log(`${id}: ${entry.passed?'passed':entry.error}`);
 }
 report.passed=report.cases.length===ids.length&&report.cases.every(e=>e.passed&&e.views.length===8);
 for(const e of report.cases){
  if(e.views.length!==8)continue;
  const width=440,height=360,header=24,composite=[];
  for(let i=0;i<e.views.length;i++){
   const v=e.views[i],x=i%4*width,y=Math.floor(i/4)*(height+header);
   composite.push({input:await sharp(path.join(out,v.file)).resize(width,height).toBuffer(),left:x,top:y+header});
   composite.push({input:Buffer.from(`<svg width="${width}" height="${header}"><text x="8" y="17" fill="white" font-family="Arial" font-size="13">${v.view}</text></svg>`),left:x,top:y});
  }
  e.sheet=`${e.id}.eight-views.png`;
  await sharp({create:{width:4*width,height:2*(height+header),channels:4,background:'#161b22'}}).composite(composite).png().toFile(path.join(out,e.sheet));
 }
}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(`${work}/astra-captures.json`,JSON.stringify(report,null,2)+'\n');await browser.close()}
console.log(JSON.stringify({passed:report.passed,items:report.cases.length,views:report.cases.reduce((n,c)=>n+c.views.length,0)}));
if(!report.passed)process.exitCode=1;
