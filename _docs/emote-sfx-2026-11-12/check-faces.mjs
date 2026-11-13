// Faces still play beside the sounds (12 Nov 2026). The facial animation session's production check
// (_docs/facial-animation-2026-11-12/publish/prod-check.mjs) holds two emote frames (a balaclava, a beard) and expects the
// worn head posed and wrapped with every faces-1 file at 200. This runs the same two cases against any served app and
// animations host, so the faces + sounds superset can be checked locally before its upload and in production after it.
//
//   node _docs/emote-sfx-2026-11-12/check-faces.mjs --app=http://127.0.0.1:5192 --anim=http://127.0.0.1:5192/animations/ --out=check-faces-local.json
// (Git Bash or PowerShell, worktree root, with that app served). Writes --out beside this file.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APP = arg("app") ?? "http://127.0.0.1:5192", ANIM = arg("anim") ?? `${APP}/animations/`;
const out = arg("out") ?? "check-faces.json";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
const errors = [], faces = [], sounds = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
page.on("console", m => { if (m.type() === "error" || /\[face\]/.test(m.text())) errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
page.on("response", r => {
  if (r.url().startsWith(ANIM + "faces-1/")) faces.push(`${r.status()} ${r.url().slice(ANIM.length)}`);
  if (r.url().startsWith(ANIM + "sounds-1/")) sounds.push(`${r.status()} ${r.url().slice(ANIM.length)}`);
});
const BODY = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const enc = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64url");
const cases = [
  { name: "balaclava", slots: { ...BODY, facewear: "streetwear-balaclava-cotton-black" }, anim: "take-a-bow", time: 1.2 },
  { name: "beard", slots: { ...BODY, facialHair: "facialhairs-beardfull-black" }, anim: "evil-jester", time: 1.3 },
];
const result = { app: APP, anim: ANIM, cases: [] };
for (const c of cases) {
  faces.length = 0; sounds.length = 0; errors.length = 0;
  const row = { name: c.name };
  try {
    // reconstructed=1: a dev build takes the source head route (where the face wraps live) only when asked; production
    // takes it by default, so the flag changes nothing there.
    await page.goto(`${APP}/?reconstructed=1&outfit=${enc(c.slots)}&anim=${c.anim}&animTime=${c.time}`, { waitUntil: "load", timeout: 240000 });
    await page.keyboard.press("Escape"); // welcome dialog, if any
    await page.waitForFunction(() => {
      const a = window.__rigAnim?.animator, s = a?.state;
      return !!(s?.active && s.paused && a.face.head && a.face.wrapped);
    }, null, { timeout: 240000 });
    await page.waitForTimeout(3000);
    Object.assign(row, await page.evaluate(() => {
      const a = window.__rigAnim.animator, f = a.face, s = a.state;
      return { clip: s.current, paused: s.paused, head: f.head?.key, masks: f.masks.map(m => m.name), wraps: f.wraps.length,
        posed: f.posed, wrapped: f.wrapped, soundsAvailable: a.sounds.available };
    }));
  } catch (e) { row.error = String(e).slice(0, 300); }
  row.faceFiles = [...faces]; row.faceNon200 = faces.filter(f => !f.startsWith("200"));
  // Automated browsers (this one) get no sounds URL at all: nothing may be fetched from sounds-1/.
  row.soundFiles = [...sounds]; row.errors = [...new Set(errors)].slice(0, 8);
  result.cases.push(row);
}
result.ok = result.cases.every(c => !c.error && c.posed && c.wrapped && !c.faceNon200.length && c.faceFiles.length > 0
  && !c.soundFiles.length && !c.errors.length);
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), out), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
