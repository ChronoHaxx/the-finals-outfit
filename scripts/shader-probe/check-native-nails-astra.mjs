// Independent actual-app captures. Requirements: native geometry, distinct designs,
// no skin tint, exact removal, and preserved neighboring cosmetics. Review is separate.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {chromium} from 'playwright-core';
import {outfitUrl,waitIdle,shoot,swap,watch,classify,rigState,servePreviewIndex} from './coverage-preview-harness.mjs';
const baseline=process.argv.includes('--baseline');
const cameraOnly=process.argv.includes('--frame-check');
const preview=process.argv.includes('--preview');
const all=process.argv.includes('--all');
const run='scripts/generated/shader-probe/native-nails-astra-v1';
const out=`visual-diff/reconstructed/native-nails-${baseline?'before':'after'}`;
fs.mkdirSync(run,{recursive:true});fs.mkdirSync(out,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const SKIN={face:'head-face-01-base',hair:'hairs-afrofade'};
const controls=[{id:'bare',slots:{}},{id:'eno',slots:{upperBody:'streetwear-tightsinglet-cotton-enorino'}},
 {id:'legacy-singlet',slots:{upperBody:'streetwear-tightsinglet-cotton-black'}},
 {id:'sweat',slots:{bodyPaint:'bodycosmetics-bodypaint-sweat-01'}},
 {id:'techwear',slots:{bodyPaint:'bodycosmetics-bodypaint-techwearsymbols-01'}},
 {id:'runny-gold',slots:{bodyPaint:'bodycosmetics-bodypaint-runnyfingersgold-01'}},
 {id:'clown',slots:{blush:'bodycosmetics-makeup-clown-01'}},
 {id:'eyes',slots:{eyes:'bodycosmetics-eyes-emissiveblue-02'}}];
const cameras={full:'0,0.95,4.3,0,0.95,0',right:'1.03,1.07,0.165,0.633,1.024,0.016',left:'-1.03,1.07,0.165,-0.633,1.024,0.016',rightBack:'0.90,1.11,-0.28,0.633,1.024,0.016'};
const samples=all?read(`${preview?'public/models/reconstructed-nails-preview-v1':'public/models/reconstructed-assemblies-v1'}/supported-items.json`).items.filter(id=>id.startsWith('bodycosmetics-nails-')):['bodycosmetics-nails-black-01','bodycosmetics-nails-blue-01','bodycosmetics-nails-alfaacta-01'];
if(all){assert.ok(!baseline,'The old renderer has no native nail cohort');assert.ok(samples.length>0,'No native nail candidates');}
const raw=p=>sharp(p).ensureAlpha().raw().toBuffer();
async function diff(a,b){const x=await raw(a),y=await raw(b);assert.equal(x.length,y.length);let changed=0;for(let p=0;p<x.length;p+=4)if(x[p]!==y[p]||x[p+1]!==y[p+1]||x[p+2]!==y[p+2]||x[p+3]!==y[p+3])changed++;return changed;}
const report={at:new Date().toISOString(),baseline,preview,cameraOnly,all,nailIds:samples,scope:'Medium Face01 A pose, fixed preview lighting, temporal off',cases:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:900,height:1000}});
 await page.routeWebSocket('**/*',socket=>socket.close());
 if(baseline){
  const modules=read('_docs/native-nails-2026-09-11/baseline/vite-modules.json');
  await page.route(url=>!!modules[new URL(url).pathname],r=>r.fulfill({contentType:'application/javascript',body:modules[new URL(r.request().url()).pathname]}));
  const dir='_docs/native-nails-2026-09-11/baseline';
  for(const name of ['assets.json','supported-items.json','skin-pairs.json'])await page.route(`**/models/reconstructed-assemblies-v1/${name}`,r=>r.fulfill({contentType:'application/json',body:fs.readFileSync(`${dir}/${name}`,'utf8')}));
 }else if(preview)await servePreviewIndex(page,'public/models/reconstructed-nails-preview-v1');
 const log=watch(page);
 for(const [view,cam] of Object.entries(cameras)){
  if(cameraOnly&&view==='full')continue;
  await page.goto(outfitUrl(SKIN,{cam,extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);
  const viewIds=all&&view==='rightBack'?samples.filter(id=>/black-01|blueyellow|alfaacta|metallic$|flag-spain|dots-blackwhite|solidsplit/.test(id)):samples;
  const cases=view==='full'&&!cameraOnly?controls:[{id:'bare',slots:{}},...viewIds.map(id=>({id,slots:{nailPolish:id}}))];
  for(const c of cases){
   await swap(page,{...SKIN,...c.slots});await waitIdle(page);
   const file=`${c.id}.${view}.png`;await shoot(page,`${out}/${file}`);
   const entry={id:c.id,view,cam,file,state:await rigState(page)};
   if(!baseline&&c.slots.nailPolish){const native=entry.state.assemblies.find(a=>a.id===c.id);assert.ok(native?.visibleMeshes>0,`${c.id}: no visible source nails`);assert.ok(native.parts.some(p=>p.sourceMesh==='/Game/Discovery/Characters/Nails/SK_Nails_M.SK_Nails_M'),`${c.id}: wrong source mesh`);assert.ok(native.parts.every(p=>p.materials.every(m=>m.reconstructed)),`${c.id}: incomplete source material`);}
   if(!baseline&&!c.slots.nailPolish){entry.changedPixels=await diff(`${out}/${file}`,`visual-diff/reconstructed/native-nails-before/${file}`);assert.equal(entry.changedPixels,0,`${c.id}/${view} control changed`);}
   report.cases.push(entry);console.log(`${c.id}/${view}`);
   fs.writeFileSync(`${run}/${baseline?'baseline':'appearance'}${cameraOnly?'-framing':''}.json`,JSON.stringify(report,null,2)+'\n');
  }
 }
 report.requests=classify(log);report.blockedHmrDiagnostics=report.requests.errors.filter(e=>e.startsWith('[vite] failed to connect to websocket.\n'));
 report.requests.errors=report.requests.errors.filter(e=>!report.blockedHmrDiagnostics.includes(e));
 assert.deepEqual(report.requests.errors,[]);assert.deepEqual(report.requests.failedRequests,[]);report.passed=true;
}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(`${run}/${baseline?'baseline':'appearance'}${cameraOnly?'-framing':''}.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
