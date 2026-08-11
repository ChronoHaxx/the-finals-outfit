import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const SD=dirname(fileURLToPath(import.meta.url)); const ROOT=resolve(SD,"../.."); const OUT=resolve(ROOT, process.env.VOUT ?? "visual-diff/verify2");
const list=JSON.parse(readFileSync(resolve(SD, process.env.VLIST ?? "verify-list2.json"),"utf8"));
const items=JSON.parse(readFileSync(resolve(ROOT,"src/data/items.json"),"utf8")); const byId=new Map(items.map(i=>[i.id,i]));
const enc=(s)=>"1."+Buffer.from(JSON.stringify({slots:s})).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
// head bone y=1.68, hands at x=±0.57 y=1.14, wings on upper back (pull back wide).
const cams={
  headwear:{pos:[0,1.74,0.7],t:[0,1.69,0],fov:30}, hair:{pos:[0,1.74,0.7],t:[0,1.69,0],fov:30},
  face:{pos:[0,1.71,0.55],t:[0,1.68,0],fov:26}, eyewear:{pos:[0,1.71,0.5],t:[0,1.69,0],fov:24},
  facewear:{pos:[0,1.71,0.55],t:[0,1.68,0],fov:26}, earrings:{pos:[0.5,1.7,0.35],t:[0.05,1.68,0],fov:22},
  wrist:{pos:[0.95,1.2,0.55],t:[0.55,1.13,0],fov:28}, hands:{pos:[0.98,1.22,0.6],t:[0.55,1.14,0],fov:30},
  gloves:{pos:[0.98,1.22,0.6],t:[0.55,1.14,0],fov:30},
  // upperBack = wings/backpacks/cross-body bandoliers. Item icons are all front-3/4, and even
  // wings read from the front in their icons — a straight-behind cam (the old z=-2.6) mismatched
  // every upperBack icon and rendered front-worn bandoliers as a bare back. Use a wide front-3/4.
  upperBack:{pos:[1.15,1.5,1.9],t:[0,1.4,0],fov:46},
  upperBody:{pos:[0,1.32,1.5],t:[0,1.2,0],fov:32}, outerwear:{pos:[0,1.25,1.6],t:[0,1.1,0],fov:33},
  lowerBody:{pos:[0,0.62,1.7],t:[0,0.6,0],fov:32}, feet:{pos:[0.35,0.32,1.0],t:[0.05,0.18,0],fov:30},
  // lowerBack = lumbar props (boombox etc.), worn on the LOWER BACK; their icons are shot from
  // behind the mannequin (verified: boombox icon). A front cam only catches the prop's edges.
  lowerBack:{pos:[0.55,1.1,-1.6],t:[0,0.95,0],fov:36},
  // 2D decal cosmetics + remaining head slots (census coverage). blush/eyes/tattoo read on the
  // face; nail polish on the hands; body paint needs the whole torso+arms.
  facialHair:{pos:[0,1.7,0.55],t:[0,1.66,0],fov:26},
  blush:{pos:[0,1.71,0.5],t:[0,1.68,0],fov:22}, eyes:{pos:[0,1.72,0.5],t:[0,1.71,0],fov:16},
  tattoo:{pos:[0.4,1.5,1.3],t:[0,1.35,0],fov:36}, bodyPaint:{pos:[0,1.35,1.8],t:[0,1.15,0],fov:40},
  nailPolish:{pos:[0.88,1.05,0.5],t:[0.6,1.02,0],fov:18},
};
async function launch(){for(const c of ["chrome","msedge"]){try{return await chromium.launch({channel:c,headless:true});}catch{}}throw new Error("no chrome");}
// VSKIP=1 -> skip items whose render already exists (resume an interrupted census run).
// Per-item failures are logged to <OUT>/_failed.json instead of killing the whole run, and the
// page is recycled every 150 shots (long headless sessions leak and start dropping frames).
const SKIP=process.env.VSKIP==="1";
// The head is itself an equippable `face` item — a bare outfit renders a HEADLESS mannequin
// (open neck stump), which wrecks every face-adjacent item's render (blush on no face, beard
// floating around a neck). Equip a base head alongside any head-dependent slot. face-23 (palest
// realistic textured head) — NOT cns-base, whose authentic look is a faceted holo-face with a
// full-strength emissive that pins the face white and swallows composited makeup.
const HEAD_SLOTS=new Set(["blush","eyes","tattoo","facialHair","earrings","eyewear","facewear","headwear","hair","bodyPaint"]);
const BASE_HEAD="head-face-23-base";
const outfitFor=(id,slot)=>slot==="face"?{face:id}:HEAD_SLOTS.has(slot)?{face:BASE_HEAD,[slot]:id}:{[slot]:id};
const browser=await launch(); let page; const failed=[];
const newPage=async()=>{if(page)await page.close().catch(()=>{}); page=await browser.newPage({viewport:{width:480,height:840},deviceScaleFactor:1.4});};
await newPage(); mkdirSync(OUT,{recursive:true});
let n=0;
for(const [id,slot] of list){const it=byId.get(id); const cam=cams[slot]||cams.upperBody; n++;
  const dst=join(OUT,`${id}.render.png`);
  if(SKIP&&existsSync(dst)){continue;}
  if(!it){failed.push([id,"not in items.json"]);continue;}
  try{
    await page.goto(`http://localhost:5173/?outfit=${enc(outfitFor(id,slot))}&cam=${[...cam.pos,...cam.t].join(",")}&fov=${cam.fov}&pose=a`,{waitUntil:"networkidle",timeout:45000});
    try{await page.locator("canvas").first().waitFor({state:"visible",timeout:20000}); await page.waitForFunction("window.__rigIdle === true",null,{timeout:30000});}catch{}
    await page.waitForTimeout(600);
    await page.screenshot({path:dst,clip:await page.locator("canvas").first().boundingBox()});
    const icon=resolve(ROOT,"public",it.imageUrl); if(existsSync(icon))copyFileSync(icon,join(OUT,`${id}.icon.webp`));
    console.log(`[${n}/${list.length}] ${id}`);
  }catch(e){
    failed.push([id,String(e.message||e).slice(0,200)]); console.log(`[${n}/${list.length}] ${id} FAILED`);
    await newPage(); // a wedged page poisons every later shot — recycle now
  }
  if(n%150===0)await newPage();
}
await browser.close();
if(failed.length){const {writeFileSync}=await import("node:fs");writeFileSync(join(OUT,"_failed.json"),JSON.stringify(failed,null,1));}
console.log(`done (${failed.length} failed)`);
