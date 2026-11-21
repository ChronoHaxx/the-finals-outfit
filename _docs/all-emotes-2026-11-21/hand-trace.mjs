// Hand paths of an emote clip (21 Nov 2026): samples hand_l / hand_r relative to the pelvis in the character's frame
// (x = character's left, y = up, z = forward, cm), to recognise a dance by its motion (the floss: both hands swing
// left-right together at hip height, crossing the body). node _docs/all-emotes-2026-11-21/hand-trace.mjs <base> <clip> [step s] [--chinals]
import { chromium } from "playwright-core";
const [base, clip, step = "0.1"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
await page.goto(`${base}/?reconstructed=1${process.argv.includes("--chinals") ? "#/chinals" : ""}`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
for (let i = 0; ; i++) { try { await page.evaluate(id => window.__rigAnim.play(id, 0), clip); break; } catch (e) { if (i > 30) throw e; await page.waitForTimeout(1000); } }
const rows = await page.evaluate(async ([id, dt]) => {
  const a = window.__rigAnim, T = window.__THREE, info = a.animator.manifest.clips.find(c => c.id === id), out = [];
  const bones = {}; window.__rigRoot.traverse(o => { if (o.isBone && /^(hand_l|hand_r|pelvis)$/.test(o.name) && !bones[o.name]) bones[o.name] = o; });
  for (let t = 0; t <= info.duration; t += dt) {
    a.seek(t); window.__rigRoot.updateMatrixWorld(true);
    const p = bones.pelvis.getWorldPosition(new T.Vector3()), at = n => bones[n].getWorldPosition(new T.Vector3()).sub(p).multiplyScalar(100);
    const l = at("hand_l"), r = at("hand_r");
    out.push([+t.toFixed(2), Math.round(l.x), Math.round(l.y), Math.round(l.z), Math.round(r.x), Math.round(r.y), Math.round(r.z)]);
  }
  return out;
}, [clip, Number(step)]);
console.log("t  | left hand x y z | right hand x y z   (cm from pelvis)");
for (const r of rows) console.log(r.join(" "));
await browser.close();
