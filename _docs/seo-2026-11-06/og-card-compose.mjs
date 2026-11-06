// SEO basics refresh (6 Nov 2026): lay out the 1200x630 link-preview card in the redesign's own type and motifs, then
// screenshot it. Text and tokens follow the welcome screen (src/components/IntroDialog.tsx) and src/index.css: Saira
// (the app's self-hosted variable font), near-black set with faint hatching, warm white type, one crimson accent,
// viewfinder brackets on the stage and the chamfered corner. The panels come from og-card-panels.py. No counts: they
// change with every catalog update. Refuses to overwrite.
//   node _docs/seo-2026-11-06/og-card-compose.mjs WORK_DIR OUT.jpg
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const [work, out] = process.argv.slice(2);
if (!work || !out) throw new Error('Usage: og-card-compose.mjs WORK_DIR OUT.jpg');
if (fs.existsSync(out)) throw new Error(`Preserve ${out}`);
const font = pathToFileURL(path.resolve('node_modules/@fontsource-variable/saira/wdth.css')).href;
const panel = k => pathToFileURL(path.resolve(work, `panel-${k}.png`)).href;

const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${font}"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; position: relative; font-family: 'Saira Variable', sans-serif;
    color: #f2efe9; background: #09090b;
    background-image: repeating-linear-gradient(135deg, rgb(255 255 255 / 0.022) 0 2px, transparent 2px 10px); }
  .edge { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: #d21f3c; }
  .copy { position: absolute; left: 64px; top: 62px; width: 410px; }
  .hud { font-weight: 600; font-stretch: 87.5%; letter-spacing: 0.14em; text-transform: uppercase; }
  .kicker { display: flex; align-items: center; gap: 12px; font-size: 18px; color: #a6a4ab; }
  .kicker i { width: 5px; height: 18px; background: #d21f3c; }
  h1 { margin-top: 22px; font-weight: 800; font-stretch: 62.5%; line-height: 0.88; letter-spacing: -0.005em;
    text-transform: uppercase; font-size: 150px; }
  h1 span { color: #d21f3c; }
  p { margin-top: 30px; font-size: 23px; line-height: 1.45; color: #a6a4ab; }
  .foot { position: absolute; left: 64px; bottom: 50px; font-size: 14px; color: #6f6d76; }
  .stage { position: absolute; top: 32px; width: 316px; height: 566px; overflow: hidden;
    clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%); }
  .stage img { width: 100%; height: 100%; display: block; }
  .stage::after { content: ''; position: absolute; inset: 12px; --b: rgb(9 9 11 / 0.32); --l: 22px;
    background:
      linear-gradient(var(--b) 0 0) top left / var(--l) 2px no-repeat,
      linear-gradient(var(--b) 0 0) top left / 2px var(--l) no-repeat,
      linear-gradient(var(--b) 0 0) top right / var(--l) 2px no-repeat,
      linear-gradient(var(--b) 0 0) top right / 2px var(--l) no-repeat,
      linear-gradient(var(--b) 0 0) bottom left / var(--l) 2px no-repeat,
      linear-gradient(var(--b) 0 0) bottom left / 2px var(--l) no-repeat,
      linear-gradient(var(--b) 0 0) bottom right / var(--l) 2px no-repeat,
      linear-gradient(var(--b) 0 0) bottom right / 2px var(--l) no-repeat; }
</style></head><body>
  <div class="edge"></div>
  <div class="copy">
    <div class="kicker hud"><i></i>Fan-made for THE FINALS</div>
    <h1>Outfit<br><span>Builder</span></h1>
    <p>Put a contestant together from the cosmetic catalog, look at it from every side in 3D, and share the look as a link.</p>
  </div>
  <div class="foot hud">Not affiliated with Embark Studios</div>
  <div class="stage" style="left: 504px"><img src="${panel(1)}"></div>
  <div class="stage" style="left: 852px"><img src="${panel(2)}"></div>
</body></html>`;

const page_ = path.join(work, 'card.html');
fs.writeFileSync(page_, html);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.resolve(page_)).href);
await page.evaluate(() => document.fonts.ready);
const fontOk = await page.evaluate(() => document.fonts.check('800 150px "Saira Variable"'));
if (!fontOk) throw new Error('Saira did not load');
// The title must fit its column: a wider glyph run would run under the first panel.
const titleRight = await page.evaluate(() => Math.max(...[...document.querySelectorAll('h1, p, .kicker')]
  .map(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().right; })));
if (titleRight > 504 - 24) throw new Error(`Copy reaches x=${titleRight}, into the panels`);
await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
await browser.close();
console.log(out, fs.statSync(out).size, 'bytes; copy right edge', Math.round(titleRight));
