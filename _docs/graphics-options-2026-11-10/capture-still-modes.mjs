// Still-pose captures per anti-aliasing mode (10 Nov 2026): the converged still frame, and one moving frame, on a head
// with long alpha-hashed hair, at 1x. Checks by looking that MSAA and Off converge see-through hair once still and draw
// sharp moving frames, and that the multisampled target renders correctly.
// Usage (worktree root, dev server on 5182): node _docs/graphics-options-2026-11-10/capture-still-modes.mjs
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5182";
const OUT = "scripts/generated/decal-ghost/modes";
mkdirSync(OUT, { recursive: true });
const CAM = process.env.PROBE_CAM ?? "0.45,1.7,0.8,0,1.6,0";
const slots = { face: "head-face-01-base", upperBody: "streetwear-oversizedbomberjacket-nylon-redurban", lowerBody: "casual-loosejeans-denim-darkblue",
  feet: "casual-tallsneakers-canvas", hair: "hairs-highponytail-black" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const aa of ["taa", "msaa", "off"]) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(mode => localStorage.setItem("finals-outfit.graphics", JSON.stringify({ aa: mode })), aa);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}&cam=${CAM}&anim=0`, { waitUntil: "load", timeout: 240000 });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim && !!window.__temporalPreview", null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  const shots = await page.evaluate(async () => {
    const anim = window.__rigAnim, clock = anim.clock, status = window.__temporalPreview;
    const gl = document.querySelector("[data-viewer] canvas");
    const wait = test => new Promise(resolve => { const loop = () => test() ? resolve() : requestAnimationFrame(loop); requestAnimationFrame(loop); });
    clock.fixed = 1 / 60; clock.freezeAt = 60; clock.frozenMoving = false;
    await anim.play("outfit-idle");
    clock.steps = 0;
    await wait(() => clock.steps === 45);
    const moving = gl.toDataURL("image/png");
    await wait(() => clock.steps >= 60 && !status.motion && status.samples >= status.maxSamples && !status.fading);
    const still = gl.toDataURL("image/png");
    clock.fixed = null; clock.freezeAt = Infinity;
    return { moving, still, msaa: status.msaa };
  });
  for (const kind of ["moving", "still"]) writeFileSync(`${OUT}/${aa}-${kind}.png`, Buffer.from(shots[kind].split(",")[1], "base64"));
  console.log(aa, JSON.stringify({ msaa: shots.msaa, errors }));
  await context.close();
}
await browser.close();
