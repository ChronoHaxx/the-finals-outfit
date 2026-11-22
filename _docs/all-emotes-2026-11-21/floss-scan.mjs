// Floss scan (21 Nov 2026): for every emote clip a mode serves, sample both hands relative to the pelvis every 1/15 s
// and score the floss signature: both hands on the SAME side of the hips (each past 8 cm), below the chest, with that
// side switching back and forth. node _docs/all-emotes-2026-11-21/floss-scan.mjs <base> [--chinals]
import { chromium } from "playwright-core";
const [base] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
await page.goto(`${base}/?reconstructed=1${process.argv.includes("--chinals") ? "#/chinals" : ""}`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
const ids = await page.evaluate(() => window.__rigAnim.animator.manifest.clips.filter(c => c.kind === "emote").map(c => c.id));
const results = [];
for (const id of ids) {
  for (let i = 0; ; i++) { try { await page.evaluate(c => window.__rigAnim.play(c, 0), id); break; } catch (e) { if (i > 30) throw e; await page.waitForTimeout(1000); } }
  results.push(await page.evaluate(clip => {
    const a = window.__rigAnim, T = window.__THREE, info = a.animator.manifest.clips.find(c => c.id === clip);
    const bones = {}; window.__rigRoot.traverse(o => { if (o.isBone && /^(hand_l|hand_r|pelvis)$/.test(o.name) && !bones[o.name]) bones[o.name] = o; });
    let same = 0, n = 0, switches = 0, last = 0;
    for (let t = 0; t <= info.duration; t += 1 / 15) {
      a.seek(t); window.__rigRoot.updateMatrixWorld(true);
      const p = bones.pelvis.getWorldPosition(new T.Vector3());
      const l = bones.hand_l.getWorldPosition(new T.Vector3()).sub(p).multiplyScalar(100), r = bones.hand_r.getWorldPosition(new T.Vector3()).sub(p).multiplyScalar(100);
      n++;
      const side = l.x > 8 && r.x > 8 ? 1 : l.x < -8 && r.x < -8 ? -1 : 0;
      if (side && l.y < 30 && r.y < 30) { same++; if (last && side !== last) switches++; last = side; }
    }
    return { id: clip, label: info.label, duration: info.duration, sameSide: +(same / n).toFixed(2), switches };
  }, id));
}
results.sort((a, b) => b.switches - a.switches || b.sameSide - a.sameSide);
console.log(JSON.stringify(results.slice(0, 12), null, 1));
await browser.close();
