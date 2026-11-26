// Thigh captures for the thigh_roll_vpj investigation (26 Nov 2026), on the live site (production build: the
// reconstructed route is its default; ?reconstructed=1 is passed anyway, as scripts/visual-diff/viewer-url.mjs does).
//
//   node _docs/thigh-roll-vpj-2026-11/capture.mjs <outDir> <plan.json>
//
// plan.json: { base, cases: [{ name, codes, bt, view, emote, t, ownbind? }] }
//   codes   share codes for the #/?o=2.<codes> link (src/lib/share-url.ts); bt "a" = Androgynous, "" = Masculine
//   view    the production view= link value (px_py_pz_tx_ty_tz)
//   emote/t a paused frame of that clip (share-pose.ts): the idle is "outfit-idle"; omit emote for the still pose
//   ownbind a key of ownbind-offsets.json: after the normal capture, the garment's bone inverses for its offset joints
//           are replaced in the page by boneInverse * B * M_j * B^-1, so the garment is drawn as if skinned with its OWN
//           inverse binds (what a UE leader-pose follower would do) instead of the body's. Page state only.
//   deformOff true: also capture with the ported deformation rig off (window.__rigAnim.deform(false): its joints go back
//           to bind), and record each leg helper's angle from its bind before and after (rollAngles).
// One headless Chrome, closed at the end. Per case: <name>.png (the canvas), <name>_ownbind.png, and capture.json.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const [outArg, planArg] = process.argv.slice(2);
if (!outArg || !planArg) throw new Error("usage: capture.mjs <outDir> <plan.json>");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const plan = JSON.parse(readFileSync(planArg, "utf8"));
const offsets = JSON.parse(readFileSync(join(HERE, "ownbind-offsets.json"), "utf8"));
const SETTLE = 3000;

function url(c) {
  const hash = [`o=2.${c.codes.join(".")}`, c.bt ? `bt=${c.bt}` : "", `view=${c.view}`,
    c.emote ? `emote=${c.emote}&t=${c.t}&paused=1` : ""].filter(Boolean).join("&");
  return `${plan.base.replace(/\/$/, "")}/?reconstructed=1#/?${hash}`;
}

async function settle(page, log) {
  try {
    await page.locator("canvas").first().waitFor({ state: "visible", timeout: 90000 });
    await page.waitForFunction("window.__rigIdle === true", null, { timeout: 180000 });
  } catch (e) { log.push(`wait: ${e.message.split("\n")[0]}`); return false; }
  await page.waitForTimeout(SETTLE);
  return true;
}

async function shot(page, path) {
  const box = await page.locator("canvas").first().boundingBox();
  await page.screenshot({ path, clip: box ?? undefined });
}

// Runs in the page: find the garment's skinned meshes under the animation root's scene and rewrite the inverses.
function applyOwnBind({ sourceMesh, joints }) {
  const anim = window.__rigAnim?.animator;
  let top = anim?.root;
  if (!top) return { error: "no animation root" };
  while (top.parent) top = top.parent;
  const done = [];
  top.traverse((o) => {
    if (!o.isSkinnedMesh || o.userData.sourceMesh !== sourceMesh) return;
    const B = o.bindMatrix, Bi = o.bindMatrix.clone().invert();
    o.skeleton.bones.forEach((bone, i) => {
      const j = joints[bone.name];
      if (!j) return;
      const M = o.bindMatrix.clone().set(...j.rowMajor);
      o.skeleton.boneInverses[i] = o.skeleton.boneInverses[i].clone().multiply(B).multiply(M).multiply(Bi);
      done.push(`${o.name || "mesh"}:${bone.name}`);
    });
    o.skeleton.computeBoneTexture?.();
  });
  return { replaced: done };
}

// Runs in the page: each leg helper joint's local rotation against its bind (DeformationRig's own bind table), degrees.
function rollAngles() {
  const d = window.__rigAnim?.animator?.deform;
  if (!d) return { error: "no deformation rig" };
  const out = {};
  for (const n of ["thigh_roll_vpj_l", "thigh_roll_vpj_r", "knee_vpj_l", "knee_vpj_r", "thigh_front_vpj_l", "thigh_back_vpj_l"]) {
    const bone = d.bones.get(n), bind = d.bindLocal.get(n);
    if (!bone || !bind) continue;
    const dot = Math.min(1, Math.abs(bone.quaternion.dot(bind.quaternion)));
    out[n] = Math.round(2 * Math.acos(dot) * 180 / Math.PI * 100) / 100;
  }
  return out;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const c of plan.cases) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1.5 });
    const log = [];
    page.on("console", (m) => { if (m.type() === "error") log.push(`${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
    const u = url(c), t0 = Date.now();
    await page.goto(u, { waitUntil: "load", timeout: 120000 });
    let idle = await settle(page, log);
    // Hide the viewer's overlays (H, lib/viewer-chrome.ts), then let the accumulator converge again.
    await page.mouse.click(5, 500).catch(() => {});
    await page.keyboard.press("h");
    await page.waitForTimeout(500);
    idle = (await settle(page, log)) && idle;
    await shot(page, join(out, `${c.name}.png`));
    const parts = await page.evaluate(() => {
      const s = window.__sourceAssembly;
      return s ? Object.values(s.items ?? {}).flatMap(v => (v.parts ?? []).map(p => p.skeletalMesh || p.staticMesh)) : null;
    }).catch(() => null);
    const row = { name: c.name, url: u, idle, ms: Date.now() - t0, parts, log };
    if (c.ownbind) {
      const spec = offsets[c.ownbind];
      // The still pose binds no mixer (navigator.webdriver: no autoplay), so the animation root is unset: play the
      // idle once and stop, which restores the still pose and leaves the root known.
      const hasRoot = await page.evaluate(() => !!window.__rigAnim?.animator?.root);
      if (!hasRoot) {
        await page.evaluate(async () => { await window.__rigAnim.play("outfit-idle", 0); window.__rigAnim.stop(); });
        await page.waitForTimeout(1500);
      }
      row.ownbind = await page.evaluate(applyOwnBind, { sourceMesh: spec.sourceMesh, joints: spec.joints });
      await page.waitForTimeout(500);
      await page.waitForFunction("window.__rigIdle === true", null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(SETTLE);
      await shot(page, join(out, `${c.name}_ownbind.png`));
    }
    if (c.deformOff) {
      row.rollAngles = { deformOn: await page.evaluate(rollAngles) };
      await page.evaluate(() => window.__rigAnim.deform(false));
      await page.waitForTimeout(500);
      await page.waitForFunction("window.__rigIdle === true", null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(SETTLE);
      row.rollAngles.deformOff = await page.evaluate(rollAngles);
      await shot(page, join(out, `${c.name}_deformoff.png`));
    }
    results.push(row);
    console.log(`${c.name}: idle=${idle} ${row.ms} ms, log ${log.length}${row.ownbind ? `, ownbind ${JSON.stringify(row.ownbind).slice(0, 160)}` : ""}${row.rollAngles ? `, rollAngles ${JSON.stringify(row.rollAngles)}` : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "capture.json"), JSON.stringify({ base: plan.base, at: new Date().toISOString(), results }, null, 1));
