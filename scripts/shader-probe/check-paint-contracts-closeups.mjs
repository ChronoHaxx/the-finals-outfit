// Extra views for details too small to judge in the eight-angle full-body sheets.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {chromium} from 'playwright-core';
import {outfitUrl,waitIdle,shoot,watch,classify} from './coverage-preview-harness.mjs';
const dir='scripts/generated/shader-probe/paint-contracts-astra-v1',out='visual-diff/reconstructed/paint-contracts-after';
const catalog=JSON.parse(fs.readFileSync('src/data/items.json'));
const ids=[...new Set(JSON.parse(fs.readFileSync('_docs/paint-contracts-2026-09-11/astra-numeric-oracle.json')).contracts.map(c=>c.id))];
const cases=ids.map(id=>({id,
  cam:id.includes('sweat')?'0,1.57,1.15,0,1.57,0':id.includes('techwear')?'-1.35,1.4,0.5,-0.3,1.4,0':'0.58,1.12,1.1,0.58,1.12,0',
  angles:id.includes('techwear')?[0]:id.includes('sweat')?[0,Math.PI/4]:[0,Math.PI]}));
const browser=await chromium.launch({channel:'msedge',headless:true});
const report={at:new Date().toISOString(),cases:[]};
try{
  const page=await browser.newPage({viewport:{width:900,height:1000}});
  await page.routeWebSocket('**/*',socket=>socket.close());const log=watch(page);
  for(const c of cases){
    await page.goto(outfitUrl({face:'head-face-01-base',hair:'hairs-afrofade',bodyPaint:c.id},{cam:c.cam,extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);
    const files=[];
    for(let i=0;i<c.angles.length;i++){
      await page.evaluate(a=>{window.__rigRoot.rotation.y=a;window.__rigRoot.updateMatrixWorld(true);},c.angles[i]);
      const file=`${c.id}.close-${i}.png`;await shoot(page,`${out}/${file}`);files.push(file);
    }
    const item=catalog.find(i=>i.id===c.id);
    const label=Buffer.from(`<svg width="${300+450*files.length}" height="40"><rect width="100%" height="100%" fill="#161b22"/><text x="12" y="26" font-family="Arial" font-size="20" fill="white">${item.name}</text></svg>`);
    const composites=[{input:label,left:0,top:0},{input:await sharp(`public/${item.imageUrl}`).resize(300,500,{fit:'contain',background:'#d5dce2'}).png().toBuffer(),left:0,top:40}];
    for(let i=0;i<files.length;i++)composites.push({input:await sharp(`${out}/${files[i]}`).resize(450,500).png().toBuffer(),left:300+i*450,top:40});
    await sharp({create:{width:300+450*files.length,height:540,channels:4,background:'#161b22'}}).composite(composites).png().toFile(`${out}/${c.id}.close-sheet.png`);
    report.cases.push({...c,files});console.log(`${c.id}: ${files.length} closeups`);
  }
  report.requests=classify(log);report.blockedHmrDiagnostics=report.requests.errors.filter(e=>e.startsWith('[vite] failed to connect to websocket.\n'));
  report.requests.errors=report.requests.errors.filter(e=>!report.blockedHmrDiagnostics.includes(e));
  assert.deepEqual(report.requests.errors,[]);assert.deepEqual(report.requests.failedRequests,[]);report.passed=true;
}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(`${dir}/closeup-checks.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
