// Render the three bounded material cases and fail on missing recovered materials
// or browser/GPU errors. Outputs contain game artwork and remain ignored.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve("visual-diff/reconstructed");
const baseline = process.argv.includes("--baseline");
const isolated = process.argv.includes("--isolated");
const tag = baseline ? "baseline" : isolated ? "isolated" : "render";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1000 }, deviceScaleFactor: 1 });
let errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("requestfailed", (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
const report = [];
try {
  for (const suffix of ["leather-black", "leather-camo", "satin"]) {
    const id = `casual-longcoat-${suffix}`;
    const outfit = "1." + Buffer.from(JSON.stringify({ slots: { outerwear: id } })).toString("base64url");
    for (const view of baseline || isolated ? ["lit"] : ["lit", "baseColor", "normal", "roughness", "metalness"]) {
      errors = [];
      const cam = isolated ? "0,0.9,4.2,0,0.9,0" : "0,1.3,1.45,0,1.25,0";
      const url = `http://127.0.0.1:5173/?outfit=${outfit}&cam=${cam}&fov=28&pose=a&surface=${view}`
        + (baseline ? "" : "&reconstructed=1") + (isolated ? "&isolate=1" : "");
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 60000 });
      await page.waitForTimeout(800);
      const materials = await page.evaluate(() => {
        const result = [];
        window.__rigRoot?.traverse((o) => {
          for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
            if (m.userData.reconstructed) result.push({ name: m.name, uv0: o.geometry.attributes.uv.count, uv1: o.geometry.attributes.uv1.count });
          }
        });
        return result;
      });
      report.push({ id, view, url, materials, errors: [...errors] });
      const canvas = page.locator("canvas").first();
      const box = await canvas.boundingBox();
      if (!box) throw new Error("No visible canvas");
      await page.screenshot({ path: resolve(out, `${id}.${baseline || isolated ? tag : view}.png`), clip: box });
      writeFileSync(resolve(out, `${tag}-report.json`), JSON.stringify(report, null, 2));
      if ((!baseline && !materials.length) || errors.length) throw new Error(`${id}/${view}: ${errors.join("\n") || "material not applied"}`);
      console.log(`${id}: ${view} rendered`);
    }
  }
} finally {
  await browser.close();
}
