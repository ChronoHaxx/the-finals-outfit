// Exercise the four progress colours through the actual picker, and capture the subtle
// SciFi face markings that are too small to assess on a full-body contact sheet.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { outfitUrl, waitIdle, shoot, watch, classify } from './coverage-preview-harness.mjs';

const catalog = JSON.parse(fs.readFileSync('src/data/items.json'));
const item = id => catalog.find(i => i.id === id);
const out = 'visual-diff/reconstructed/paint-siblings-v1';
const generated = 'scripts/generated/shader-probe/body-paint-siblings-v1';
const SKIN = { face: 'head-face-01-base', hair: 'hairs-afrofade' };
const BASE = { ...SKIN, lowerBody: 'casual-loosejeans-denim-darkblue', feet: 'casual-tallsneakers-canvas' };
const report = { startedAt: new Date().toISOString(), slots: {}, checks: [] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const record = watch(page);
  const tile = id => page.locator('[aria-label="Cosmetic results"] button').filter({ has: page.locator(`img[alt="${item(id).name}"]`) });
  const status = async (id, expected, tooltip) => {
    const badge = tile(id).locator('[data-reconstruction-status]');
    assert.equal(await badge.getAttribute('data-reconstruction-status'), expected, id);
    if (tooltip) assert.match(await badge.getAttribute('title'), tooltip, `${id}: explanatory tooltip`);
    report.checks.push({ id, status: expected, colour: await badge.evaluate(el => getComputedStyle(el).backgroundColor) });
  };
  const selectSlot = async (name, total) => {
    await page.getByRole('button', { name: new RegExp(`^${name}\\s*${total}$`) }).click();
    const badges = await page.locator('[data-reconstruction-status]').evaluateAll(els => els.map(el => el.dataset.reconstructionStatus));
    report.slots[name] = Object.fromEntries(['untouched', 'polish', 'issue', 'accepted'].map(s => [s, badges.filter(b => b === s).length]));
  };
  await page.goto(outfitUrl(BASE, { cam: '0,0.95,4.3,0,0.95,0', extra: '&temporal=0' }), { waitUntil: 'networkidle' });
  await waitIdle(page);
  await selectSlot('Upper Body', 577);
  const eno = 'streetwear-tightsinglet-cotton-enorino';
  await status(eno, 'accepted', /user confirmed/);
  await status('streetwear-tightsinglet-cotton-black', 'issue', /materials and prints/);
  await status('streetwear-tightsingletsportevent-cotton', 'untouched');
  await page.locator('input[placeholder^="Search"]').fill('Tight Singlet');
  await page.evaluate(() => { window.__rigIdle = false; });
  await tile(eno).click();
  await waitIdle(page);
  assert.equal(await tile(eno).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${out}/picker-singlets.png`, fullPage: true });
  await selectSlot('Outerwear', 15);
  await status('casual-longcoat-leather-camo', 'polish', /Wrist gap/);
  await page.screenshot({ path: `${out}/picker-coats.png`, fullPage: true });
  await selectSlot('Lower Body', 375);
  const sourceOnly = 'medieval-knightpantsnoskirt-cotton';
  await status(sourceOnly, 'polish');
  await page.getByRole('button', { name: /^3D only/ }).click();
  assert(await tile(sourceOnly).isVisible(), 'Source assembly without a legacy model vanished from 3D only');
  await page.evaluate(() => { window.__rigIdle = false; });
  await tile(sourceOnly).click();
  await waitIdle(page);
  assert(await page.evaluate(id => window.__rigRoot.children.some(o => o.userData.sourceAssembly
    && o.userData.rigItemId === id && o.visible), sourceOnly), 'Source-only item was labelled 3D but failed to equip');
  await page.getByRole('button', { name: /^3D only/ }).click();
  await selectSlot('Body Paint', 30);
  assert.deepEqual(report.slots['Body Paint'], { untouched: 8, polish: 18, issue: 4, accepted: 0 });
  await status('bodycosmetics-bodypaint-metallicgold-01', 'issue', /head surface/);
  await status('bodycosmetics-makeup-scifibody-03', 'polish');
  await page.evaluate(() => { window.__rigIdle = false; });
  await tile('bodycosmetics-makeup-scifibody-03').click();
  await waitIdle(page);
  assert.equal(await tile('bodycosmetics-makeup-scifibody-03').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${out}/picker-paints.png`, fullPage: true });
  await page.evaluate(() => { window.__rigIdle = false; });
  await tile('bodycosmetics-makeup-scifibody-03').click();
  await waitIdle(page);
  assert.equal(await tile('bodycosmetics-makeup-scifibody-03').getAttribute('aria-pressed'), 'false');
  await selectSlot('Nail Polish', 124);
  assert.deepEqual(report.slots['Nail Polish'], { untouched: 124, polish: 0, issue: 0, accepted: 0 });
  report.requests = classify(record);
  assert.deepEqual(report.requests.failedRequests, []);
  assert.deepEqual(report.requests.errors, []);
  await page.close();

  report.closeups = [];
  for (const id of ['bodycosmetics-makeup-scifibody-02', 'bodycosmetics-makeup-scifibody-04', 'bodycosmetics-bodypaint-metallicblack-01']) {
    const close = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    const log = watch(close);
    await close.goto(outfitUrl({ ...SKIN, bodyPaint: id }, { cam: '0,1.57,1.15,0,1.57,0', extra: '&temporal=0' }), { waitUntil: 'networkidle' });
    await waitIdle(close);
    const file = `${id}.face.png`;
    await shoot(close, `${out}/${file}`);
    const requests = classify(log);
    assert.deepEqual(requests.errors, []);
    assert.deepEqual(requests.failedRequests, []);
    report.closeups.push({ id, file });
    await close.close();
  }
  report.passed = true;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(`${generated}/picker-checks.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify(report.slots));
console.log('PASS: progress colours/tooltips, real equip/remove clicks, source face closeups.');
