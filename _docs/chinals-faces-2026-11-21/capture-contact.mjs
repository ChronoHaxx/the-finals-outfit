// Face contact captures (22 Nov 2026): close-ups of head-wrapped items over a moving face, with the face contact
// (src/rig/FaceWrap.ts FaceContact) off and on at the same frame, and the bare face for reference. Each shot's camera is
// aimed at the face at that frame (front, or turned 40 degrees for the profile of the lips), then reused for every
// variant. Same harness as balaclava-pout.mjs: a dev preview with the Chinals host, e.g.
//   $env:VITE_CHINALS_ANIMATIONS_BASE = 'https://7c9add72.the-finals-outfit-chinals-assets.pages.dev/'
//   node _docs/chinals-mode-2026-11-12/serve-preview.mjs --set=<empty folder> --proxy=https://fd946744.the-finals-outfit-assets.pages.dev/ --port=5202
//   node _docs/chinals-faces-2026-11-21/capture-contact.mjs [--only=<substring>]   (worktree root)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5202";
const ONLY = (process.argv.find(a => a.startsWith("--only=")) ?? "").slice(7);
const OUT = resolve("scripts/generated/chinals-faces-2026-11-21/contact-captures");
mkdirSync(OUT, { recursive: true });
const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", face: "head-face-01-base" };
const BALACLAVA = { facewear: "streetwear-balaclava-cotton-black" }, BEARD = { facialHair: "facialhairs-beardfull-black" };
const SCARF = { facewear: "cowboy-mouthscarf-base-black" };
const SHOTS = [ // [name, route, clip, time, item slots, camera turn in degrees]
  ["balaclava-wm-3.2", "chinals", "cn-emote-weaponmaster", 3.2, BALACLAVA, 0], // Surprise 1.0 + BlueSteel 1.0 (the step 5 failure)
  ["balaclava-wm-3.2-side", "chinals", "cn-emote-weaponmaster", 3.2, BALACLAVA, 40],
  ["balaclava-wm-3.3", "chinals", "cn-emote-weaponmaster", 3.3, BALACLAVA, 0],
  ["balaclava-backheel-4.833", "chinals", "cn-emote-worldcup-backheel", 4.833, BALACLAVA, 0], // both at 0.62
  ["balaclava-cutecat-5.933", "chinals", "cn-emote-cutecat", 5.933, BALACLAVA, 0], // both at 0.49
  ["balaclava-kawaii-4.533", "global", "kawaii", 4.533, BALACLAVA, 0], // global: BlueSteel 1.0
  ["beard-wm-3.2", "chinals", "cn-emote-weaponmaster", 3.2, BEARD, 0],
  ["beard-wm-3.2-side", "chinals", "cn-emote-weaponmaster", 3.2, BEARD, 40],
  ["scarf-wm-2.6", "chinals", "cn-emote-weaponmaster", 2.6, SCARF, 0],
].filter(([name]) => !ONLY || name.includes(ONLY));
const encode = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const urlFor = (route, slots, cam) => `${BASE}/?reconstructed=1&outfit=${encode(slots)}${cam ? `&cam=${cam.join(",")}&fov=22` : ""}${route === "chinals" ? "#/chinals" : ""}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (/\[face\]/.test(m.text())) errors.push(m.text().slice(0, 300)); });
const ready = () => page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
const converged = () => page.waitForFunction(() => { const t = window.__temporalPreview; return !t || !t.active || t.samples >= t.maxSamples; },
  null, { timeout: 60000 }).then(() => page.waitForTimeout(250));
const hold = async (clip, time) => {
  await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [clip, time]);
  await page.waitForTimeout(4000); // the item's mesh, wrap cage and face mask
  await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [clip, time]);
};
const log = [];
for (const [name, route, clip, time, item, turn] of SHOTS) {
  await page.goto(urlFor(route, BODY), { waitUntil: "load", timeout: 180000 });
  await ready();
  await hold(clip, time);
  const cam = await page.evaluate(turn => {
    const T = window.__THREE, at = {};
    window.__rigRoot.traverse(o => { if (o.isBone && /^(FACIAL_L_Eye|FACIAL_R_Eye|neck_02)$/.test(o.name) && (!at[o.name] || o.userData.sourceBoneExtension)) at[o.name] = o.getWorldPosition(new T.Vector3()); });
    const eyes = at.FACIAL_L_Eye.clone().add(at.FACIAL_R_Eye).multiplyScalar(0.5);
    const up = eyes.clone().sub(at.neck_02).normalize(), right = at.FACIAL_R_Eye.clone().sub(at.FACIAL_L_Eye).normalize();
    const forward = new T.Vector3().crossVectors(up, right).normalize().applyAxisAngle(up, T.MathUtils.degToRad(turn));
    const eye = eyes.clone().addScaledVector(forward, 0.5).addScaledVector(up, -0.03), target = eyes.clone().addScaledVector(up, -0.05);
    return [...eye.toArray(), ...target.toArray()].map(v => +v.toFixed(4));
  }, turn);
  const shoot = async label => {
    await converged();
    const file = join(OUT, `${name}-${label}.png`);
    await page.screenshot({ path: file, clip: await page.locator("canvas").first().boundingBox() });
    log.push({ name, clip, time, label, file });
    console.log(name, label);
  };
  await page.goto(urlFor(route, BODY, cam), { waitUntil: "load", timeout: 180000 });
  await ready();
  await hold(clip, time);
  await shoot("bare");
  await page.goto(urlFor(route, { ...BODY, ...item }, cam), { waitUntil: "load", timeout: 180000 });
  await ready();
  await hold(clip, time);
  await shoot("contact-on");
  await page.evaluate(t => { const A = window.__rigAnim.animator, F = A.face; F.applyContact = () => {}; F.wrapWeights = null; A.seek(t); }, time);
  await page.waitForTimeout(500);
  await shoot("contact-off");
}
writeFileSync(join(OUT, "log.json"), JSON.stringify({ base: BASE, log, errors: [...new Set(errors)] }, null, 2));
await browser.close();
