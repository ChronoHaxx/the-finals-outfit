// LibreWolf emulation (10 Nov 2026): Playwright's Firefox with LibreWolf's privacy defaults that matter here
// (WebGL off, resistFingerprinting on). Loads the landing page and the builder, saves screenshots and page errors.
// Usage (Git Bash or PowerShell, worktree root): node _docs/graphics-options-2026-11-10/librewolf-check.mjs [label] [prefs json]
import { firefox } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
const [label = "librewolf", prefsJson = '{"webgl.disabled":true,"privacy.resistFingerprinting":true}'] = process.argv.slice(2);
// The installed Firefox build (1488) is older than this playwright-core expects (1522); its uncaught-error event lacks
// a location and Playwright throws while relaying it. Keep going: the page itself is unaffected.
process.on("uncaughtException", e => { if (!/reading .url./.test(String(e))) throw e; });
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5182";
mkdirSync("scripts/generated/browser-env", { recursive: true });
const browser = await firefox.launch({ headless: true, executablePath: process.env.FIREFOX_PATH, firefoxUserPrefs: JSON.parse(prefsJson) });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [], consoleErrors = [];
// Old Firefox builds crash Playwright on uncaught page errors (protocol mismatch): record and swallow them in the page.
await page.addInitScript(() => { window.__errors = []; addEventListener("error", e => { window.__errors.push(String(e.error?.stack ?? e.message).slice(0, 400)); e.preventDefault(); }); addEventListener("unhandledrejection", e => { window.__errors.push("rejection: " + String(e.reason?.stack ?? e.reason).slice(0, 400)); e.preventDefault(); }); });
page.on("console", m => { if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
await page.goto(`${BASE}/?reconstructed=1`, { waitUntil: "load", timeout: 240000 });
await page.waitForTimeout(20000);
await page.screenshot({ path: `scripts/generated/browser-env/${label}-landing.png` });
const enter = page.getByRole("button", { name: /enter builder/i });
if (await enter.count()) { await enter.click(); await page.waitForTimeout(25000); }
await page.screenshot({ path: `scripts/generated/browser-env/${label}-builder.png` });
const info = { webgl2: await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2")), ua: await page.evaluate(() => navigator.userAgent),
  errors: [...new Set(await page.evaluate(() => window.__errors))].slice(0, 12), consoleErrors: [...new Set(consoleErrors)].slice(0, 12), text: (await page.evaluate(() => document.body.innerText)).slice(0, 200) };
writeFileSync(`scripts/generated/browser-env/${label}.json`, JSON.stringify(info, null, 1));
console.log(JSON.stringify(info, null, 1));
await browser.close();
