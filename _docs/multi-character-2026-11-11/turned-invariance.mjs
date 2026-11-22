// Turned-character invariance (11 Nov 2026, multi-character design, Phase 0). Read-only probe of the running dev app.
//
// A scene editor turns characters. If every shader works in a consistent world frame, turning the character, the
// camera, the lights and the environment map together by the same angle about the vertical axis must give the same
// image (up to accumulation noise). A material that silently assumes "the character faces +Z" (a world-axis constant,
// a light baked into a uniform, a frame read from the world instead of the rig) shows up as a difference.
// The character turns with its rig root here (the scene editor would turn a placement group above it; same matrices).
//
// Also records the WebGL renderer string, to know whether the cost probe ran on the real GPU.
//
// Usage (Git Bash, worktree root, dev server running: node _docs/multi-character-2026-11-11/serve-5186.mjs):
//   node _docs/multi-character-2026-11-11/turned-invariance.mjs
// Writes shots/turn-<outfit>-<deg>[-sign].png and turned-invariance.json beside this file. The PNGs are renders of
// game assets: they stay local (git-ignored), like earlier captures.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5186";
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots");
mkdirSync(shots, { recursive: true });
const code = (slots) => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const OUTFITS = {
  // Face (skin/world-surface route), ponytail (hair), bomber jacket (layered cloth), jeans, shoes.
  street: { face: "head-face-01-base", upperBody: "streetwear-oversizedbomberjacket-nylon-redurban",
    lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" },
  // Cel family (reads the camera's world axes) on the default face.
  cel: { face: "head-face-01-base", upperBody: "cute-animearchertop", lowerBody: "cute-animearcherskirt",
    feet: "samurai-getashoes-cotton-animearcher", hair: "hairs-highponytail-black" },
};

// In the page: turn character, camera, lights and environment together by `deg` about +Y through the origin.
// envSign: the sign of the environment map's turn. Both are captured at 90 deg; measured 11 Nov: +1 is the no-op
// (the -1 capture differs by 0.96 mean on the street outfit, +1 by 0), so the "-plus" capture is the valid 90 deg one.
const TURN = ({ deg, envSign }) => {
  const THREE = window.__THREE, root = window.__rigRoot, scene = root.parent;
  const state = root.__r3f.root.getState();
  const angle = THREE.MathUtils.degToRad(deg), axis = new THREE.Vector3(0, 1, 0);
  window.__turnBase ??= {
    camera: state.camera.position.clone(),
    lights: [], rootYaw: root.rotation.y,
  };
  const base = window.__turnBase;
  if (!base.lights.length) scene.traverse(o => { if (o.isLight && o.position) base.lights.push([o, o.position.clone()]); });
  root.rotation.y = base.rootYaw + angle;
  for (const [light, position] of base.lights) light.position.copy(position).applyAxisAngle(axis, angle);
  scene.environmentRotation.set(0, envSign * angle, 0);
  const target = state.controls?.target ?? new THREE.Vector3(0, 0.9, 0);
  state.camera.position.copy(base.camera).sub(target).applyAxisAngle(axis, angle).add(target);
  state.camera.lookAt(target);
  state.controls?.update?.();
  state.invalidate?.();
  return { lights: base.lights.length, target: target.toArray() };
};

const RENDERER = () => {
  const gl = window.__rigRoot.__r3f.root.getState().gl.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
};

// Wait until the still view has converged on the current input (samples at max and unchanged for a moment).
async function settle(page) {
  await page.waitForTimeout(800);
  await page.waitForFunction(() => {
    const s = window.__temporalPreview; return s && s.samples >= s.maxSamples && !s.motion;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(500);
}

const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL ?? "chrome", headless: true });
const result = { base: BASE, when: new Date().toISOString(), outfits: OUTFITS, captures: [] };
for (const [name, slots] of Object.entries(OUTFITS)) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // A hidden webdriver flag keeps the visitor defaults; anim=0 holds the still pose (deterministic).
  await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  await page.goto(`${BASE}/?reconstructed=1&anim=0&outfit=${code(slots)}`, { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigRoot && !!window.__temporalPreview", null, { timeout: 300000 });
  // The intro dialog sits over the viewer (v1 of this probe captured it eight times): dismiss it first.
  const intro = page.getByRole("button", { name: /View shared outfit|Enter builder/ });
  if (await intro.count()) await intro.first().click();
  await page.waitForTimeout(500);
  result.renderer ??= await page.evaluate(RENDERER);
  const canvas = page.locator("[data-viewer] canvas");
  for (const [deg, envSign] of [[0, 1], [90, -1], [90, 1], [180, 1]]) {
    await page.evaluate(TURN, { deg, envSign });
    await settle(page);
    const file = `turn-${name}-${deg}${deg === 90 ? (envSign > 0 ? "-plus" : "-minus") : ""}.png`;
    await canvas.screenshot({ path: path.join(shots, file) });
    result.captures.push({ outfit: name, deg, envSign, file });
    console.error(name, deg, envSign);
  }
  await context.close();
}
await browser.close();
writeFileSync(path.join(here, "turned-invariance.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ renderer: result.renderer, captures: result.captures.length }));
