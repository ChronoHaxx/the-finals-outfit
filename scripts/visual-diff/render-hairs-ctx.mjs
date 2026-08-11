// Render hairs IN CONTEXT (default outfit + the hair, on the real head) at a head-framed camera —
// the honest test vs the isolated headless render. Usage: node render-hairs-ctx.mjs <id>...
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const SD = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SD, "../..");
const OUT = resolve(ROOT, "visual-diff/hairs");
const items = JSON.parse(readFileSync(resolve(ROOT, "src/data/items.json"), "utf8"));
const byId = new Map(items.map((i) => [i.id, i]));
const enc = (s) =>
  "1." + Buffer.from(JSON.stringify({ slots: s })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const base = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black" };
const cam = { pos: [0, 1.66, 0.72], t: [0, 1.62, 0], fov: 30 };
async function launch() {
  for (const c of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel: c, headless: true }); } catch {}
  }
  throw new Error("no chrome");
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 480, height: 840 }, deviceScaleFactor: 1.4 });
mkdirSync(OUT, { recursive: true });
for (const id of process.argv.slice(2)) {
  const it = byId.get(id);
  if (!it) { console.log("MISSING", id); continue; }
  await page.goto(
    `http://localhost:5173/?outfit=${enc({ ...base, hair: id })}&cam=${[...cam.pos, ...cam.t].join(",")}&fov=${cam.fov}&pose=a`,
    { waitUntil: "networkidle" },
  );
  try {
    await page.locator("canvas").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForFunction("window.__rigIdle === true", null, { timeout: 30000 });
  } catch {}
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${id}.ctx.png`), clip: await page.locator("canvas").first().boundingBox() });
  const icon = resolve(ROOT, "public", it.imageUrl);
  if (existsSync(icon)) copyFileSync(icon, join(OUT, `${id}.icon.webp`));
  console.log("ctx", id);
}
await browser.close();
console.log("done");
