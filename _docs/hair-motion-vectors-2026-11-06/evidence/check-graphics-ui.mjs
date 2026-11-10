import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto("http://127.0.0.1:5181/?reconstructed=1&anim=outfit-idle", { waitUntil: "load", timeout: 180000 });
await page.waitForFunction("window.__rigIdle === true && !!window.__temporalPreview", null, { timeout: 180000 });
await page.waitForTimeout(9000);
const select = page.getByLabel("Graphics quality");
const out = { initial: await select.inputValue(), options: await select.locator("option").allTextContents() };
const status = () => page.evaluate(() => ({ motion: window.__temporalPreview.motion, reprojected: window.__temporalPreview.reprojected, width: window.__temporalPreview.width, dpr: window.devicePixelRatio, canvas: document.querySelector("[data-viewer] canvas").width }));
out.auto = await status();
for (const choice of ["high", "balanced", "low"]) { await select.selectOption(choice); await page.waitForTimeout(1500); out[choice] = await status(); }
await select.selectOption("auto"); await page.waitForTimeout(500);
out.saved = await page.evaluate(() => localStorage.getItem("finals-outfit.graphics"));
await page.screenshot({ path: "scripts/generated/anim-export/graphics-ui.png", clip: { x: 900, y: 0, width: 600, height: 260 } });
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
