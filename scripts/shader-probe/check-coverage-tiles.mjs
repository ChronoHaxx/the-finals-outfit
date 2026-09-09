// Synthetic GPU regression: masks for UV tile 1 must not repeat into tile 0.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
writeFileSync("scripts/generated/shader-probe/mask-harness.html", `<!doctype html><html><head><link rel="icon" href="data:,"></head>
  <body><script type="module">import * as THREE from 'three'; window.__THREE=THREE;</script></body></html>`);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("http://127.0.0.1:5173/scripts/generated/shader-probe/mask-harness.html", { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__THREE);
  const result = await page.evaluate(async () => {
    const T = window.__THREE;
    const { BodyDecalManager } = await import("/src/rig/BodyDecals.ts");
    const manager = new BodyDecalManager(new T.TextureLoader(), "unused");
    const mask = (tiles, x, width) => {
      const c = document.createElement("canvas"); c.width = 128*tiles; c.height = 128;
      const ctx = c.getContext("2d"); ctx.fillStyle = "black"; ctx.fillRect(0,0,c.width,c.height);
      ctx.fillStyle = "white"; ctx.fillRect(x*128,0,width*128,128); return c.toDataURL();
    };
    const one = mask(1,0,.25), two = mask(2,1.25,.25);
    const renderer = new T.WebGLRenderer(), target = new T.WebGLRenderTarget(128,4);
    renderer.setSize(128,4); renderer.setClearColor(0x000000);
    const camera = new T.OrthographicCamera(-1,1,1,-1,0,2); camera.position.z = 1;
    const geometry = new T.PlaneGeometry(2,2);
    for (let i = 0; i < geometry.attributes.uv.count; i++) geometry.attributes.uv.setX(i, geometry.attributes.uv.getX(i)*2);
    const material = new T.MeshBasicMaterial({ color: "white" });
    manager.registerTarget("body", [material]);
    const scene = new T.Scene(); scene.add(new T.Mesh(geometry,material));
    const checks = [];
    for (const [name, urls, layouts, ranges] of [
      ["mixed tiles", [one,two], { [two]: [2,1] }, [[0,.25],[1.25,1.5]]],
      ["legacy tile only", [one], {}, [[0,.25]]],
      ["clear coverage", [], {}, []],
    ]) {
      const old = manager.bodyHideTex;
      manager.setBodyHideMasks(urls,layouts);
      while (urls.length && manager.bodyHideTex === old) await new Promise(requestAnimationFrame);
      const pixels = new Uint8Array(128*4*4);
      renderer.setRenderTarget(target); renderer.render(scene,camera);
      renderer.readRenderTargetPixels(target,0,0,128,4,pixels);
      for (let x = 0; x < 128; x++) {
        const u = (x+.5)/64, hidden = ranges.some(([lo,hi]) => u >= lo && u < hi);
        const actual = pixels[(128+x)*4];
        if (hidden ? actual > 5 : actual < 250) throw new Error(`${name}: UV ${u}, pixel ${actual}`);
      }
      checks.push({ name, pixels: 128, passed: true });
    }
    manager.clearAll(); geometry.dispose(); material.dispose(); target.dispose(); renderer.dispose();
    return checks;
  });
  assert.deepEqual(errors, []);
  writeFileSync("visual-diff/reconstructed/coverage-tiles.json", JSON.stringify(result,null,2));
  console.log("Coverage union, tile isolation and clearing passed 384 GPU pixel checks");
} finally { await browser.close(); }
