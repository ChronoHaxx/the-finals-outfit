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
  "1." +
  Buffer.from(JSON.stringify({ slots: s }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const ids = process.argv.slice(2);
const cam = { pos: [0, 1.74, 0.7], t: [0, 1.69, 0], fov: 30 };
async function launch() {
  for (const c of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel: c, headless: true });
    } catch {}
  }
  throw new Error("no chrome");
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 480, height: 840 }, deviceScaleFactor: 1.4 });
mkdirSync(OUT, { recursive: true });
let n = 0;
for (const id of ids) {
  const it = byId.get(id);
  if (!it) {
    console.log("MISSING", id);
    continue;
  }
  await page.goto(
    `http://localhost:5173/?outfit=${enc({ hair: id })}&cam=${[...cam.pos, ...cam.t].join(",")}&fov=${cam.fov}&pose=a`,
    { waitUntil: "networkidle" },
  );
  try {
    await page.locator("canvas").first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForFunction("window.__rigIdle === true", null, { timeout: 30000 });
  } catch {}
  await page.waitForTimeout(700);
  await page.screenshot({
    path: join(OUT, `${id}.render.png`),
    clip: await page.locator("canvas").first().boundingBox(),
  });
  const icon = resolve(ROOT, "public", it.imageUrl);
  if (existsSync(icon)) copyFileSync(icon, join(OUT, `${id}.icon.webp`));
  n++;
  console.log(`[${n}/${ids.length}] ${id}`);
}
await browser.close();
console.log("done ->", OUT);
