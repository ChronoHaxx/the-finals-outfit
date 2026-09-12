// Exercise all eight additions through actual picker clicks, then a share-link reload.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {outfitUrl,waitIdle,watch,classify} from './coverage-preview-harness.mjs';
const dir='scripts/generated/shader-probe/paint-contracts-astra-v1';
const catalog=JSON.parse(fs.readFileSync('src/data/items.json'));
const oracle=JSON.parse(fs.readFileSync('_docs/paint-contracts-2026-09-11/astra-numeric-oracle.json'));
const ids=[...new Set(oracle.contracts.map(c=>c.id))];
const statusOnly=process.argv.includes('--status-only');
const skin={face:'head-face-01-base',hair:'hairs-afrofade'};
const report={at:new Date().toISOString(),equipped:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  await page.routeWebSocket('**/*',socket=>socket.close());
  const log=watch(page);
  const tile=id=>page.locator('[aria-label="Cosmetic results"] button').filter({has:page.locator(`img[alt="${catalog.find(i=>i.id===id).name}"]`)});
  const paintTab=()=>page.getByRole('button',{name:/^Body Paint\s*30$/}).click();
  await page.goto(outfitUrl(skin,{extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);
  await paintTab();
  const statuses=await page.locator('[aria-label="Cosmetic results"] [data-reconstruction-status]').evaluateAll(els=>els.map(el=>el.dataset.reconstructionStatus));
  report.statuses=Object.fromEntries(['untouched','polish','issue','accepted'].map(s=>[s,statuses.filter(v=>v===s).length]));
  assert.deepEqual(report.statuses,{untouched:0,polish:25,issue:5,accepted:0});
  const sweatBadge=tile('bodycosmetics-bodypaint-sweat-01').locator('[data-reconstruction-status]');
  assert.equal(await sweatBadge.getAttribute('data-reconstruction-status'),'issue');
  assert.match(await sweatBadge.getAttribute('title'),/wet head finish and droplet normals/);
  report.sweatColour=await sweatBadge.evaluate(el=>getComputedStyle(el).backgroundColor);
  // Installed Tailwind's purple-500 token (theme.css); Edge preserves its native CSS colour syntax.
  assert.equal(report.sweatColour,'oklch(0.627 0.265 303.9)');
  if(!statusOnly){
  await page.locator('input[placeholder^="Search"]').fill('Runny');
  assert.equal(await page.locator('[aria-label="Cosmetic results"] button').count(),2);
  await page.getByRole('button',{name:/^3D only/}).click();
  assert.equal(await page.locator('[aria-label="Cosmetic results"] button').count(),2);
  await page.locator('input[placeholder^="Search"]').fill('');
  assert.equal(await page.locator('[aria-label="Cosmetic results"] button').count(),30);
  for(const id of ids){
    assert.equal(await tile(id).locator('[data-reconstruction-status]').getAttribute('data-reconstruction-status'),id.includes('sweat')?'issue':'polish',id);
    await page.evaluate(()=>{window.__rigIdle=false;});await tile(id).click();await waitIdle(page);
    assert.equal(await tile(id).getAttribute('aria-pressed'),'true',id);
    report.equipped.push(id);
  }
  await page.screenshot({path:'visual-diff/reconstructed/paint-contracts-after/picker.png',fullPage:true});
  await page.evaluate(()=>{window.__rigIdle=false;});await tile(ids.at(-1)).click();await waitIdle(page);
  assert.equal(await tile(ids.at(-1)).getAttribute('aria-pressed'),'false');report.removePassed=true;
  await page.getByRole('button',{name:/^Upper Body\s*577$/}).click();
  const eno='streetwear-tightsinglet-cotton-enorino';
  await page.locator('input[placeholder^="Search"]').fill('Eno Rino');
  assert.equal(await tile(eno).locator('[data-reconstruction-status]').getAttribute('data-reconstruction-status'),'accepted');
  await page.evaluate(()=>{window.__rigIdle=false;});await tile(eno).click();await waitIdle(page);
  assert.equal(await tile(eno).getAttribute('aria-pressed'),'true');report.neighborPassed=true;
  const sweat='bodycosmetics-bodypaint-sweat-01';
  await page.goto(outfitUrl({...skin,bodyPaint:sweat},{extra:'&temporal=0'}),{waitUntil:'networkidle'});await waitIdle(page);
  await page.reload({waitUntil:'networkidle'});await waitIdle(page);await paintTab();
  assert.equal(await tile(sweat).getAttribute('aria-pressed'),'true');report.linkReloadPassed=true;
  } else await page.screenshot({path:'visual-diff/reconstructed/paint-contracts-after/picker-reviewed.png',fullPage:true});
  report.requests=classify(log);
  report.blockedHmrDiagnostics=report.requests.errors.filter(e=>e.startsWith('[vite] failed to connect to websocket.\n'));
  report.requests.errors=report.requests.errors.filter(e=>!report.blockedHmrDiagnostics.includes(e));
  assert.deepEqual(report.requests.errors,[]);assert.deepEqual(report.requests.failedRequests,[]);
  report.passed=true;
}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(`${dir}/${statusOnly?'status-review':'picker'}-checks.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(statusOnly?'PASS: 25 blue / five purple paint badges; Sweat explanation and actual purple colour.':'PASS: eight real equip clicks, remove, search/filter, status colours, Eno Rino and Sweat link reload.');
