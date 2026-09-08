// Same camera/lighting/pose, before and after the recovered facial details.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const output='visual-diff/reconstructed/reference-details-01';
mkdirSync(output,{recursive:true});
const bindings=JSON.parse(readFileSync('public/models/reconstructed-assemblies-v1/skin-pairs.json','utf8'));
const baseline=structuredClone(bindings);
for(const [slot,binding] of Object.entries(baseline.items['head-face-01-base'].head.materials))
  if(slot!=='shader_head_shader') delete binding.url;
const slots={face:'head-face-01-base',hair:'hairs-afrofade'};
const outfit='1.'+Buffer.from(JSON.stringify({slots})).toString('base64url');
const browser=await chromium.launch({channel:'msedge',headless:true}), errors=[], report=[];
try {
  const page=await browser.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:2});
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error') errors.push(e.text());});
  for(const [name,expected] of [['before',1],['after',5]]) {
    if(name==='before') await page.route('**/reconstructed-assemblies-v1/skin-pairs.json',route=>route.fulfill({json:baseline}));
    else await page.unroute('**/reconstructed-assemblies-v1/skin-pairs.json');
    await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&isolate=0&pose=a&cam=0,1.66,0.85,0,1.66,0&fov=28`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__rigIdle,undefined,{timeout:60000});
    const count=await page.evaluate(()=>{
      const head=window.__rigRoot.children.find(o=>o.userData.sourceSkinPair); let count=0;
      head.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]) if(m.userData.reconstructed) count++;});
      return count;
    });
    assert.equal(count,expected); assert.deepEqual(errors,[]);
    await page.addStyleTag({content:'button[title="Toggle scene lighting"], div:has(> select[aria-label="Recovered material view"]) { visibility:hidden !important; }'});
    for(const [view,angle] of [['front',0],['oblique',.38]]) {
      await page.evaluate(angle=>{window.__rigRoot.rotation.y=angle;},angle);
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const file=`${output}/head-detail-${name}-${view}.png`;
      await page.locator('canvas').first().screenshot({path:file});
      report.push({stage:name,view,recoveredHeadSections:count,file});
    }
  }
  writeFileSync(`${output}/head-comparison.json`,JSON.stringify(report,null,2));
  console.log('Captured four matched head-detail views; baseline uses prior skin-only pair bindings');
} finally {await browser.close();}
