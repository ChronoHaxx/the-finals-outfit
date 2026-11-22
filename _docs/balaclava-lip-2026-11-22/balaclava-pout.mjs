// Face-on close-ups with and without Balaclava Cotton Black (22 Nov 2026; README.md beside this file): the Chinals
// Unrivaled Master at 3.2 s, the global Carrot Crusher at 1.47 s (jaw open) and Goblin Horn at 0.3 s (pout). First
// written for PR #71 (_docs/chinals-faces-2026-11-21/), shots changed here. Dev URL camera, so a dev server:
//   Dev server (worktree root, PowerShell): .env.local with deploy.yml's hosts and VITE_CHINALS_ANIMATIONS_BASE set to the
//   Chinals host with faces (https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/), then
//   npx vite --port 5241 --strictPort --host 127.0.0.1;   CAPTURE_BASE=http://127.0.0.1:5241 node _docs/balaclava-lip-2026-11-22/balaclava-pout.mjs
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5202";
const OUT = resolve(process.env.OUT ?? "scripts/generated/balaclava-lip/pout");
mkdirSync(OUT, { recursive: true });
const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", face: "head-face-01-base" };
const SHOTS = [
  ["chinals", "cn-emote-weaponmaster", 3.2, "Surprise 1.0 + BlueSteel 1.0"],
  ["global", "rabbit-carrot", 1.47, "JawOpen 0.8 + Yawn 0.43"],
  ["global", "goblin-horn", 0.3, "BlueSteel 0.67 + Surprise 0.55"],
];
const encode = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const urlFor = (route, slots, cam) => `${BASE}/?reconstructed=1&outfit=${encode(slots)}${cam ? `&cam=${cam.join(",")}&fov=22` : ""}${route === "chinals" ? "#/chinals" : ""}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
const ready = () => page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
const converged = () => page.waitForFunction(() => { const t = window.__temporalPreview; return !t || !t.active || t.samples >= t.maxSamples; },
  null, { timeout: 60000 }).then(() => page.waitForTimeout(250));
const log = [];
for (const [route, clip, time, note] of SHOTS) {
  // Find the face at that frame without the balaclava, then shoot both outfits from the same camera.
  await page.goto(urlFor(route, BODY), { waitUntil: "load", timeout: 180000 });
  await ready();
  await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [clip, time]);
  const cam = await page.evaluate(() => {
    const T = window.__THREE, at = {};
    window.__rigRoot.traverse(o => { if (o.isBone && /^(FACIAL_L_Eye|FACIAL_R_Eye|neck_02)$/.test(o.name) && (!at[o.name] || o.userData.sourceBoneExtension)) at[o.name] = o.getWorldPosition(new T.Vector3()); });
    const eyes = at.FACIAL_L_Eye.clone().add(at.FACIAL_R_Eye).multiplyScalar(0.5);
    const up = eyes.clone().sub(at.neck_02).normalize(), right = at.FACIAL_R_Eye.clone().sub(at.FACIAL_L_Eye).normalize();
    const forward = new T.Vector3().crossVectors(up, right).normalize();
    const eye = eyes.clone().addScaledVector(forward, 0.6).addScaledVector(up, -0.03), target = eyes.clone().addScaledVector(up, -0.06);
    return [...eye.toArray(), ...target.toArray()].map(v => +v.toFixed(4));
  });
  for (const [label, slots] of [["bare", BODY], ["balaclava", { ...BODY, facewear: "streetwear-balaclava-cotton-black" }]]) {
    await page.goto(urlFor(route, slots, cam), { waitUntil: "load", timeout: 180000 });
    await ready();
    await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [clip, time]);
    await page.waitForTimeout(4000); // the balaclava's mesh, wrap cage and face mask
    await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [clip, time]);
    await converged();
    const file = join(OUT, `${route}-${clip}-${label}.png`);
    await page.screenshot({ path: file, clip: await page.locator("canvas").first().boundingBox() });
    const f = await page.evaluate(() => { const a = window.__rigAnim.animator.face; return { masks: a.masks.map(m => m.name), wraps: a.wraps.length }; });
    log.push({ route, clip, time, note, label, ...f, file });
    console.log(route, clip, time, label, JSON.stringify(f));
  }
}
writeFileSync(join(OUT, "log.json"), JSON.stringify({ base: BASE, log, errors: [...new Set(errors)] }, null, 2));
await browser.close();
