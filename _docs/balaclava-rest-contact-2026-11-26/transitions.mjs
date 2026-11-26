// transitions.mjs: one page, outfit and body-type changes made in place (as the item and body-type pickers make them),
// with the balaclava's rest-contact push after each, and a capture.
//   node transitions.mjs <worktree> <base> <outDir>
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const [WT, BASE, OUT] = process.argv.slice(2);
const { chromium } = createRequire(path.join(WT, "package.json"))("playwright-core");
const { viewerUrl } = await import(pathToFileURL(path.join(WT, "scripts/visual-diff/viewer-url.mjs")).href);
const enc = (s) => "1." + Buffer.from(JSON.stringify({ slots: s })).toString("base64url");
const BALA = "streetwear-balaclava-cotton-black";
mkdirSync(OUT, { recursive: true });
// A persistent profile keeps the model cache between runs (the dev servers share the 127.0.0.1 cache partition).
const browser = await chromium.launchPersistentContext(process.env.SWEEP_PROFILE ?? path.join(OUT, "..", "sweep-profile"),
  { channel: "chrome", headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = browser.pages()[0] ?? await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" || /rest contact/.test(m.text())) errors.push(m.text().slice(0, 300)); });
const settle = async () => {
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 });
  await page.waitForTimeout(4000);
};
const read = () => page.evaluate(() => {
  const out = [];
  window.__rigRoot.traverse((m) => {
    if (m.isMesh && m.userData.headWrapMorphs !== undefined)
      out.push({ mesh: m.userData.sourceMesh.split(".").pop(), pushMm: +((m.userData.restContactMaxPush ?? 0) * 1000).toFixed(2),
        version: m.userData.restContactVersion ?? 0, morphs: m.userData.headWrapMorphs });
  });
  return out;
});
const log = [];
const step = async (name, action) => {
  errors.length = 0;
  if (action) await page.evaluate(action);
  await settle();
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: await page.locator("canvas").first().boundingBox() });
  const row = { name, parts: await read(), errors: [...errors] };
  log.push(row); console.log(JSON.stringify(row));
};
await page.goto(viewerUrl(BASE, `outfit=${enc({ face: "head-face-32-base", facewear: BALA })}&view=0_1.700_0.420_0_1.690_0`),
  { waitUntil: "networkidle", timeout: 180000 });
const store = `(await import("/the-finals-outfit/src/store/useBuildStore.ts")).useBuildStore.getState()`;
await step("t1-face32", null);
await step("t2-face01", `(async () => { ${store}.load({ face: "head-face-01-base", facewear: "${BALA}" }); })()`);
await step("t3-face32-again", `(async () => { ${store}.load({ face: "head-face-32-base", facewear: "${BALA}" }); })()`);
await step("t4-androgynous", `(async () => { ${store}.setBodyType("androgynous"); })()`);
await step("t5-masculine", `(async () => { ${store}.setBodyType("masculine"); })()`);
await step("t6-balaclava-off", `(async () => { ${store}.unequip("facewear"); })()`);
await step("t7-balaclava-on", `(async () => { ${store}.load({ face: "head-face-32-base", facewear: "${BALA}" }); })()`);
writeFileSync(path.join(OUT, "transitions.json"), JSON.stringify(log, null, 1));
await browser.close();
