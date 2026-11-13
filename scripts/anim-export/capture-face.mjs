// Facial animation captures (12 Nov 2026): close-ups of the face held at chosen clip times, with the facial animation
// on and off (window.__rigAnim.face), for review by eye beside in-game footage. Same harness as capture.mjs: headless
// Chrome/Edge through playwright-core, each frame held paused until the still view has converged.
//
//   node scripts/anim-export/capture-face.mjs [--only=<set>] [--out=<dir>] [--legacy]   (Git Bash or PowerShell, worktree root)
//   CAPTURE_BASE=http://127.0.0.1:5193 (the dev server serving this worktree, with public/animations/faces-N activated)
//
// Each shot: [clip id, seconds, label]. Times were picked from the clips' own curves (the frame where that pose peaks).
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5193";
const ONLY = (process.argv.find(a => a.startsWith("--only=")) ?? "").slice(7);
const OUT = resolve((process.argv.find(a => a.startsWith("--out=")) ?? "").slice(6) || "scripts/generated/face-anim/captures");
const LEGACY = process.argv.includes("--legacy");

const BODY = { upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const SETS = {
  // The default face through the idle: a look left with a wink, the blink, a look right.
  idle: { slots: { ...BODY, face: "head-face-01-base" }, shots: [["outfit-idle", 5.267, "look-left"], ["outfit-idle", 1.267, "blink"],
    ["outfit-idle", 3.467, "look-right"], ["outfit-idle", 17.067, "contempt"]] },
  // Faces on other pose assets and both routes: a newer rig (Face 20, 33 poses), a reused asset (Face 18 -> 15's),
  // a legacy-free source face (Face 30), the CNS head (Face 08's asset, 100 bones fewer).
  faces: { slots: { ...BODY, face: "head-face-20-base" }, faces: ["head-face-20-base", "head-face-18-base", "head-face-30-base", "cns-base"],
    shots: [["outfit-idle", 5.267, "look-left"], ["outfit-idle", 1.267, "blink"]] },
  // Items on the face: a balaclava (head-wrapped, FaceMask), sunglasses, a full beard (head-wrapped, unmasked), a
  // mascot head over it all, a combat helmet (EyesOnly), a mouth scarf (FaceMaskLowerFace). Expressions whose mouth is
  // in view (Matcha's wider jaw is behind the cup): a smile, a surprise, Evil Jester's open jaw (0.28).
  covered: { slots: { ...BODY, face: "head-face-01-base" }, faces: ["head-face-01-base"], track: true, variants: [
    { facewear: "streetwear-balaclava-cotton-black" }, { eyewear: "attachments-aviatorsunglasses-metal" },
    { facialHair: "facialhairs-beardfull-black" }, { headwear: "attachment-cowmascothead-cotton" },
    { headwear: "military-combathelmet-plastic-black" }, { facewear: "winter-mouthscarf-wool-black" }],
    shots: [["take-a-bow", 1.2, "happy"], ["wolf-mask", 0.567, "surprise"], ["evil-jester", 1.3, "jaw-open"]] },
  // Emotes at the frame where an expression peaks (from the clips' own curves), framed looser: emotes move the head.
  emotes: { slots: { ...BODY, face: "head-face-01-base" }, track: true, shots: [["take-a-bow", 1.2, "happy"],
    ["boxer", 0.633, "furious"], ["wolf-mask", 0.567, "surprise"], ["matcha", 5.6, "jaw-open"], ["jade-rabbit", 4.533, "blue-steel"],
    ["space-protector", 4.767, "sad"]] },
};
const CAM = [0, 1.71, 0.78, 0, 1.69, 0.03]; // straight at the face, close (the character faces +z; eyes at y 1.74 in the still pose)

const encodeOutfit = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* try next */ }
  }
  throw new Error("no Chrome/Edge found for playwright-core");
}
const converged = () => page.waitForFunction(() => {
  const t = window.__temporalPreview;
  return !t || !t.active || t.samples >= t.maxSamples;
}, null, { timeout: 60000 }).then(() => page.waitForTimeout(250));

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (m.type() === "error" || m.type() === "warning" || /\[face\]/.test(m.text())) errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
const log = [];
for (const [name, set] of Object.entries(SETS)) {
  if (ONLY && name !== ONLY) continue;
  for (const face of set.faces ?? [set.slots.face]) for (const variant of set.variants ?? [{}]) {
    const folder = join(OUT, `${name}${LEGACY ? "-legacy" : ""}`);
    mkdirSync(folder, { recursive: true });
    errors.length = 0;
    const prefix = [face, ...Object.values(variant)].join("+");
    const url = `${BASE}/?${LEGACY ? "" : "reconstructed=1&"}outfit=${encodeOutfit({ ...set.slots, ...variant, face })}`
      + `&cam=${(set.cam ?? CAM).join(",")}&fov=22`;
    await page.goto(url, { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
    const box = await page.locator("canvas").first().boundingBox();
    await converged();
    await page.screenshot({ path: join(folder, `${prefix}-static.png`), clip: box });
    for (const [clip, time, label] of set.shots) {
      if (set.track) {
        // Emotes move the head: hold the frame, find the face (eyes, neck), reload with the camera in front of it.
        await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [clip, time]);
        const cam = await page.evaluate(() => {
          const T = window.__THREE, at = {};
          // The driver's neck (the body comes first) and the driven eyes: a source head GLB keeps unused copies of both.
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
        await page.goto(`${BASE}/?${LEGACY ? "" : "reconstructed=1&"}outfit=${encodeOutfit({ ...set.slots, ...variant, face })}&cam=${cam.join(",")}&fov=22`,
          { waitUntil: "load", timeout: 180000 });
        await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
      }
      for (const on of [true, false]) {
        await page.evaluate(([id, t, faceOn]) => window.__rigAnim.play(id, t).then(() => window.__rigAnim.face(faceOn)), [clip, time, on]);
        await converged();
        const file = join(folder, `${prefix}-${label}-${on ? "face" : "noface"}.png`);
        await page.screenshot({ path: file, clip: box });
        const head = await page.evaluate(() => {
          const f = window.__rigAnim.animator.face, h = f.head;
          return h ? `${h.key} ${h.bones.length} bones; masks ${f.masks.map(m => m.name).join("+") || "none"}; wraps ${f.wraps.length}` : null;
        });
        log.push({ set: name, face, variant, clip, time, label, on, head, file });
        console.log(`${name} ${prefix} ${label} face=${on} (${head})`);
      }
    }
    if (errors.length) log.push({ set: name, face, variant, errors: [...new Set(errors)] });
  }
}
await browser.close();
writeFileSync(join(OUT, `capture-face-log${ONLY ? "-" + ONLY : ""}${LEGACY ? "-legacy" : ""}.json`), JSON.stringify({ base: BASE, sets: SETS, cam: CAM, log }, null, 2));
console.log(`done -> ${OUT}`);
