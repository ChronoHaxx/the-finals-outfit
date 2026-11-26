// sweep.mjs: outfits at idle (or a held emote frame) on a dev server, with each head-wrapped part's rest-contact push.
//   node sweep.mjs <worktree> <base> <outDir> <shots.json>
// shots.json: [{ name, slots, view?: "x_y_z_tx_ty_tz", extra?: "bodyType=androgynous&emote=..." }]
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
const [WT, BASE, OUT, SHOTS] = process.argv.slice(2);
const { chromium } = createRequire(path.join(WT, "package.json"))("playwright-core");
const { viewerUrl } = await import(pathToFileURL(path.join(WT, "scripts/visual-diff/viewer-url.mjs")).href);
const enc = (s) => "1." + Buffer.from(JSON.stringify({ slots: s })).toString("base64url");
const FRONT = "0_1.700_0.420_0_1.690_0";
mkdirSync(OUT, { recursive: true });
const log = path.join(OUT, "sweep.jsonl");
// A persistent profile keeps the model cache between runs (the dev servers share the 127.0.0.1 cache partition).
const browser = await chromium.launchPersistentContext(process.env.SWEEP_PROFILE ?? path.join(OUT, "..", "sweep-profile"),
  { channel: "chrome", headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = browser.pages()[0] ?? await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" || /rest contact/.test(m.text())) errors.push(m.text().slice(0, 300)); });
for (const s of JSON.parse(readFileSync(SHOTS, "utf8"))) {
  if (existsSync(path.join(OUT, `${s.name}.png`))) continue; // resumable
  errors.length = 0;
  const url = viewerUrl(BASE, `outfit=${enc(s.slots)}&view=${s.view ?? FRONT}${s.extra ? "&" + s.extra : ""}`);
  let row;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 180000 });
    const idle = await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 }).then(() => true, () => false);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(OUT, `${s.name}.png`), clip: await page.locator("canvas").first().boundingBox() });
    const parts = await page.evaluate(() => {
      const out = [];
      window.__rigRoot?.traverse((m) => {
        if (m.isMesh && m.userData.headWrapMorphs !== undefined)
          out.push({ mesh: (m.userData.sourceMesh ?? m.name).split(".").pop(), pushMm: +((m.userData.restContactMaxPush ?? 0) * 1000).toFixed(2), visible: m.visible });
      });
      return out;
    });
    row = { name: s.name, idle, parts, errors: [...errors] };
  } catch (error) {
    row = { name: s.name, failed: String(error).slice(0, 300), errors: [...errors] };
  }
  appendFileSync(log, JSON.stringify(row) + "\n");
  console.log(JSON.stringify(row));
}
await browser.close();
