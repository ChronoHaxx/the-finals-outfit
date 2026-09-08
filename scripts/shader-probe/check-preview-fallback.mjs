// Legacy body diagnostics must keep compatible hair instead of a source socket.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[];
try {
 const page=await browser.newPage();
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const outfit='1.'+Buffer.from(JSON.stringify({slots:{face:'head-face-01-base',hair:'hairs-afrofade'}})).toString('base64url');
 for(const option of ['', '&sourceMeshes=0', '&sourceFitting=0']) {
  await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&isolate=0&pose=a${option}`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__rigIdle,undefined,{timeout:60000});
  const state=await page.evaluate(()=>{
   const root=window.__rigRoot,hair=root.children.find(o=>o.userData.rigItemId==='hairs-afrofade');
   return {hairPresent:!!hair&&hair.visible,sourceHair:!!hair?.userData.sourceAssembly,
    sourceBody:root.getObjectsByProperty('isSkinnedMesh',true).some(m=>m.userData.sourceBody),
    sourceHead:root.children.some(o=>o.userData.sourceSkinPair)};
  });
  const enabled=option==='';assert.deepEqual(state,{hairPresent:true,sourceHair:enabled,sourceBody:enabled,sourceHead:enabled});
  assert.deepEqual(errors,[]);checks.push({name:option||'preserved preview',passed:true,...state});
 }
 const output='visual-diff/reconstructed/reference-neck-01';mkdirSync(output,{recursive:true});
 writeFileSync(`${output}/preview-mode-checks.json`,JSON.stringify(checks,null,2));
 console.log('Three source/legacy body and hair preview modes passed');
} finally {await browser.close();}
