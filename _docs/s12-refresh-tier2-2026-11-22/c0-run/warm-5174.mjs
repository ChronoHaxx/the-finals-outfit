// C0 warm-up (25 Nov 2026): load the 5174 app once, headless, with long timeouts, so Vite has transformed the whole
// module graph before the gpu stage's own 30 s page.goto. A curl of / and main.tsx is not enough (w177 v3 GPU rerun,
// APPLY-STATUS 25 Nov). Same browser as scripts/shader-probe/check-webgl.mjs. Run from the repo root by run-v1.sh.
import { chromium } from "playwright-core";

const url = process.env.APP_URL ?? "http://127.0.0.1:5174";
const started = Date.now();
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 900_000 });
  await page.waitForLoadState("networkidle", { timeout: 300_000 }).catch(() => console.log("warm: network not idle after 5 min"));
  console.log(`warm: ${url} loaded in ${Math.round((Date.now() - started) / 1000)} s`);
} finally {
  await browser.close();
}
