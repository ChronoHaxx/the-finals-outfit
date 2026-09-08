// Inspect assembled outfits around the body in both supported poses. This catches
// holes/protrusions that arithmetic or file-presence checks cannot establish.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1000 } });
const report = [], errors = [];
const smoke = process.argv.includes("--smoke");
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
try {
  for (const suffix of ["leather-black", "leather-camo", "satin"]) {
    const id = `casual-longcoat-${suffix}`;
    const outfit = "1." + Buffer.from(JSON.stringify({ slots: {
      face: "head-face-01-base", hair: "hairs-afrofade", upperBody: "casual-basictshirt-cotton-black",
      lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas", outerwear: id,
    } })).toString("base64url");
    for (const pose of ["a", "idle"]) for (const [view, camera] of Object.entries({
      front: "0,0.9,4.2", right: "4.2,0.9,0", back: "0,0.9,-4.2", left: "-4.2,0.9,0",
    })) {
      if (smoke && !((pose === "a" && view === "left") || (pose === "idle" && view === "front"))) continue;
      await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&isolate=0&surface=lit&pose=${pose}&cam=${camera},0,0.9,0&fov=28`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert.deepEqual(errors, []);
      const file = `${id}.${pose}.${view}.fit.png`;
      await page.locator("canvas").first().screenshot({ path: `visual-diff/reconstructed/${file}` });
      report.push({ id, pose, view, file, renderPassed: true });
      console.log(`${suffix}/${pose}/${view}: rendered`);
    }
  }
  writeFileSync(`visual-diff/reconstructed/fit${smoke ? "-smoke" : ""}-renders.json`, JSON.stringify(report, null, 2));
} finally { await browser.close(); }
