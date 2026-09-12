// Actual Crosses artwork before/after effective-sampler recovery, both hands.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {chromium} from 'playwright-core';
import {outfitUrl,waitIdle,shoot,swap,watch,classify,servePreviewIndex} from './coverage-preview-harness.mjs';
const id='bodycosmetics-nails-crosses-01', base={face:'head-face-01-base',hair:'hairs-afrofade'};
const out='visual-diff/reconstructed/native-nails-sampler';fs.mkdirSync(out,{recursive:true});
const cameras={left:'1.03,1.07,0.165,0.633,1.024,0.016',right:'-1.03,1.07,0.165,-0.633,1.024,0.016'};
const report={at:new Date().toISOString(),cases:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 for(const [hand,cam] of Object.entries(cameras)){
  const page=await browser.newPage({viewport:{width:900,height:1000}});
  await page.routeWebSocket('**/*',s=>s.close());await servePreviewIndex(page,'public/models/reconstructed-nails-preview-v1');const log=watch(page);
  await page.goto(outfitUrl({...base,nailPolish:id},{cam,extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);
  await shoot(page,`${out}/${hand}.png`);
  const oldHand=hand==='left'?'right':'left';
  const before=await sharp(`visual-diff/reconstructed/native-nails-after/${id}.${oldHand}.png`).ensureAlpha().raw().toBuffer();
  const after=await sharp(`${out}/${hand}.png`).ensureAlpha().raw().toBuffer();assert.equal(before.length,after.length);
  let changed=0;for(let p=0;p<before.length;p+=4)if(!before.subarray(p,p+4).equals(after.subarray(p,p+4)))changed++;
  assert.ok(changed>50,`${hand}: missing pattern unchanged`);
  await swap(page,base);await waitIdle(page);await shoot(page,`${out}/${hand}-removed.png`);
  const removed=await sharp(`${out}/${hand}-removed.png`).ensureAlpha().raw().toBuffer();
  const bare=await sharp(`visual-diff/reconstructed/native-nails-before/bare.${oldHand}.png`).ensureAlpha().raw().toBuffer();
  assert.ok(removed.equals(bare),`${hand}: skin changed after removal`);
  const requests=classify(log);requests.errors=requests.errors.filter(e=>!e.startsWith('[vite] failed to connect to websocket.\n'));
  assert.deepEqual(requests.errors,[]);assert.deepEqual(requests.failedRequests,[]);
  report.cases.push({hand,changedPixels:changed,exactRemoval:true,requests});await page.close();
 }
 report.passed=true;
}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync('scripts/generated/shader-probe/native-nails-astra-v1/sampler-checks.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
