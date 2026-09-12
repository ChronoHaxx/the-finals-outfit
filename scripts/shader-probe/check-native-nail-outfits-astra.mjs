import fs from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {chromium} from 'playwright-core';
import {outfitUrl,waitIdle,shoot,swap,watch,classify,rigState,servePreviewIndex} from './coverage-preview-harness.mjs';
const dir='scripts/generated/shader-probe/native-nails-astra-v1';
const out='visual-diff/reconstructed/native-nails-outfits';
fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(out,{recursive:true});
const base={face:'head-face-01-base',hair:'hairs-afrofade'};
const black='bodycosmetics-nails-black-01',blue='bodycosmetics-nails-blueyellow-01';
const glove='actionhero-sentinelgloves-leather',bandage='cowboy-handcloth-bandage';
const cam='1.03,1.07,0.165,0.633,1.024,0.016';
const report={at:new Date().toISOString(),scope:'Actual Medium A-pose native nails, legacy gloves and source paint',cases:[]};
const raw=p=>sharp(p).ensureAlpha().raw().toBuffer();
async function diff(a,b){const x=await raw(a),y=await raw(b);assert.equal(x.length,y.length);let n=0;for(let i=0;i<x.length;i+=4)if(x[i]!==y[i]||x[i+1]!==y[i+1]||x[i+2]!==y[i+2]||x[i+3]!==y[i+3])n++;return n;}
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:900,height:1000}});
 await page.routeWebSocket('**/*',s=>s.close());
 if(process.argv.includes('--preview'))await servePreviewIndex(page,'public/models/reconstructed-nails-preview-v1');
 const log=watch(page);
 await page.goto(outfitUrl(base,{cam,extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);
 async function capture(id,slots,{visibleNail=null,equal=null,different=null}={}){
  await swap(page,{...base,...slots});await waitIdle(page);
  const file=`${out}/${id}.png`;await shoot(page,file);const state=await rigState(page);
  const nail=state.assemblies.find(a=>a.id===slots.nailPolish);
  if(visibleNail===true){assert.ok(nail?.visibleMeshes>0,id+' expected visible native nails');assert.ok(nail.parts.some(p=>p.sourceMesh==='/Game/Discovery/Characters/Nails/SK_Nails_M.SK_Nails_M'),id+' wrong nail mesh');assert.ok(nail.parts.every(p=>p.materials.every(m=>m.reconstructed)),id+' non-reconstructed material');}
  if(visibleNail===false)assert.ok(!nail||nail.visibleMeshes===0,id+' nails should be suppressed');
  const entry={id,slots,file,state};
  if(equal){entry.equalReference=equal;entry.changedPixels=await diff(file,`${out}/${equal}.png`);assert.equal(entry.changedPixels,0,id+' differs from '+equal);}
  if(different){entry.differentReference=different;entry.changedPixels=await diff(file,`${out}/${different}.png`);assert.ok(entry.changedPixels>0,id+' has no visible effect');}
  report.cases.push(entry);fs.writeFileSync(`${dir}/outfit-checks.json`,JSON.stringify(report,null,2)+'\n');console.log(id);return entry;
 }
 await capture('bare',{});
 await capture('black',{nailPolish:black},{visibleNail:true,different:'bare'});
 await capture('removed',{}, {equal:'bare'});
 await capture('glove',{hands:glove});
 await capture('glove-black',{hands:glove,nailPolish:black},{visibleNail:false,equal:'glove'});
 await capture('glove-removed',{nailPolish:black},{visibleNail:true,equal:'black'});
 await capture('bandage',{hands:bandage});
 await capture('bandage-black',{hands:bandage,nailPolish:black},{visibleNail:true,different:'bandage'});
 await capture('nails-removed-bandage',{hands:bandage},{equal:'bandage'});
 const paint='bodycosmetics-bodypaint-runnyfingersgold-01';
 await capture('paint',{bodyPaint:paint});
 await capture('paint-black',{bodyPaint:paint,nailPolish:black},{visibleNail:true,different:'paint'});
 await capture('nails-removed-paint',{bodyPaint:paint},{equal:'paint'});
 await capture('blue-yellow',{nailPolish:blue},{visibleNail:true,different:'black'});
 await capture('blue-to-black',{nailPolish:black},{visibleNail:true,equal:'black'});
 for(let i=0;i<5;i++){await swap(page,{...base,nailPolish:i%2?black:blue});await waitIdle(page);}
 await capture('swaps-removed',{}, {equal:'bare'});
 await page.goto(outfitUrl({...base,nailPolish:black},{cam,extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);
 await capture('black-reloaded',{nailPolish:black},{visibleNail:true,equal:'black'});
 // The first source nail mesh must follow finger bones outside its rest pose too.
 await page.goto(outfitUrl({...base,nailPolish:blue},{cam:'0,0.95,4.3,0,0.95,0',pose:'idle',extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);
 const idleHands=await page.evaluate(()=>{
  const positions=[];window.__rigRoot.updateMatrixWorld(true);
  window.__rigRoot.traverse(o=>{if(!o.isMesh||o.userData.sourceMesh!=='/Game/Discovery/Characters/Nails/SK_Nails_M.SK_Nails_M')return;
   for(let i=0;i<o.geometry.attributes.position.count;i++){const p=o.position.clone();o.getVertexPosition(i,p);o.localToWorld(p);positions.push([p.x,p.y,p.z]);}});
  if(!positions.length)throw new Error('No native vertices in idle pose');
  return [-1,1].map(sign=>{const p=positions.filter(v=>v[0]*sign>0);const center=[0,1,2].map(i=>(Math.min(...p.map(v=>v[i]))+Math.max(...p.map(v=>v[i])))/2);return {sign,center,vertices:p.length,cam:[center[0]+sign*.40,center[1]+.05,center[2]+.15,...center].join(',')};});
 });
 for(const hand of idleHands){await page.goto(outfitUrl({...base,nailPolish:blue},{cam:hand.cam,pose:'idle',extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);const file=`${out}/idle-${hand.sign<0?'left':'right'}.png`;await shoot(page,file);report.cases.push({id:'idle-hand',...hand,file,state:await rigState(page)});}
 report.requests=classify(log);report.blockedHmrDiagnostics=report.requests.errors.filter(e=>e.startsWith('[vite] failed to connect to websocket.\n'));report.requests.errors=report.requests.errors.filter(e=>!report.blockedHmrDiagnostics.includes(e));
 assert.deepEqual(report.requests.errors,[]);assert.deepEqual(report.requests.failedRequests,[]);report.passed=true;
}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(`${dir}/outfit-checks.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
