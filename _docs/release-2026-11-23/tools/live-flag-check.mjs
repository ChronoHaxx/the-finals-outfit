// (24 Nov 2026 release.) Read-only live check: the deployed bundle names the release hosts, and the Light class stays
// behind its flag (no class picker without ?archetypes=on).   node live-flag-check.mjs SITE_URL OUT.json
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const [site, out] = process.argv.slice(2);
const html = await (await fetch(site, { cache: 'no-store' })).text();
const src = html.match(/assets\/index-[\w-]+\.js/)?.[0];
const bundle = src ? await (await fetch(new URL(src, site))).text() : '';
const hosts = Object.fromEntries(['dfe1d5e8', 'f1fa60b6', '709a36ca', 'a70ffa7f', '2026-11-23-season-12-refit']
  .map(h => [h, bundle.includes(h)]));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let ui;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 });
  await page.keyboard.press('Escape');
  ui = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('button')].map(b => b.textContent.trim().toUpperCase());
    return { masculine: labels.includes('MASCULINE'), light: labels.includes('LIGHT'), medium: labels.includes('MEDIUM') };
  });
  await page.screenshot({ path: out.replace(/\.json$/, '.png') });
} finally { await browser.close(); }
const pass = src && hosts.dfe1d5e8 && hosts.f1fa60b6 && hosts['709a36ca'] && !hosts.a70ffa7f && ui.masculine && !ui.light && !ui.medium;
const report = { at: new Date().toISOString(), site, bundle: src, hosts, ui, pass: !!pass };
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
process.exit(pass ? 0 : 1);
