import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "../..");
const side = process.env.AB_SIDE;
if (side !== "before" && side !== "after" && side !== "green-off") throw new Error("AB_SIDE must be before, after, or green-off");
const cohort = JSON.parse(readFileSync(resolve(root, "scripts/material-ab-cohort.json"), "utf8"));
const items = JSON.parse(readFileSync(resolve(root, "src/data/items.json"), "utf8"));
const byId = new Map(items.map((item) => [item.id, item]));
const cams = {
  face: { pos: [0, 1.71, 0.55], target: [0, 1.68, 0], fov: 26 },
  eyewear: { pos: [0, 1.71, 0.5], target: [0, 1.69, 0], fov: 24 },
  earrings: { pos: [0.5, 1.7, 0.35], target: [0.05, 1.68, 0], fov: 22 },
  facewear: { pos: [0, 1.71, 0.55], target: [0, 1.68, 0], fov: 26 },
  upperBody: { pos: [0, 1.32, 1.5], target: [0, 1.2, 0], fov: 32 },
  outerwear: { pos: [0, 1.25, 1.6], target: [0, 1.1, 0], fov: 33 },
  lowerBody: { pos: [0, 0.62, 1.7], target: [0, 0.6, 0], fov: 32 },
  blush: { pos: [0, 1.71, 0.5], target: [0, 1.68, 0], fov: 22 },
  bodyPaint: { pos: [0, 1.35, 1.8], target: [0, 1.15, 0], fov: 40 },
};
const headSlots = new Set(["blush", "eyes", "tattoo", "facialHair", "earrings", "eyewear", "facewear", "headwear", "hair", "bodyPaint"]);
const encode = (slots) =>
  "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const out = resolve(root, "visual-diff", "out", "ab");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 760, height: 1100 }, deviceScaleFactor: 1 });
for (const entry of cohort) {
  if (process.env.AB_ONLY && process.env.AB_ONLY !== entry.id) continue;
  const item = byId.get(entry.id);
  if (!item) throw new Error(`cohort item missing: ${entry.id}`);
  const cam = cams[item.slot];
  if (!cam) throw new Error(`no camera for ${entry.id} (${item.slot})`);
  const outfit = item.slot === "face"
    ? { face: item.id }
    : headSlots.has(item.slot)
      ? { face: "head-face-23-base", [item.slot]: item.id }
      : { [item.slot]: item.id };
  const url = `http://127.0.0.1:5173/?outfit=${encode(outfit)}&cam=${[...cam.pos, ...cam.target].join(",")}&fov=${cam.fov}&pose=a`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction("window.__rigIdle === true", null, { timeout: 30000 });
  await page.waitForTimeout(700);
  const box = await page.locator("canvas").first().boundingBox();
  await page.screenshot({ path: join(out, `${entry.id}.${side}.png`), clip: box });
  console.log(`${side}: ${entry.id}`);
}
await browser.close();
