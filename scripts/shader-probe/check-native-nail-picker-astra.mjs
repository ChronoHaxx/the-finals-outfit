// Real picker input, not only store calls; final status counts follow the reviewed index.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {outfitUrl,waitIdle,watch,classify,rigState,servePreviewIndex} from './coverage-preview-harness.mjs';
const dir='scripts/generated/shader-probe/native-nails-astra-v1';
fs.mkdirSync(dir,{recursive:true});
const catalog=JSON.parse(fs.readFileSync('src/data/items.json'));
const preview=process.argv.includes('--preview');
const supported=JSON.parse(fs.readFileSync(`${preview?'public/models/reconstructed-nails-preview-v1':'public/models/reconstructed-assemblies-v1'}/supported-items.json`)).items.filter(id=>id.startsWith('bodycosmetics-nails-'));
const ids=['bodycosmetics-nails-black-01','bodycosmetics-nails-blueyellow-01','bodycosmetics-nails-alfaacta-01'];
const base={face:'head-face-01-base',hair:'hairs-afrofade'};
const cam='1.03,1.07,0.165,0.633,1.024,0.016';
const report={at:new Date().toISOString(),preview,equipped:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});
 await page.routeWebSocket('**/*',s=>s.close());if(preview)await servePreviewIndex(page,'public/models/reconstructed-nails-preview-v1');
 const log=watch(page);
 const tile=id=>page.locator('[aria-label="Cosmetic results"] button').filter({has:page.locator(`img[alt="${catalog.find(i=>i.id===id).name}"]`)});
 const nailTab=()=>page.getByRole('button',{name:/^Nail Polish\s*124$/}).click();
 await page.goto(outfitUrl(base,{cam,extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);await nailTab();
 const statuses=await page.locator('[aria-label="Cosmetic results"] [data-reconstruction-status]').evaluateAll(els=>els.map(e=>e.dataset.reconstructionStatus));
 report.statuses=Object.fromEntries(['untouched','polish','issue','accepted'].map(s=>[s,statuses.filter(x=>x===s).length]));
 assert.equal(report.statuses.polish,supported.length);assert.equal(report.statuses.accepted,0,'No new green claim');
 for(const id of ids){
  await page.locator('input[placeholder^="Search"]').fill(catalog.find(i=>i.id===id).name);
  assert.equal(await tile(id).locator('[data-reconstruction-status]').getAttribute('data-reconstruction-status'),'polish');
  await page.evaluate(()=>{window.__rigIdle=false;});await tile(id).click();await waitIdle(page);
  assert.equal(await tile(id).getAttribute('aria-pressed'),'true');
  assert.ok((await rigState(page)).assemblies.some(a=>a.id===id&&a.visibleMeshes>0));report.equipped.push(id);
 }
 await page.evaluate(()=>{window.__rigIdle=false;});await tile(ids.at(-1)).click();await waitIdle(page);assert.equal(await tile(ids.at(-1)).getAttribute('aria-pressed'),'false');report.removePassed=true;
 await page.locator('input[placeholder^="Search"]').fill('');await page.getByRole('button',{name:/^3D only/}).click();
 for(const id of ids)assert.equal(await tile(id).count(),1);report.filterPassed=true;
 await page.goto(outfitUrl({...base,nailPolish:ids[1]},{cam,extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);await page.reload({waitUntil:'networkidle'});await waitIdle(page);await nailTab();assert.equal(await tile(ids[1]).getAttribute('aria-pressed'),'true');report.linkReloadPassed=true;
 await page.screenshot({path:'visual-diff/reconstructed/native-nails-after/picker.png',fullPage:true});
 await page.getByRole('button',{name:/^Hands\s*227$/}).click();
 const glove='actionhero-sentinelgloves-leather';await page.locator('input[placeholder^="Search"]').fill(catalog.find(i=>i.id===glove).name);
 await page.evaluate(()=>{window.__rigIdle=false;});await tile(glove).click();await waitIdle(page);
 let nail=(await rigState(page)).assemblies.find(a=>a.id===ids[1]);assert.ok(!nail||nail.visibleMeshes===0);report.gloveHidePassed=true;
 await page.evaluate(()=>{window.__rigIdle=false;});await tile(glove).click();await waitIdle(page);
 nail=(await rigState(page)).assemblies.find(a=>a.id===ids[1]);assert.ok(nail?.visibleMeshes>0);report.gloveRestorePassed=true;
 await page.getByRole('button',{name:/^Body Paint\s*30$/}).click();await page.locator('input[placeholder^="Search"]').fill('Sweat');assert.equal(await tile('bodycosmetics-bodypaint-sweat-01').locator('[data-reconstruction-status]').getAttribute('data-reconstruction-status'),'issue');report.priorIssueRetained=true;
 report.requests=classify(log);report.blockedHmrDiagnostics=report.requests.errors.filter(e=>e.startsWith('[vite] failed to connect to websocket.\n'));report.requests.errors=report.requests.errors.filter(e=>!report.blockedHmrDiagnostics.includes(e));assert.deepEqual(report.requests.errors,[]);assert.deepEqual(report.requests.failedRequests,[]);report.passed=true;
}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(`${dir}/picker-checks.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
