// Browser-environment checks (10 Nov 2026): what the site does without WebGL (LibreWolf's default) and how much slower
// JavaScript runs without the JIT (Edge's "enhanced security" runs unfamiliar sites without JIT; emulated here with V8
// flags that keep only the Ignition interpreter while leaving WebAssembly in place).
// Usage (Git Bash or PowerShell, worktree root, dev server on 5182):
//   node _docs/graphics-options-2026-11-10/browser-env-check.mjs [bench|site] [config names, comma separated]
// Configs: chrome, chrome-nowebgl, chrome-nojit, edge, edge-nojit.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [mode = "bench", only = ""] = process.argv.slice(2);
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5182";
const OUT = "scripts/generated/browser-env";
mkdirSync(OUT, { recursive: true });
const NOJIT = "--js-flags=--no-opt --no-maglev --no-sparkplug";
const configs = {
  chrome: { channel: "chrome", args: [] },
  "chrome-nowebgl": { channel: "chrome", args: ["--disable-3d-apis"] },
  "chrome-nojit": { channel: "chrome", args: [NOJIT] },
  edge: { channel: "msedge", args: [] },
  "edge-nojit": { channel: "msedge", args: [NOJIT] },
};
const names = only ? only.split(",") : Object.keys(configs);

// A small, allocation-heavy JS loop in the shape of a per-frame matrix update (Float32Array math + object churn).
const bench = () => {
  const t0 = performance.now();
  const m = new Float32Array(16 * 400);
  let acc = 0;
  for (let frame = 0; frame < 60; frame++) {
    for (let b = 0; b < 400; b++) {
      const o = { x: Math.sin(b + frame), y: Math.cos(b * 0.5), z: b * 0.001 };
      for (let k = 0; k < 16; k++) m[b * 16 + k] = o.x * k + o.y * (16 - k) + o.z;
      acc += m[b * 16 + (frame & 15)];
    }
  }
  const ms = performance.now() - t0;
  return { ms: +ms.toFixed(1), acc: Math.round(acc), wasm: typeof WebAssembly === "object", webgl2: !!document.createElement("canvas").getContext("webgl2") };
};

const results = {};
for (const name of names) {
  const { channel, args } = configs[name];
  let browser;
  try { browser = await chromium.launch({ channel, headless: true, args }); }
  catch (e) { results[name] = { error: String(e).slice(0, 200) }; console.log(name, results[name]); continue; }
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [], consoleErrors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  if (mode === "bench") {
    await page.goto("about:blank");
    await page.evaluate(bench); // warm
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(await page.evaluate(bench));
    results[name] = { ua: await page.evaluate(() => navigator.userAgent), median: runs.map(r => r.ms).sort((a, b) => a - b)[2], wasm: runs[0].wasm, webgl2: runs[0].webgl2 };
  } else {
    const t0 = Date.now();
    await page.goto(`${BASE}/?reconstructed=1`, { waitUntil: "load", timeout: 240000 });
    await page.waitForTimeout(15000);
    await page.screenshot({ path: join(OUT, `${name}-landing.png`) });
    // Enter the builder (the landing page has an "Enter builder" button).
    const enter = page.getByRole("button", { name: /enter builder/i });
    if (await enter.count()) { await enter.click(); await page.waitForTimeout(20000); }
    await page.screenshot({ path: join(OUT, `${name}-builder.png`) });
    results[name] = { seconds: Math.round((Date.now() - t0) / 1000), errors, consoleErrors: consoleErrors.slice(0, 8),
      bodyText: (await page.evaluate(() => document.body.innerText)).slice(0, 300) };
  }
  console.log(name, JSON.stringify(results[name]));
  await browser.close();
}
writeFileSync(join(OUT, `${mode}.json`), JSON.stringify(results, null, 1));
