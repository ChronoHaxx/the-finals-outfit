// sweep2.mjs: like sweep.mjs, but one page per camera view: each outfit after the first is put on in place through the
// build store (as the item and body-type pickers do), which avoids reloading every module of the dev server per shot.
//   node sweep2.mjs <worktree> <base> <outDir> <shots.json>
// shots.json: [{ name, slots, view?: "x_y_z_tx_ty_tz", bodyType?: "androgynous", extra?: URL-only switches (emote) }]
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
const settle = async (ms) => {
  await page.waitForTimeout(1500);
  const idle = await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 }).then(() => true, () => false);
  await page.waitForTimeout(ms);
  return idle;
};
const STORE = `(await import("/the-finals-outfit/src/store/useBuildStore.ts")).useBuildStore.getState()`;
let pageKey = null;
for (const s of JSON.parse(readFileSync(SHOTS, "utf8"))) {
  if (existsSync(path.join(OUT, `${s.name}.png`))) continue; // resumable
  errors.length = 0;
  let row;
  try {
    const key = `${s.view ?? FRONT}|${s.extra ?? ""}`;
    let idle;
    if (key !== pageKey || s.extra) { // a new camera, or URL-only switches: load the page with this outfit
      const url = viewerUrl(BASE, `outfit=${enc(s.slots)}&view=${s.view ?? FRONT}${s.extra ? "&" + s.extra : ""}`);
      await page.goto(url, { waitUntil: "load", timeout: 180000 });
      await page.evaluate(`(async () => { ${STORE}.setBodyType("${s.bodyType ?? "masculine"}"); })()`);
      idle = await settle(5000);
      pageKey = key;
    } else {
      await page.evaluate(`(async () => { const st = ${STORE}; st.setBodyType("${s.bodyType ?? "masculine"}"); st.load(${JSON.stringify(s.slots)}); })()`);
      idle = await settle(3500);
    }
    await page.screenshot({ path: path.join(OUT, `${s.name}.png`), clip: await page.locator("canvas").first().boundingBox() });
    const state = await page.evaluate(`(async () => {
      const st = ${STORE}, parts = [], heads = new Set();
      window.__rigRoot.traverse((m) => {
        if (m.isMesh && m.userData.headWrapMorphs !== undefined)
          parts.push({ mesh: (m.userData.sourceMesh ?? m.name).split(".").pop(), pushMm: +((m.userData.restContactMaxPush ?? 0) * 1000).toFixed(2), visible: m.visible, morphs: m.userData.headWrapMorphs });
        if (m.isSkinnedMesh && /SK_Head_/.test(m.userData.sourceMesh ?? "")) heads.add(m.userData.sourceMesh.split(".").pop());
      });
      return { bodyType: st.bodyType, build: st.build, parts, heads: [...heads] };
    })()`);
    const want = Object.entries(s.slots).every(([slot, id]) => state.build[slot] === id);
    row = { name: s.name, idle, buildMatches: want, bodyType: state.bodyType, heads: state.heads, parts: state.parts, errors: [...errors] };
  } catch (error) {
    row = { name: s.name, failed: String(error).slice(0, 300), errors: [...errors] };
    pageKey = null;
  }
  appendFileSync(log, JSON.stringify(row) + "\n");
  console.log(JSON.stringify(row));
}
await browser.close();
