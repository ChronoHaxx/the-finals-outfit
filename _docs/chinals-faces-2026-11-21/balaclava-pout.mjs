// Balaclava and a pout (22 Nov 2026): the agent run of checklist step 5 saw the lower lip show through Balaclava
// Cotton Black at Unrivaled Master's 3.2 s (Face_Surprise 1.0 + Face_BlueSteel 1.0). Is that Chinals-only, or does
// the balaclava do the same on global emotes that pout as hard? Close-ups, face on, with and without the balaclava:
// the Chinals clip and three global clips at their Face_BlueSteel peaks (global faces-1 curves, 17ec92c3 / fd946744).
// Same harness as capture-chinals-faces.mjs (dev URL camera, so a dev preview: serve-preview.mjs with
// VITE_CHINALS_ANIMATIONS_BASE=<Chinals host> and --proxy=<global animations host>).
//   CAPTURE_BASE=http://127.0.0.1:5202 node _docs/chinals-faces-2026-11-21/balaclava-pout.mjs   (worktree root)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5202";
const OUT = resolve("scripts/generated/chinals-faces-2026-11-21/balaclava-pout");
mkdirSync(OUT, { recursive: true });
const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", face: "head-face-01-base" };
const SHOTS = [ // [route, clip, time, what peaks there]
  ["chinals", "cn-emote-weaponmaster", 3.2, "Surprise 1.0 + BlueSteel 1.0"],
  ["global", "trophy", 3.833, "BlueSteel 1.0"],
  ["global", "jade-rabbit", 4.533, "BlueSteel 1.0 + Surprise 0.38"],
  ["global", "kawaii", 4.533, "BlueSteel 1.0"],
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
