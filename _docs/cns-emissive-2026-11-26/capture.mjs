// Front-on facewear/eyewear captures for the CNS emissive check (26 Nov 2026).
//
// node _docs/cns-emissive-2026-11-26/capture.mjs <base> <outDir> [live]
//   <base>  e.g. https://chronohaxx.github.io/the-finals-outfit or http://127.0.0.1:5231/the-finals-outfit
//   live    the base is a production build: it ignores the dev cam/fov/pose switches, so the camera
//           rides in the production view= link instead (fov 35, so the camera sits closer).
// URLs go through scripts/visual-diff/viewer-url.mjs viewerUrl(), so each carries reconstructed=1.
// One headless browser, closed at the end. Per item: <id>.png (the canvas) and a console/error log.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { viewerUrl, settleMs } from "../../scripts/visual-diff/viewer-url.mjs";

const [base, outArg, mode] = process.argv.slice(2);
if (!base || !outArg) throw new Error("usage: capture.mjs <base> <outDir> [live]");
const live = mode === "live";
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const HEAD = "head-face-23-base";
// [id, slot]: the two audit failures, the KCP sibling, two other emissive pieces, and the CNS visor's own item.
const ITEMS = [
  ["military-rebreather-rubber-cns", "facewear"],
  ["samurai-facemask-base-cns", "facewear"],
  ["military-rebreather-rubber-kcp", "facewear"],
  ["scifi-hackergoggles-metal", "eyewear"],
  ["attachment-mask-gasmask-01-headwear", "facewear"],
  ["streetwear-vaporwaveglasses-plastic-cns", "eyewear"],
];
const enc = (slots) => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// verify-render2.mjs's facewear/eyewear cameras (fov 26 / 24); the production view sits at the same framing with fov 35.
const CAM = { facewear: [0, 1.71, 0.55, 0, 1.68, 0, 26], eyewear: [0, 1.71, 0.5, 0, 1.69, 0, 24] };
const LIVE_VIEW = { facewear: "0_1.71_0.41_0_1.68_0", eyewear: "0_1.71_0.34_0_1.69_0" };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const [id, slot] of ITEMS) {
    const page = await browser.newPage({ viewport: { width: 480, height: 840 }, deviceScaleFactor: 1.4 });
    const log = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log.push(`${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => log.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    const c = CAM[slot];
    const query = `outfit=${enc({ face: HEAD, [slot]: id })}` +
      (live ? `&view=${LIVE_VIEW[slot]}` : `&cam=${c.slice(0, 6).join(",")}&fov=${c[6]}&pose=a`);
    const url = viewerUrl(base, query);
    const t0 = Date.now();
    let idle = false;
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
      await page.locator("canvas").first().waitFor({ state: "visible", timeout: 60000 });
      await page.waitForFunction("window.__rigIdle === true", null, { timeout: 120000 });
      idle = true;
    } catch (e) { log.push(`wait: ${e.message.split("\n")[0]}`); }
    await page.waitForTimeout(settleMs(600));
    const box = await page.locator("canvas").first().boundingBox();
    await page.screenshot({ path: join(out, `${id}.png`), clip: box ?? undefined });
    const parts = await page.evaluate(() => {
      const s = window.__sourceAssembly;
      return s ? Object.entries(s.items ?? {}).map(([k, v]) => [k, (v.parts ?? []).map(p => p.staticMesh || p.skeletalMesh)]) : null;
    }).catch(() => null);
    results.push({ id, slot, url, idle, ms: Date.now() - t0, parts, log });
    console.log(`${id}: idle=${idle} ${Date.now() - t0} ms, ${log.length} log lines`);
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "capture.json"), JSON.stringify({ base, live, at: new Date().toISOString(), results }, null, 1));
