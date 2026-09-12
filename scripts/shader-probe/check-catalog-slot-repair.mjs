// Independent source/catalog audit plus disposable browser evidence for the slot correction.
// node --import tsx scripts/shader-probe/check-catalog-slot-repair.mjs [--browser]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { classifySlot } from '../lib/catalog-slots.ts';
import { LEGACY_SLOT_MIGRATIONS } from '../../src/lib/outfit-slots.ts';
import { chromium } from 'playwright-core';
import { BASE_OUTFIT, outfitUrl, servePreviewIndex, waitIdle, rigState, shoot, watch, classify, swap, read, storeModuleUrl }
  from './coverage-preview-harness.mjs';

const generated = 'scripts/generated/shader-probe/coverage-sprint-slot-repair-01';
const out = 'visual-diff/reconstructed/coverage-sprint-slot-repair-01';
const preview = 'public/models/reconstructed-coverage-slot-preview-v1';
const singlet = 'streetwear-tightsinglet-cotton-enorino';
const shirt = BASE_OUTFIT.upperBody;
const catalog = read('src/data/items.json');
const before = JSON.parse(execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\','/')}`,
  'show', 'HEAD:src/data/items.json'], {encoding:'utf8',maxBuffer:64*1024*1024}));
const data = read('public/models/reconstructed-assembly-v2/customization.json');
const changes = [];
assert.equal(catalog.length,before.length);
for (let n=0;n<catalog.length;n++) {
  const item=catalog[n], old=before[n]; assert.equal(item.id,old.id);
  if (item.slot===old.slot) { assert.deepEqual(item,old); continue; }
  assert.deepEqual({...item,slot:old.slot},old,`${item.id} changed fields other than slot`);
  const def=data.definitions[data.catalog[item.id]];
  assert.equal(old.slot,'lowerBody'); assert.equal(item.slot,'upperBody');
  assert(def.properties.Slots.includes('EBodySlot::BodyUpper'));
  assert(def.properties.AssetTags.includes('Customization.Slot.BodyUpper'));
  const piece=def.source.split('/Assets/')[1].split('/')[0];
  assert(['ShortDress','JeansJacket','JacketShort','TightSinglet','TightSingletSportEvent'].includes(piece));
  assert.equal(classifySlot(piece),item.slot);
  changes.push({id:item.id,from:old.slot,to:item.slot,piece,source:def.source,sourceSlots:def.properties.Slots,
    sourceCategoryTag:'Customization.Slot.BodyUpper'});
}
assert.deepEqual(changes.map(x=>x.id).sort(),[...LEGACY_SLOT_MIGRATIONS.keys()].sort());
const hashes=Object.fromEntries(['assets.json','supported-items.json','skin-pairs.json'].map(name=>[name,
  crypto.createHash('sha256').update(fs.readFileSync(`public/models/reconstructed-assemblies-v1/${name}`)).digest('hex')]));
fs.mkdirSync(generated,{recursive:true});
fs.writeFileSync(path.join(generated,'catalog-check.json'),JSON.stringify({checkedAt:new Date().toISOString(),
  changes:changes.length,unchangedItems:catalog.length-changes.length,onlySlotChanges:true,sourceEvidence:changes,
  initialActiveHashes:hashes},null,2)+'\n');
console.log(`Catalog: ${changes.length} source-evidenced slot changes; every other field/item preserved.`);
if (!process.argv.includes('--browser')) process.exit(0);

// These three preview documents already use sibling-relative URLs. Reusing them here
// preserves the actual dependency URL from both index folders; only informational slots change.
fs.mkdirSync(preview,{recursive:true});
for(const name of ['assets.json','supported-items.json','skin-pairs.json']) {
  const doc=read(`public/models/reconstructed-coverage-a-preview-v1/${name}`);
  if(name==='supported-items.json') for(const row of doc.ready) row.slot=catalog.find(x=>x.id===row.id).slot;
  fs.writeFileSync(path.join(preview,name),JSON.stringify(doc,null,2)+'\n');
}
fs.mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),meaning:'Browser binding, interaction and render evidence; appearance requires Astra review',cases:[]};
const browser=await chromium.launch({channel:'msedge',headless:true});
const cam='0,0.98,2.9,0,0.98,0';
async function open(slots,{pose='a',rawCode}={}) {
  const page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1});
  const record=watch(page); await servePreviewIndex(page,preview);
  const url=rawCode ? `http://127.0.0.1:5173/?outfit=${rawCode}&cam=${cam}&fov=28&reconstructed=1&pose=a` : outfitUrl(slots,{cam,pose});
  await page.goto(url,{waitUntil:'networkidle'});await waitIdle(page);
  return {page,record};
}
async function state(page) {return page.evaluate(async url=>{const {useBuildStore}=await import(url);return useBuildStore.getState().build;},await storeModuleUrl(page));}
async function finish(page,record,entry) {
  entry.requests=classify(record);assert.deepEqual(entry.requests.errors,[]);assert.deepEqual(entry.requests.failedRequests,[]);
  report.cases.push(entry);fs.writeFileSync(path.join(generated,'browser-check.json'),JSON.stringify(report,null,2)+'\n');await page.close();
}
try {
  for(const pose of ['a',null]) {
    const {page,record}=await open({...BASE_OUTFIT,upperBody:singlet},{pose});
    const entry={name:pose?'EnoRino A-pose':'EnoRino idle',id:singlet,pose:pose??'idle',files:[],state:await rigState(page)};
    const assembly=entry.state.assemblies.find(x=>x.id===singlet);
    assert(assembly?.sourceAssembly&&assembly.groupVisible&&assembly.visibleMeshes);
    assert(assembly.parts.every(p=>p.sourceMesh.includes('SK_Streetwear_TightSinglet_M')));
    assert(assembly.parts.flatMap(p=>p.materials).every(m=>m.reconstructed&&m.sourceMaterial.includes('MI_Streetwear_TightSinglet_Cotton_EnoRino')));
    assert(!entry.state.assemblies.some(x=>x.id===shirt));
    for(const [angle,y] of [['front',0],['back',Math.PI],['oblique',0.7]]) {
      await page.evaluate(y=>{window.__rigRoot.rotation.y=y;window.__rigRoot.updateMatrixWorld(true);},y);
      const file=`enorino.${pose??'idle'}.${angle}.png`;await shoot(page,path.join(out,file));entry.files.push(file);
    }
    await finish(page,record,entry);
  }
  {
    const old={...BASE_OUTFIT,upperBody:shirt,lowerBody:singlet};
    const {page,record}=await open(old);const build=await state(page);
    assert.equal(build.upperBody,singlet);assert.equal(build.lowerBody,null);assert.equal(build.feet,BASE_OUTFIT.feet);
    await swap(page,{...BASE_OUTFIT,upperBody:singlet});await waitIdle(page);
    assert.equal((await state(page)).lowerBody,BASE_OUTFIT.lowerBody);
    await page.evaluate(async ({shirt,url})=>{const {useBuildStore}=await import(url);const {getItemById}=await import('/src/lib/catalog.ts');window.__rigIdle=false;useBuildStore.getState().equip(getItemById(shirt));},{shirt,url:await storeModuleUrl(page)});
    await waitIdle(page);assert.equal((await state(page)).upperBody,shirt);
    assert(!(await rigState(page)).assemblies.some(x=>x.id===singlet));
    await page.evaluate(async ({id,url})=>{const {useBuildStore}=await import(url);const {getItemById}=await import('/src/lib/catalog.ts');window.__rigIdle=false;useBuildStore.getState().toggle(getItemById(id));},{id:singlet,url:await storeModuleUrl(page)});
    await waitIdle(page);assert.equal((await state(page)).upperBody,singlet);
    assert.equal((await state(page)).lowerBody,BASE_OUTFIT.lowerBody);
    await finish(page,record,{name:'Old-link collision, pants selection, shirt replacement and singlet selection',passed:true,legacyBuild:build});
  }
  for(const id of ['cowboy-jeansjacket-denim-lightblue','streetwear-jacketshort-leather-dissun','casual-shortdress-nylon-red','streetwear-tightsinglet-cotton-orangeevent']) {
    const {page,record}=await open({...BASE_OUTFIT,upperBody:id});
    const rig=await rigState(page);const legacy=rig.other.find(x=>x.id===id);
    assert(legacy?.visibleMeshes&&legacy.groupVisible,`Legacy garment absent: ${id}`);
    assert.equal((await state(page)).upperBody,id);
    const file=`${id}.legacy.png`;await shoot(page,path.join(out,file));
    await finish(page,record,{name:'Corrected garment on existing legacy renderer',id,reconstructed:false,file,state:rig});
  }
  for(const [name,code] of [['empty','1.'+Buffer.from(JSON.stringify({slots:{}})).toString('base64url')],['invalid','bad-link'],
    ['invalid-slot','1.'+Buffer.from(JSON.stringify({slots:{headwear:singlet}})).toString('base64url')]]) {
    const {page,record}=await open({}, {rawCode:code}); const build=await state(page);
    assert.equal(build.upperBody,'casual-basictshirt-cotton-black',`${name} link should retain default build`);
    await finish(page,record,{name:`${name} link retains existing default semantics`,passed:true});
  }
} finally {await browser.close();}
report.finishedAt=new Date().toISOString();
report.activeUnchanged=Object.entries(hashes).every(([name,hash])=>crypto.createHash('sha256').update(fs.readFileSync(`public/models/reconstructed-assemblies-v1/${name}`)).digest('hex')===hash);
assert(report.activeUnchanged);fs.writeFileSync(path.join(generated,'browser-check.json'),JSON.stringify(report,null,2)+'\n');
console.log(`Browser: ${report.cases.length} checks, active indexes unchanged.`);
