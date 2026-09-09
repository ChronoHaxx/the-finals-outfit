// Capture the actual viewer for a labelled GIF; no generated or retouched artwork.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const read = path => JSON.parse(readFileSync(path, "utf8"));
const available = read("public/models/reconstructed-assemblies-v1/supported-items.json");
const catalog = new Map(read("src/data/items.json").map(i => [i.id, i]));
const order = ["outerwear", "upperBody", "lowerBody"];
const items = [...available.ready].sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
const output = "visual-diff/reconstructed/showcase-10";
mkdirSync(`${output}/frames`, { recursive: true });
const base = { face: "head-face-01-base", hair: "hairs-afrofade", upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 540, height: 720 }, deviceScaleFactor: 1 });
const errors = [], frames = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
try {
  const outfit = "1." + Buffer.from(JSON.stringify({ slots: {} })).toString("base64url");
  await page.goto(`http://127.0.0.1:5173/?outfit=${outfit}&reconstructed=1&isolate=0&pose=a&cam=0,0.9,4.6,0,0.9,0&fov=28`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const viewer = canvas.closest("div.relative.h-full.w-full");
    if (!viewer) throw new Error("Viewer surface not found");
    Object.assign(viewer.style, { position: "fixed", top: "94px", bottom: "42px", left: "0", right: "0",
      width: "100vw", height: "calc(100vh - 136px)", zIndex: "9999", borderRadius: "0" });
    const style = document.createElement("style");
    style.textContent = `body { overflow:hidden !important; background:#14191f !important; }
      #showcase-heading { position:fixed; inset:0 0 auto; height:94px; z-index:10000; background:#14191f;
        padding:13px 22px; box-sizing:border-box; color:#f5f5f5; font-family:Arial,sans-serif; }
      #showcase-heading small { display:block; color:#b7c4cd; font-size:11px; letter-spacing:2px; margin-bottom:9px; }
      #showcase-name { font-size:21px; font-weight:700; line-height:1.15; }
      #showcase-count { margin-top:5px; font-size:12px; color:#d0d7de; }
      #showcase-footer { position:fixed; inset:auto 0 0; height:42px; z-index:10000; background:#14191f;
        display:flex; align-items:center; justify-content:center; color:#b7c4cd; font:12px Arial,sans-serif; }`;
    document.head.append(style);
    const header = document.createElement("header"); header.id = "showcase-heading";
    header.innerHTML = '<small>THE FINALS · RECONSTRUCTION PROGRESS</small><div id="showcase-name"></div><div id="showcase-count"></div>';
    const footer = document.createElement("footer"); footer.id = "showcase-footer";
    footer.textContent = "Current viewer renders · Preview lighting · Fitting in progress";
    document.body.append(header, footer);
  });
  for (const [itemIndex, item] of items.entries()) {
    const name = catalog.get(item.id).name;
    await page.evaluate(async ({ slots, name, count }) => {
      window.__rigIdle = false;
      window.__rigRoot.rotation.y = 0;
      (await import("/src/store/useBuildStore.ts")).useBuildStore.getState().load(slots);
      document.querySelector("#showcase-name").textContent = name;
      document.querySelector("#showcase-count").textContent = count;
    }, { slots: { ...base, [item.slot]: item.id }, name,
      count: `${String(itemIndex + 1).padStart(2, "0")} / ${items.length}    ·    ${item.parts.length} assembled ${item.parts.length === 1 ? "part" : "parts"}` });
    await page.waitForFunction(() => window.__rigIdle, undefined, { timeout: 60000 });
    await page.evaluate(id => {
      if (!window.__rigRoot.children.some(o => o.userData.sourceAssembly && o.userData.rigItemId === id))
        throw new Error(`Missing reconstructed assembly: ${id}`);
      const canvas = document.querySelector("canvas");
      const viewer = canvas.closest("div.relative.h-full.w-full");
      for (const child of viewer.children) if (!child.contains(canvas)) child.style.visibility = "hidden";
    }, item.id);
    const angles = [0, .15, .30, .45, .60, .40, .20, 0];
    for (const [angleIndex, angle] of angles.entries()) {
      await page.evaluate(async angle => {
        window.__rigRoot.rotation.y = angle;
        window.__rigRoot.updateMatrixWorld(true);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, angle);
      const file = `frames/${String(frames.length).padStart(4, "0")}.png`;
      await page.screenshot({ path: `${output}/${file}` });
      frames.push({ file, duration: angleIndex === 0 ? 900 : angleIndex === angles.length - 1 ? 250 : 120,
        id: item.id, name, angle });
    }
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(`${itemIndex + 1}/${items.length}: ${name}`);
  }
  writeFileSync(`${output}/frames.json`, JSON.stringify({ width: 540, height: 720, items: items.length, frames }, null, 2));
} finally { await browser.close(); }
