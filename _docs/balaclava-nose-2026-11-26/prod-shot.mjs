// prod-shot.mjs: the production site (or any build of it) with an outfit, a camera view and optionally a held pose.
// Automated (navigator.webdriver stays true), so the patch-notes dialog stays closed and sounds stay off.
//   node prod-shot.mjs <worktree> <siteBase> <outDir> <shots.json>
// shots.json: [{ "name", "slots": {face, facewear, ...}, "view"?: "x_y_z_tx_ty_tz", "extra"?: "emote=..&t=..&paused=1" }]
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const [WT, SITE, OUT, SHOTS] = process.argv.slice(2);
const { chromium } = createRequire(path.join(WT, "package.json"))("playwright-core");
const enc = (s) => "1." + Buffer.from(JSON.stringify({ slots: s })).toString("base64url");
const FRONT = "0_1.700_0.420_0_1.690_0";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
const log = [];
for (const s of JSON.parse(readFileSync(SHOTS, "utf8"))) {
  errors.length = 0;
  const url = `${SITE.replace(/\/+$/, "")}/?outfit=${enc(s.slots)}&view=${s.view ?? FRONT}${s.extra ? "&" + s.extra : ""}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 180000 });
  const idle = await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 }).then(() => true, () => false);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, `${s.name}.png`), clip: await page.locator("canvas").first().boundingBox() });
  const row = { name: s.name, url, idle, errors: [...errors] };
  log.push(row); console.log(JSON.stringify(row));
}
writeFileSync(path.join(OUT, "shots.json"), JSON.stringify(log, null, 1));
await browser.close();
