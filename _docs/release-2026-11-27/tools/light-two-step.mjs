// (27 Nov 2026 release.) Flagged Light on a production build: open ?archetypes=on first (stores the preview flag), then
// the outfit link in the same browser, click LIGHT in the picker, and report whether the Light body and class meshes are requested.
//   node light-two-step.mjs APP_URL OUT.png
import { chromium } from 'playwright-core';
const [app, shot] = process.argv.slice(2);
const slots = { face: 'head-face-01-base', hair: 'hairs-afrofade', upperBody: 'casual-basictshirt-cotton-alfaacta',
  lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas' };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const requested = [], errors = [];
  page.on('request', r => requested.push(r.url()));
  page.on('pageerror', e => errors.push(String(e)));
  const idle = () => page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 });
  const first = new URL(app); first.searchParams.set('archetypes', 'on');
  await page.goto(first.href, { waitUntil: 'domcontentloaded' }); await idle();
  const flag = await page.evaluate(() => localStorage.getItem('finals-archetypes:preview'));
  requested.length = 0;
  const link = new URL(app); link.searchParams.set('outfit', '1.' + Buffer.from(JSON.stringify({ slots })).toString('base64url'));
  await page.goto(link.href, { waitUntil: 'domcontentloaded' }); await idle();
  // The legacy outfit=1.<json> link carries no class (share-url.ts reads ar only beside o=/look=): pick Light in the picker.
  await page.keyboard.press('Escape');
  await page.locator('button').filter({ hasText: /^\s*light\s*$/i }).first().click();
  await page.waitForFunction(() => window.__rigIdle === false, undefined, { timeout: 10000 }).catch(() => {});
  await idle();
  await page.evaluate(() => new Promise(r => { let n = 40; const f = () => --n ? requestAnimationFrame(f) : r(); requestAnimationFrame(f); }));
  const labels = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim().toUpperCase())
    .filter(t => ['LIGHT', 'MEDIUM', 'HEAVY'].includes(t)));
  await page.screenshot({ path: shot });
  const light = requested.filter(u => u.includes('/reconstructed-archetypes-v1/'));
  console.log(JSON.stringify({ flag, classButtons: labels, bodyL: light.some(u => u.endsWith('/SK_Body_L.glb')),
    lightRequests: light.length, lightHosts: [...new Set(light.map(u => new URL(u).host))], errors }));
} finally { await browser.close(); }
