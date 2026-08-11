import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const OUT = resolve(ROOT, "visual-diff/verify");
const list = JSON.parse(readFileSync(resolve(SCRIPT_DIR, "verify-list.json"), "utf8"));
const items = JSON.parse(readFileSync(resolve(ROOT, "src/data/items.json"), "utf8"));
const byId = new Map(items.map((i) => [i.id, i]));
const enc=(s)=>"1."+Buffer.from(JSON.stringify({slots:s})).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const cams={
  upperBody:{pos:[0,1.32,1.5],t:[0,1.2,0],fov:32},
  outerwear:{pos:[0,1.25,1.6],t:[0,1.1,0],fov:33},
  lowerBody:{pos:[0,0.62,1.7],t:[0,0.6,0],fov:32},
  feet:{pos:[0.35,0.32,1.0],t:[0.05,0.18,0],fov:30},
};
async function launch(){for(const c of ["chrome","msedge"]){try{return await chromium.launch({channel:c,headless:true});}catch{}}throw new Error("no chrome");}
const browser=await launch();
const page=await browser.newPage({viewport:{width:480,height:840},deviceScaleFactor:1.4});
page.on("pageerror",(e)=>console.warn("  pageerr:",String(e).slice(0,120)));
mkdirSync(OUT,{recursive:true});
let n=0;
for(const [id,slot] of list){
  const it=byId.get(id); const cam=cams[slot];
  await page.goto(`http://localhost:5173/?outfit=${enc({[slot]:id})}&cam=${[...cam.pos,...cam.t].join(",")}&fov=${cam.fov}&pose=a`,{waitUntil:"networkidle"});
  await page.locator("canvas").first().waitFor({state:"visible",timeout:20000});
  await page.waitForFunction("window.__rigIdle === true",null,{timeout:30000});
  await page.waitForTimeout(650);
  await page.screenshot({path:join(OUT,`${id}.render.png`),clip:await page.locator("canvas").first().boundingBox()});
  // copy the icon next to it for the judges
  const icon=resolve(ROOT,"public",it.imageUrl);
  if(existsSync(icon)) copyFileSync(icon, join(OUT,`${id}.icon.webp`));
  n++; console.log(`[${n}/${list.length}] ${id}`);
}
await browser.close(); console.log("done ->",OUT);
