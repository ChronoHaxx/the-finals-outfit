// Matched viewer captures and the source matching/fade lifecycle across outfits.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const output='visual-diff/reconstructed/reference-neck-01';
mkdirSync(output,{recursive:true});
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const beforeAssets=read('scripts/generated/shader-probe/reference-neck-01/before-assets.json');
const beforePairs=read('scripts/generated/shader-probe/reference-neck-01/before-skin-pairs.json');
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[],captures=[];
const check=(name,condition,details={})=>{assert(condition,name);checks.push({name,passed:true,...details});console.log(name+': passed');};
try {
 const page=await browser.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:2});
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const slots={face:'head-face-01-base',hair:'hairs-afrofade'};
 const url=(slots,pose='a')=>'http://127.0.0.1:5173/?outfit=1.'+Buffer.from(JSON.stringify({slots})).toString('base64url')+
  `&reconstructed=1&isolate=0&pose=${pose}&cam=0,1.58,1.2,0,1.58,0&fov=28`;
 const idle=async()=>{await page.waitForFunction(()=>window.__rigIdle,undefined,{timeout:60000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
 const settled=async()=>{await idle();await page.waitForFunction(()=>window.__temporalPreview.samples===32,undefined,{timeout:60000});};
 const select=async next=>{await page.evaluate(async next=>{window.__rigIdle=false;(await import('/src/store/useBuildStore.ts')).useBuildStore.getState().load(next);},next);await idle();};
 const state=()=>page.evaluate(()=>{
  const root=window.__rigRoot, meshes=root.getObjectsByProperty('isSkinnedMesh',true);
  const body=meshes.find(m=>m.userData.sourceBody),head=root.children.find(o=>o.userData.sourceSkinPair);
  const heads=head?.getObjectsByProperty('isSkinnedMesh',true)??[];
  const skin=heads.flatMap(m=>Array.isArray(m.material)?m.material:[m.material]).find(m=>m.userData.skinSurface);
  return {body:body.uuid,geometry:body.geometry.uuid,skeleton:body.skeleton.uuid,
   bodyWeights:[...body.morphTargetInfluences],bodyMorphs:body.userData.sourceFittingMorphs,
   neckWeight:body.morphTargetInfluences[body.morphTargetDictionary.head_neck_match],
   head:head?.uuid,headWeights:heads.map(m=>m.morphTargetInfluences[m.morphTargetDictionary.head_neck_match]),
   skin:skin?.uuid,coverage:skin?.userData.skinCoverage,legacyAlpha:skin?.alphaTest,
   alphaHash:skin?.alphaHash,transparent:skin?.transparent,scalp:skin?.userData.parameterOverrides??[],
   shadows:heads.filter(m=>[].concat(m.material).some(m=>m.userData.skinCoverage)).map(m=>({
    depth:m.customDepthMaterial?.userData.recoveredCoverage,distance:m.customDistanceMaterial?.userData.recoveredCoverage})),
   temporal:{...window.__temporalPreview}};
 });
 for(const stage of ['before','after']) {
  if(stage==='before') {
   await page.route('**/reconstructed-assemblies-v1/assets.json',r=>r.fulfill({json:beforeAssets}));
   await page.route('**/reconstructed-assemblies-v1/skin-pairs.json',r=>r.fulfill({json:beforePairs}));
  } else {
   await page.unroute('**/reconstructed-assemblies-v1/assets.json');
   await page.unroute('**/reconstructed-assemblies-v1/skin-pairs.json');
  }
  for(const pose of ['a','idle']) {
   await page.goto(url(slots,pose),{waitUntil:'networkidle'});await idle();
   if(stage==='before')await page.evaluate(()=>{
    for(const m of window.__rigRoot.getObjectsByProperty('isSkinnedMesh',true)) {
     const i=m.morphTargetDictionary?.head_neck_match;if(i!==undefined)m.morphTargetInfluences[i]=0;
    }
   });
   await settled();const current=await state();
   if(stage==='after') {
    check(`source matching shapes and fade in ${pose} pose`,current.neckWeight===1 && current.headWeights.length===7 &&
     current.headWeights.every(w=>w===1)&&current.coverage==='neck-fade'&&current.alphaHash&&current.legacyAlpha===0&&!current.transparent,
     {bodyMorphs:current.bodyMorphs,headSections:current.headWeights.length});
    check(`neck shadows retain recovered coverage in ${pose} pose`,current.shadows.length===1&&current.shadows.every(s=>s.depth&&s.distance));
   }
   await page.addStyleTag({content:'div:has(> select[aria-label="Recovered material view"]) {visibility:hidden!important}'});
   for(const [view,angle]of [['front',0],['side',1.2],['back',Math.PI]]) {
    await page.evaluate(a=>{window.__rigRoot.rotation.y=a;},angle);await settled();
    const file=`${output}/${stage}-${pose}-${view}.png`;await page.locator('canvas').first().screenshot({path:file});
    captures.push({stage,pose,view,file});
   }
  }
 }
 await page.goto(url(slots),{waitUntil:'networkidle'});await settled();const original=await state();
 for(const hair of ['hairs-afrofade-blonde','hairs-afrofade-saltpepper',undefined]){
  await select({face:slots.face,...(hair?{hair}:{})});await settled();const current=await state();
  check(`neck fitting survives ${hair??'hair removal'}`,current.neckWeight===1&&current.headWeights.every(w=>w===1)&&
   current.coverage==='neck-fade'&&current.geometry===original.geometry&&current.skeleton===original.skeleton,
   {scalpParameters:current.scalp});
 }
 const bare=await state();
 await select({...slots,upperBody:'streetwear-croppedtshirtoversize-cotton-red',lowerBody:'casual-loosejeans-denim-darkblue'});
 await settled();const clothed=await state();
 check('neck matching composes with body and garment fitting',clothed.neckWeight===1&&
  clothed.bodyMorphs.includes('push_upper_torso')&&clothed.bodyMorphs.includes('push_full_pants')&&clothed.geometry===bare.geometry);
 await page.addStyleTag({content:'div:has(> select[aria-label="Recovered material view"]) {visibility:hidden!important}'});
 const file=`${output}/after-clothed.png`;await page.locator('canvas').first().screenshot({path:file});captures.push({stage:'after',view:'clothed',file});
 await select({upperBody:'streetwear-croppedtshirtoversize-cotton-red',lowerBody:'casual-loosejeans-denim-darkblue'});
 const removed=await state();
 check('removing face restores its matching weight and preserves clothing fit',!removed.head&&removed.neckWeight===0&&
  removed.bodyMorphs.includes('push_upper_torso')&&removed.bodyMorphs.includes('push_full_pants')&&removed.geometry===bare.geometry);
 await select({});const cleared=await state();
 check('clearing outfit restores all owned fitting weights',cleared.bodyWeights.every(w=>w===0)&&cleared.bodyMorphs.length===0);
 await select({face:slots.face});await settled();const restored=await state();
 check('bare face restores fade and activates still-view smoothing',restored.coverage==='neck-fade'&&restored.neckWeight===1&&restored.temporal.samples===32);
 assert.deepEqual(errors,[]);
 const sheet=await browser.newPage({viewport:{width:1560,height:1160}});
 const selected=captures.filter(c=>c.pose==='a'&&c.view==='front');
 await sheet.setContent(`<style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#111822;color:#eef1f6;font:18px Arial}h1{font-size:27px;margin:0 0 8px}p{color:#b9c4d3;margin:0 0 18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;background:#253040;border-radius:12px;overflow:hidden}img{display:block;width:100%;height:966px;object-fit:cover;object-position:top}figcaption{padding:12px 16px;font-size:21px}</style>
  <h1>NECK TRANSITION · shared fitting and recovered fade</h1><p>Same camera, pose and lighting. Native skin lighting, temporal dithering and depth offset remain unfinished.</p><div class="grid">${selected.map(c=>`<figure><img src="data:image/png;base64,${readFileSync(c.file).toString('base64')}"><figcaption>${c.stage==='before'?'Before · baked cutout':'After · source matching shapes and neck mask'}</figcaption></figure>`).join('')}</div>`);
 await sheet.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
 await sheet.screenshot({path:`${output}/neck-comparison.png`,fullPage:true});await sheet.close();
 writeFileSync(`${output}/viewer-checks.json`,JSON.stringify({checks,captures,errors},null,2));
 console.log(`${checks.length} source/viewer checks and ${captures.length} matched/interaction captures saved`);
} finally {await browser.close();}
