// Real outfit captures for the remaining contracts and unchanged neighboring controls.
// --baseline routes four previously verified Vite modules; HMR is disconnected so the
// implementation worker can continue without changing the reference halfway through a run.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
import { outfitUrl, waitIdle, shoot, swap, watch, classify } from './coverage-preview-harness.mjs';
const base = process.argv.includes('--baseline');
const generated = 'scripts/generated/shader-probe/paint-contracts-astra-v1';
const out = `visual-diff/reconstructed/paint-contracts-${base ? 'before' : 'after'}`;
fs.mkdirSync(out, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file));
const old = read(`${generated}/catalog-before.json`);
const oracle = read('_docs/paint-contracts-2026-09-11/astra-numeric-oracle.json');
const added = [...new Set(oracle.contracts.map(c => c.id))];
const SKIN = { face: 'head-face-01-base', hair: 'hairs-afrofade' };
const controls = old.filter(i => i.slot === 'bodyPaint' && i.decal?.layers.some(l => l.uvLayout === 'sourceBodyPaint'))
  .map(i => ({name:i.id, slots:{bodyPaint:i.id}}));
controls.unshift({name:'bare',slots:{}});
controls.push({name:'eno',slots:{upperBody:'streetwear-tightsinglet-cotton-enorino'}},
  {name:'legacy-singlet',slots:{upperBody:'streetwear-tightsinglet-cotton-black'}},
  {name:'clown',slots:{blush:'bodycosmetics-makeup-clown-01'}},
  {name:'eyes-blue',slots:{eyes:'bodycosmetics-eyes-emissiveblue-02'}});
const report = {at:new Date().toISOString(), baseline:base, comparison:'Exact RGBA pixel comparison', cases:[]};
const raw = p => sharp(p).ensureAlpha().raw().toBuffer();
const diff = async(a,b) => {
  const x=await raw(a),y=await raw(b);assert.equal(x.length,y.length);
  let changed=0;
  for(let p=0;p<x.length;p+=4)if(x[p]!==y[p]||x[p+1]!==y[p+1]||x[p+2]!==y[p+2]||x[p+3]!==y[p+3])changed++;
  return changed;
};
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage({viewport:{width:900,height:1000}});
  await page.routeWebSocket('**/*', socket => socket.close());
  if(base){const modules=read(`${generated}/baseline-modules.json`);
    await page.route(url=>!!modules[new URL(url).pathname], route=>route.fulfill({contentType:'application/javascript',body:modules[new URL(route.request().url()).pathname]}));}
  const log=watch(page);
  await page.goto(outfitUrl(SKIN,{cam:'0,0.95,4.3,0,0.95,0',extra:'&temporal=0'}),{waitUntil:'networkidle'});
  await waitIdle(page);
  for(const c of [...controls,...added.map(id=>({name:id,slots:{bodyPaint:id},added:true}))]){
    await swap(page,{...SKIN,...c.slots});await waitIdle(page);
    const views=[];
    for(let i=0;i<(c.added&&!base?8:1);i++){
      await page.evaluate(a=>{window.__rigRoot.rotation.y=a;window.__rigRoot.updateMatrixWorld(true);},i*Math.PI/4);
      const file=`${c.name}.${i}.png`;await shoot(page,`${out}/${file}`);
      const compareTo=`visual-diff/reconstructed/paint-contracts-before/${c.name}.0.png`;
      const changed=!base&&i===0?await diff(`${out}/${file}`,compareTo):null;
      if(!base&&!c.added)assert.equal(changed,0,`${c.name}: unchanged control has ${changed} changed pixels`);
      views.push({file,angle:i*45,changedPixels:changed});
    }
    let removal=null;
    if(c.added&&!base){await swap(page,SKIN);await waitIdle(page);
      await page.evaluate(()=>{window.__rigRoot.rotation.y=0;window.__rigRoot.updateMatrixWorld(true);});
      await shoot(page,`${out}/${c.name}.removed.png`);
      removal=await diff(`${out}/${c.name}.removed.png`,`${out}/bare.0.png`);assert.equal(removal,0,c.name+' removal');}
    report.cases.push({...c,views,removal});
    fs.writeFileSync(`${generated}/${base?'baseline':'appearance'}-checks.json`,JSON.stringify(report,null,2)+'\n');
    console.log(`${report.cases.length}/35 ${c.name}: ${base?'reference':c.added?'8 views; removal exact':'unchanged exact'}`);
  }
  report.requests=classify(log);
  // We deliberately close the dev-only socket above; this precise diagnostic is expected.
  // Preserve it separately, while every asset, shader and other browser error still fails.
  report.blockedHmrDiagnostics=report.requests.errors.filter(e=>e.startsWith('[vite] failed to connect to websocket.\n'));
  report.requests.errors=report.requests.errors.filter(e=>!report.blockedHmrDiagnostics.includes(e));
  assert.deepEqual(report.requests.errors,[]);assert.deepEqual(report.requests.failedRequests,[]);
  report.passed=true;
}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(`${generated}/${base?'baseline':'appearance'}-checks.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log('PASS: '+(base?'35 reference cases':'27 unchanged controls and eight new paint cases'));
