// Static bias of the moving path (6 Nov): freeze the idle at a step but keep the view on the motion path
// (clock.frozenMoving), let it run 120 frames, and score it against the converged still truth of the same step.
import { chromium } from "playwright-core";
import sharp from "sharp";
const [quality = "balanced", k = "120"] = process.argv.slice(2);
const slots = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-shortskirt-blackmesh", feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:5181/?reconstructed=1&outfit=${outfit}&cam=0.55,1.72,0.75,0,1.62,-0.05&anim=0&quality=${quality}`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim && !!window.__temporalPreview", null, { timeout: 180000 });
await page.waitForTimeout(1500);
const shot = await page.evaluate(async k => {
  const anim = window.__rigAnim, clock = anim.clock, status = window.__temporalPreview, gl = document.querySelector("[data-viewer] canvas");
  clock.fixed = 1 / 60; clock.frozenMoving = true; await anim.play("outfit-idle"); clock.steps = 0; clock.freezeAt = k;
  const out = {};
  await new Promise(r => { let held = 0; const loop = () => { if (clock.steps >= k) held++; if (held === 120) { out.moving = gl.toDataURL("image/png"); out.status = { ...status }; r(); return; } requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
  return out;
}, Number(k));
const truthUrl = `scripts/generated/anim-export/truth/outfit-idle/truth-${k}.png`;
const dec = async b => { const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const T = await dec(truthUrl), M = await dec(Buffer.from(shot.moving.split(",")[1], "base64"));
const ow = (img, i) => { const a = img.data[4 * i + 3] / 255; return (.2126 * img.data[4 * i] + .7152 * img.data[4 * i + 1] + .0722 * img.data[4 * i + 2]) * a + 255 * (1 - a); };
let c = 0, e = 0, signed = 0, ca = 0, ea = 0;
for (let i = 0; i < T.w * T.h; i++) { const a = T.data[4 * i + 3], l = .2126 * T.data[4 * i] + .7152 * T.data[4 * i + 1] + .0722 * T.data[4 * i + 2];
  if (a > 8 && l < 50) { c++; const d = ow(M, i) - ow(T, i); e += Math.abs(d); signed += d; ea += Math.abs(M.data[4 * i + 3] - a); ca++; } }
console.log(JSON.stringify({ quality, k, status: { motion: shot.status.motion, motionFrames: shot.status.motionFrames, reprojected: shot.status.reprojected }, hairCorePixels: c, error: +(e / c).toFixed(2), signedLuma: +(signed / c).toFixed(2), alphaError: +(ea / ca).toFixed(2) }));
await sharp(Buffer.from(shot.moving.split(",")[1], "base64")).toFile(`scripts/generated/anim-export/truth/outfit-idle/static-${quality}-${k}.png`);
await browser.close();
