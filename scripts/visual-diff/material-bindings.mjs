// Reproducible material regression captures through the real viewer.
// npm run dev, then node scripts/visual-diff/material-bindings.mjs --phase=before|after
// Images remain in the ignored visual-diff directory. No source artwork is committed.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
const phase = args.phase ?? "after";
if (!/^[a-z0-9-]+$/.test(phase)) throw new Error("phase must be a simple output label");
const OUT = join(ROOT, "visual-diff/material-bindings", phase);
const reportPath = join(OUT, "report.json");
const catalog = JSON.parse(readFileSync(join(ROOT, "src/data/items.json"), "utf8"));
const ids = [
  ...catalog.filter((item) => item.id.startsWith("racing-helmet-")).map((item) => item.id),
  "actionhero-sentineltop-nylon-yellow", "actionhero-sentinelboots-leather",
  "casual-longcoat-leather-black", "casual-longcoat-satin",
  "medieval-knighttop-steel", "hairs-bobstraight-blue",
];
const cameras = {
  headwear: [0.28, 1.74, 0.72, 0, 1.69, 0, 30],
  hair: [0.28, 1.74, 0.72, 0, 1.69, 0, 30],
  upperBody: [0, 1.3, 1.45, 0, 1.25, 0, 28],
  outerwear: [0, 1.3, 1.45, 0, 1.25, 0, 28],
  feet: [0.4, 0.35, 1.05, 0.05, 0.2, 0, 30],
};
let browser;
for (const channel of ["chrome", "msedge"]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* next */ }
}
if (!browser) throw new Error("Chrome or Edge is required");
mkdirSync(OUT, { recursive: true });
const report = Object.hasOwn(args, "resume") && existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8")) : [];
try {
  for (const id of ids.filter((id) => !args.only || id === args.only)) {
    const item = catalog.find((entry) => entry.id === id);
    if (!item?.model) throw new Error(`missing fixture ${id}`);
    const glb = readFileSync(join(ROOT, "public", item.model.gltfPath));
    if (glb.toString("utf8", 0, 4) !== "glTF") throw new Error(`invalid GLB for ${id}`);
    const gltf = JSON.parse(glb.toString("utf8", 20, 20 + glb.readUInt32LE(12)));
    const used = new Set(gltf.meshes.flatMap((mesh) => mesh.primitives.map((primitive) => primitive.material)));
    const expectedMaterials = gltf.materials.flatMap((material, index) => used.has(index) ? [material.name] : []);
    if (!expectedMaterials.length) throw new Error(`missing material fixtures for ${id}`);
    const previous = report.find((entry) => entry.id === id);
    if (previous && !previous.errors.length && existsSync(join(OUT, `${id}.png`)) &&
        expectedMaterials.every((name) => previous.materials.some((entry) => entry.material === name))) continue;
    const page = await browser.newPage({ viewport: { width: 760, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error" && /WebGLProgram|Shader Error|shader.*compile/i.test(message.text())) errors.push(message.text());
    });
    const slots = { [item.slot]: id };
    if (["headwear", "hair"].includes(item.slot)) slots.face = "head-face-23-base";
    const outfit = "1." + Buffer.from(JSON.stringify({ slots })).toString("base64url");
    const camera = cameras[item.slot];
    const url = `${process.env.VDIFF_BASE ?? "http://127.0.0.1:5173"}/?outfit=${outfit}&cam=${camera.slice(0, 6)}&fov=${camera[6]}&pose=a`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // An equip error is caught by the viewer, so idle alone can photograph a bare
    // body and report success. Require every expected surface to be present too.
    await page.waitForFunction((expected) => {
      if (!window.__rigIdle || !window.__rigRoot) return false;
      const names = new Set();
      window.__rigRoot.traverse((object) => {
        if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) names.add(material.name);
      });
      return expected.every((name) => names.has(name));
    }, expectedMaterials, { timeout: 60000 });
    await page.waitForTimeout(800);
    await page.locator("canvas").first().screenshot({ path: join(OUT, `${id}.png`) });
    const materials = await page.evaluate(() => {
      const result = [];
      window.__rigRoot.traverse((object) => {
        if (!object.isMesh) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          result.push({ mesh: object.name, material: material.name, side: material.side,
            transparent: material.transparent, opacity: material.opacity,
            map: material.map?.image?.src ?? null,
            emissiveMap: material.emissiveMap?.image?.src ?? null,
            ledAnimation: material.userData.ledAnimationTexture?.image?.src ?? null });
        }
      });
      return result;
    });
    if (previous) report.splice(report.indexOf(previous), 1);
    report.push({ id, camera, errors, materials });
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    await page.close();
    console.log(`captured ${phase}: ${id}`);
    if (errors.length) throw new Error(errors.join("\n"));
  }
} finally {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
