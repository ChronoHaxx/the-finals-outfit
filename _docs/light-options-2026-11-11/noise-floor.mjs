// Noise floor for the default-look comparison (12 Nov 2026): the same build captured twice under automation, and a
// map of where two captures differ. node noise-floor.mjs <urlA> <urlB> <outDir>  (A twice, then B once)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { PNG } = require("pngjs");
const pm = require("pixelmatch"); const pixelmatch = pm.default ?? pm;
const [a, b, out] = process.argv.slice(2);
if (existsSync(out)) throw new Error(`refusing to overwrite ${out}`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader"] });
async function capture(url, path, lobby) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const c = document.querySelector("canvas[data-engine]"); return c && c.width > 300; }, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__rigIdle === true, null, { timeout: 180000 });
  await page.waitForTimeout(9000);
  if (lobby) { await page.click('button[title="Toggle scene lighting"]'); await page.waitForTimeout(9000); }
  await page.evaluate(() => document.querySelectorAll("[data-viewer] > div").forEach(d => { if (!d.querySelector("canvas")) d.style.visibility = "hidden"; }));
  await page.locator("[data-viewer]").first().screenshot({ path });
  await context.close();
}
function diff(x, y, map) {
  const A = PNG.sync.read(readFileSync(x)), B = PNG.sync.read(readFileSync(y));
  const o = new PNG({ width: A.width, height: A.height });
  const differing = pixelmatch(A.data, B.data, o.data, A.width, A.height, { threshold: 0, diffColor: [255, 0, 0], alpha: 0.3 });
  let max = 0; for (let i = 0; i < A.data.length; i++) max = Math.max(max, Math.abs(A.data[i] - B.data[i]));
  writeFileSync(map, PNG.sync.write(o));
  return { differing, max };
}
const r = {};
for (const lobby of [false, true]) {
  const t = lobby ? "lobby" : "studio";
  await capture(a, join(out, `${t}-a1.png`), lobby);
  await capture(a, join(out, `${t}-a2.png`), lobby);
  await capture(b, join(out, `${t}-b.png`), lobby);
  r[`${t} A vs A`] = diff(join(out, `${t}-a1.png`), join(out, `${t}-a2.png`), join(out, `${t}-map-aa.png`));
  r[`${t} A vs B`] = diff(join(out, `${t}-a1.png`), join(out, `${t}-b.png`), join(out, `${t}-map-ab.png`));
}
await browser.close();
writeFileSync(join(out, "report.json"), JSON.stringify(r, null, 1));
console.log(JSON.stringify(r));
