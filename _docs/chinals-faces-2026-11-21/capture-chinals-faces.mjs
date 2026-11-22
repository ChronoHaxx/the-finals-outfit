// Chinals facial animation captures (21 Nov 2026): close-ups of the face in Chinals mode, held at the frame where an
// expression peaks in the Chinals clip's own curves, with the facial animation on and off (window.__rigAnim.face).
// Adapted from scripts/anim-export/capture-face.mjs (same harness: headless Chrome/Edge through playwright-core, each
// frame held paused until the still view has converged); the page opens on the #/chinals route.
//
//   node _docs/chinals-faces-2026-11-21/capture-chinals-faces.mjs [--only=<set>] [--out=<dir>]   (worktree root)
//   CAPTURE_BASE=http://127.0.0.1:5201 (a preview serving the Chinals set with faces at /chinals-animations/)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5201";
const ONLY = (process.argv.find(a => a.startsWith("--only=")) ?? "").slice(7);
const OUT = resolve((process.argv.find(a => a.startsWith("--out=")) ?? "").slice(6) || "scripts/generated/chinals-faces-2026-11-21/captures");

const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const SETS = {
  // Peaks read from the Chinals curves (faces-1/curves): pose weight at that time in brackets.
  emotes: { slots: { ...BODY, face: "head-face-01-base" }, shots: [
    ["cn-emote-weaponmaster", 3.2, "surprise"], // Face_Surprise 1.0
    ["cn-emote-gacha-01", 9.667, "happy"], // Face_Happy 0.60 (MaskKiller peaks at 0.99 at 4.2 s, behind its own hand)
    ["cn-emote-mahjong-01", 3.367, "angry"], // Face_Angry 1.0
    ["cn-emote-cutecat", 2.3, "fear"], // Face_Fear 1.0
    ["cn-emote-duanwu", 2.367, "jaw-open"], // Face_JawOpen 0.5
    ["cn-emote-worldcup-goalkeeper", 2.133, "furious"], // Face_Furious 0.8
  ] },
  // The Chinals outfit idle (its own clip, not the global idle): blinks and looks.
  idle: { slots: { ...BODY, face: "head-face-01-base" }, shots: [["cn-outfit-idle", 1.267, "idle-a"], ["cn-outfit-idle", 5.267, "idle-b"]] },
  // Another rig (Face 20) and the head-wrapped and masked items: a full beard follows the jaw, a balaclava damps it.
  covered: { slots: { ...BODY, face: "head-face-01-base" }, variants: [
    { face: "head-face-20-base" }, { facialHair: "facialhairs-beardfull-black" }, { facewear: "streetwear-balaclava-cotton-black" }],
    shots: [["cn-emote-duanwu", 2.367, "jaw-open"], ["cn-emote-gacha-01", 9.667, "happy"]] },
};

const encodeOutfit = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const urlFor = (slots, cam) => `${BASE}/?reconstructed=1&outfit=${encodeOutfit(slots)}${cam ? `&cam=${cam.join(",")}&fov=22` : ""}#/chinals`;

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* try next */ }
  }
  throw new Error("no Chrome/Edge found for playwright-core");
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
const converged = () => page.waitForFunction(() => {
  const t = window.__temporalPreview;
  return !t || !t.active || t.samples >= t.maxSamples;
}, null, { timeout: 60000 }).then(() => page.waitForTimeout(250));
const ready = () => page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
const errors = [], faceRequests = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (m.type() === "error" || m.type() === "warning" || /\[face\]/.test(m.text())) errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on("response", r => { if (/faces-1\//.test(r.url())) faceRequests.push(`${r.status()} ${r.url().replace(/^.*?(\/[^/]*-animations\/|\/animations\/)/, "$1")}`); });

const log = [];
for (const [name, set] of Object.entries(SETS)) {
  if (ONLY && name !== ONLY) continue;
  for (const variant of set.variants ?? [{}]) {
    const slots = { ...set.slots, ...variant };
    const folder = join(OUT, name);
    mkdirSync(folder, { recursive: true });
    errors.length = 0;
    const prefix = Object.values(variant).join("+") || slots.face;
    for (const [clip, time, label] of set.shots) {
      // Emotes move the head: hold the frame, find the face (eyes, neck), reload with the camera in front of it.
      await page.goto(urlFor(slots), { waitUntil: "load", timeout: 180000 });
      await ready();
      const mode = await page.evaluate(() => ({ hash: location.hash, clips: window.__rigAnim.animator.manifest.clips.length,
        edition: window.__rigAnim.animator.manifest.edition ?? "global" }));
      if (mode.edition !== "chinals") throw new Error(`not in Chinals mode: ${JSON.stringify(mode)}`);
      await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [clip, time]);
      const cam = await page.evaluate(() => {
        const T = window.__THREE, at = {};
        window.__rigRoot.traverse(o => {
          if (o.isBone && /^(FACIAL_L_Eye|FACIAL_R_Eye|neck_02)$/.test(o.name) && (!at[o.name] || o.userData.sourceBoneExtension))
            at[o.name] = o.getWorldPosition(new T.Vector3());
        });
        const eyes = at.FACIAL_L_Eye.clone().add(at.FACIAL_R_Eye).multiplyScalar(0.5);
        const up = eyes.clone().sub(at.neck_02).normalize(), right = at.FACIAL_R_Eye.clone().sub(at.FACIAL_L_Eye).normalize();
        const forward = new T.Vector3().crossVectors(up, right).normalize();
        const eye = eyes.clone().addScaledVector(forward, 0.72).addScaledVector(up, 0.02), target = eyes.clone().addScaledVector(up, -0.035);
        return [...eye.toArray(), ...target.toArray()].map(v => +v.toFixed(4));
      });
      await page.goto(urlFor(slots, cam), { waitUntil: "load", timeout: 180000 });
      await ready();
      const box = await page.locator("canvas").first().boundingBox();
      for (const on of [true, false]) {
        await page.evaluate(([id, t, faceOn]) => window.__rigAnim.play(id, t).then(() => window.__rigAnim.face(faceOn)), [clip, time, on]);
        await converged();
        const file = join(folder, `${prefix}-${clip}-${label}-${on ? "face" : "noface"}.png`);
        await page.screenshot({ path: file, clip: box });
        const head = await page.evaluate(() => {
          const f = window.__rigAnim.animator.face, h = f.head;
          return h ? `${h.key} ${h.bones.length} bones; masks ${f.masks.map(m => m.name).join("+") || "none"}; wraps ${f.wraps.length}` : null;
        });
        log.push({ set: name, variant, clip, time, label, on, head, file });
        console.log(`${name} ${prefix} ${clip} ${label} face=${on} (${head})`);
      }
    }
    if (errors.length) log.push({ set: name, variant, errors: [...new Set(errors)] });
  }
}
await browser.close();
writeFileSync(join(OUT, `capture-log${ONLY ? "-" + ONLY : ""}.json`), JSON.stringify({ base: BASE, sets: SETS, log,
  faceRequests: [...new Set(faceRequests)] }, null, 2));
console.log(`done -> ${OUT}`);
