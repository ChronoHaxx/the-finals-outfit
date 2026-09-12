// Capture every implemented accessory in the real app and compose reviewable contact sheets.
//
// Each capture is a render/diagnostic result, never a visual acceptance: appearance is judged by
// review. The preview index is served in place of the active one through the shared harness, so the
// meshes, materials and textures still come from the real dev server and every delivery is recorded.
//
//   node scripts/shader-probe/render-accessory-sheets.mjs [--limit N] [--sheets-only]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { APP_URL, ACTIVE_INDEX, BASE_OUTFIT, outfitUrl, servePreviewIndex, watch, classify, waitIdle,
  shoot, read } from './coverage-preview-harness.mjs';

const PREVIEW = 'public/models/reconstructed-accessories-preview-v1';
const RUNTIME = '/models/reconstructed-accessories-v1/';
const OUT = path.resolve('visual-diff/reconstructed/accessories-opus-v1');
const GENERATED = path.resolve('scripts/generated/shader-probe/accessory-opus-v1');
const VIEWS = [['front', 0], ['back', Math.PI], ['oblique', 0.7]];
const VIEWPORT = { width: 1200, height: 1000 };
const FOV = 28;
// Six materially different choices: plain surface, vertex-tinted, two mesh slots, a native skinned
// head, a non-uniform authored scale with a two-sided material, and the eyewear slot.
const SHOWCASE = ['attachment-asianmask', 'attachment-mask-welding-01-headwear-black',
  'attachment-ballistichelmet-visordown', 'attachment-cowmascothead-cotton',
  'attachment-rubberchickenheadpunk', 'attachment-shootingglasses-a-metal'];
const argv = process.argv.slice(2);
const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 0;
const sheetsOnly = argv.includes('--sheets-only');

const preview = read(`${PREVIEW}/preview.json`);
const supported = read(`${PREVIEW}/supported-items.json`);
const catalog = new Map(read('src/data/items.json').map(i => [i.id, i]));
const entries = new Map(supported.ready.map(r => [r.id, r]));
const ids = preview.implemented.slice(0, limit || undefined);
const label = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const write = (file, value) => fs.writeFileSync(path.join(GENERATED, file), JSON.stringify(value, null, 2) + '\n');

/** Frame the camera on the item's own assembled bounds: measured per item, never hand-tuned. */
function frameCamera(bounds, margin = 2.4) {
  const [minX, minY, minZ] = bounds.min, [maxX, maxY, maxZ] = bounds.max;
  const centre = (minY + maxY) / 2;
  const aspect = VIEWPORT.width / VIEWPORT.height;
  const span = Math.max(maxY - minY, Math.max(maxX - minX, maxZ - minZ) / aspect) * margin;
  const distance = Math.max(span / 2 / Math.tan(FOV * Math.PI / 360), 0.55) + (maxZ - minZ) / 2;
  return `0,${centre.toFixed(3)},${distance.toFixed(3)},0,${centre.toFixed(3)},0`;
}

const bounds = (page, id) => page.evaluate(wanted => {
  const group = window.__rigRoot?.children.find(c => c.userData.rigItemId === wanted);
  if (!group || !window.__THREE) return null;
  const box = new window.__THREE.Box3().setFromObject(group);
  return box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() };
}, id);

const assembled = (page, id) => page.evaluate(wanted => {
  const group = window.__rigRoot?.children.find(c => c.userData.rigItemId === wanted);
  if (!group) return null;
  const shown = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const meshes = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    meshes.push({ visible: shown(o), sourceMesh: o.userData.sourceMesh ?? null,
      socket: o.userData.sourceStaticAttachment ?? null, scale: o.userData.sourceAttachmentScale ?? null,
      materials: [].concat(o.material).map(m => ({ source: m.userData.sourceMaterial ?? null,
        reconstructed: m.userData.reconstructed === true })) });
  });
  return { sourceAssembly: !!group.userData.sourceAssembly, groupVisible: shown(group), meshes };
}, id);

async function angle(page, radians) {
  await page.evaluate(async y => {
    window.__rigRoot.rotation.y = y;
    window.__rigRoot.updateMatrixWorld(true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, radians);
}

async function capture() {
  const report = { formatVersion: 1, startedAt: new Date().toISOString(),
    meaning: 'Render and delivery diagnostics for every implemented accessory in the additive preview index. '
      + 'Captured views are evidence for review, not an appearance approval.',
    app: APP_URL, previewIndex: PREVIEW, servedInPlaceOf: ACTIVE_INDEX,
    viewport: `${VIEWPORT.width}x${VIEWPORT.height}`, fov: FOV, pose: 'a', baseOutfit: BASE_OUTFIT,
    views: VIEWS.map(([view, y]) => ({ view, rigRotationY: y })), cases: [] };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await page.routeWebSocket('**/*', socket => socket.close());
    await servePreviewIndex(page, PREVIEW);
    const record = watch(page);
    for (const [index, id] of ids.entries()) {
      const item = catalog.get(id), slots = { ...BASE_OUTFIT, [item.slot]: id };
      for (const key of Object.keys(record)) record[key].length = 0;
      const entry = { id, name: item.name, slot: item.slot, views: [], problems: [] };
      try {
        await page.goto(outfitUrl(slots, { cam: '0,1.62,1.3,0,1.62,0', extra: '&temporal=0' }), { waitUntil: 'domcontentloaded' });
        await waitIdle(page);
        const box = await bounds(page, id);
        entry.bounds = box;
        entry.camera = box ? frameCamera(box) : '0,1.62,1.3,0,1.62,0';
        entry.framing = box ? 'fitted to this item\'s assembled bounds' : 'fallback head framing; bounds unavailable';
        await page.goto(outfitUrl(slots, { cam: entry.camera, extra: '&temporal=0' }), { waitUntil: 'domcontentloaded' });
        await waitIdle(page);
        const state = await assembled(page, id);
        entry.assembly = state;
        const want = entries.get(id);
        if (!state?.sourceAssembly) entry.problems.push('not assembled through the source path');
        if (state && !state.groupVisible) entry.problems.push('assembly group hidden');
        if (state?.meshes.some(m => !m.visible)) entry.problems.push('a section is not visible');
        if (state?.meshes.some(m => m.materials.some(x => !x.reconstructed))) entry.problems.push('a slot is not reconstructed');
        const wantMeshes = want.parts.map(p => p.sourceMesh).sort();
        const gotMeshes = [...new Set(state?.meshes.map(m => m.sourceMesh) ?? [])].sort();
        if (String(wantMeshes) !== String(gotMeshes)) entry.problems.push(`meshes ${gotMeshes} != ${wantMeshes}`);
        for (const [view, y] of VIEWS) {
          await angle(page, y);
          const file = `cohort/${item.slot}/${id}.${view}.png`;
          await shoot(page, path.join(OUT, file));
          entry.views.push({ view, rigRotationY: y, file });
        }
        await angle(page, 0);
      } catch (error) { entry.problems.push(String(error)); }
      const observed = classify(record);
      // The HMR socket is closed on purpose so an edit cannot reload the page mid-capture; Vite's
      // own "failed to connect" notice is that closure, not an application error.
      observed.errors = observed.errors.filter(e => !e.startsWith('[vite] failed to connect to websocket'));
      // Only a finished 2xx delivery of this item's own files counts as delivered.
      const delivered = record.requests.filter(r => r.url.includes(RUNTIME) && r.outcome === 'finished' && r.status < 400);
      entry.delivered = [...new Set(delivered.map(r => new URL(r.url).pathname.replace(RUNTIME, '')))];
      entry.errors = observed.errors;
      entry.failedRequests = observed.failedRequests;
      entry.supersededLoads = observed.supersededLoads.length;
      if (observed.errors.length) entry.problems.push(...observed.errors.map(e => `browser error: ${e}`));
      if (observed.failedRequests.length) entry.problems.push(...observed.failedRequests.map(e => `failed request: ${e}`));
      if (!entry.delivered.some(f => f.startsWith('meshes/')) || !entry.delivered.some(f => f.startsWith('materials/')))
        entry.problems.push('no accessory mesh/material delivery recorded for this item');
      entry.passed = !entry.problems.length;
      report.cases.push(entry);
      write('sheet-captures.json', report);
      console.log(`${index + 1}/${ids.length} ${id}: ${entry.passed ? 'rendered' : 'PROBLEM ' + entry.problems[0]}`);
    }
    await page.close();
  } finally { await browser.close(); }
  report.finishedAt = new Date().toISOString();
  report.counts = { items: report.cases.length, passed: report.cases.filter(c => c.passed).length,
    views: report.cases.reduce((n, c) => n + c.views.length, 0) };
  write('sheet-captures.json', report);
  return report;
}

const TILE = { width: 420, header: 34, get height() { return this.header + Math.round(this.width * VIEWPORT.height / VIEWPORT.width); } };
async function tile(file, title, subtitle) {
  const body = fs.existsSync(file)
    ? await sharp(file).resize(TILE.width, TILE.height - TILE.header, { fit: 'contain', background: '#20242e' }).toBuffer()
    : await sharp({ create: { width: TILE.width, height: TILE.height - TILE.header, channels: 4, background: '#3a2020' } }).png().toBuffer();
  const text = `<svg width="${TILE.width}" height="${TILE.header}">`
    + `<rect width="${TILE.width}" height="${TILE.header}" fill="#171a22"/>`
    + `<text x="8" y="14" fill="#ffffff" font-family="Arial" font-size="12">${label(title)}</text>`
    + `<text x="8" y="28" fill="#9fb0c0" font-family="Arial" font-size="10">${label(subtitle)}</text></svg>`;
  return sharp({ create: { width: TILE.width, height: TILE.height, channels: 4, background: '#20242e' } })
    .composite([{ input: body, left: 0, top: TILE.header }, { input: Buffer.from(text), left: 0, top: 0 }]).png().toBuffer();
}

async function sheet(name, heading, tiles, columns) {
  const rows = Math.ceil(tiles.length / columns), head = 46;
  const svg = `<svg width="${columns * TILE.width}" height="${head}">`
    + `<rect width="${columns * TILE.width}" height="${head}" fill="#0f1218"/>`
    + `<text x="10" y="19" fill="#ffffff" font-family="Arial" font-size="14">${label(heading)}</text>`
    + `<text x="10" y="36" fill="#94a3b4" font-family="Arial" font-size="11">Local preview renders under studio preview lighting, `
    + `not the game's lighting. Diagnostics for review, not a visual acceptance.</text></svg>`;
  const composites = [{ input: Buffer.from(svg), left: 0, top: 0 }];
  tiles.forEach((buffer, i) => composites.push({ input: buffer,
    left: (i % columns) * TILE.width, top: head + Math.floor(i / columns) * TILE.height }));
  const file = path.join(OUT, `sheets/${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: columns * TILE.width, height: head + rows * TILE.height, channels: 4, background: '#0f1218' } })
    .composite(composites).png().toFile(file);
  return `sheets/${name}.png`;
}

async function buildSheets() {
  const report = read(path.join(GENERATED, 'sheet-captures.json'));
  const cases = new Map(report.cases.map(c => [c.id, c]));
  const bySlot = new Map();
  for (const entry of report.cases) bySlot.set(entry.slot, [...(bySlot.get(entry.slot) ?? []), entry]);
  const sheets = [];
  for (const [slot, list] of [...bySlot].sort()) {
    for (const [view] of VIEWS) {
      const tiles = [];
      for (const entry of list) {
        const capture = entry.views.find(v => v.view === view);
        tiles.push(await tile(capture ? path.join(OUT, capture.file) : 'missing', entry.name,
          `${entry.id} · ${entry.passed ? 'rendered' : 'PROBLEM'} · ${view}`));
      }
      sheets.push({ slot, view, items: list.map(e => e.id),
        file: await sheet(`accessories-${slot}-${view}`, `Accessory preview · ${slot} · ${view} view · ${list.length} items`,
          tiles, Math.min(4, tiles.length)) });
    }
  }
  const showcase = [];
  for (const id of SHOWCASE.filter(id => cases.has(id))) {
    const entry = cases.get(id);
    const materials = [...new Set((entry.assembly?.meshes ?? []).flatMap(m => m.materials.map(x => x.source?.split('.').pop())))];
    showcase.push(await tile(path.join(OUT, entry.views.find(v => v.view === 'front').file), entry.name,
      `${entry.id} · ${materials.join(', ')}`));
  }
  if (showcase.length) sheets.push({ showcase: true, items: SHOWCASE,
    file: await sheet('accessories-showcase', 'Accessory preview · six materially different choices · front view', showcase, 3) });

  const rows = [];
  for (const [slot, list] of [...bySlot].sort()) {
    rows.push(`<h2>${label(slot)} · ${list.length} implemented</h2>`);
    rows.push('<p>' + VIEWS.map(([view]) => {
      const s = sheets.find(x => x.slot === slot && x.view === view);
      return s ? `<a href="${s.file}">${view} sheet</a>` : '';
    }).filter(Boolean).join(' · ') + '</p>');
    rows.push('<table><tr><th>item</th><th>result</th><th>front</th><th>back</th><th>oblique</th><th>source materials</th><th>delivered</th></tr>');
    for (const entry of list) {
      const links = VIEWS.map(([view]) => {
        const capture = entry.views.find(v => v.view === view);
        return capture ? `<td><a href="${capture.file}">${view}</a></td>` : '<td>—</td>';
      }).join('');
      const materials = [...new Set((entry.assembly?.meshes ?? []).flatMap(m => m.materials.map(x => x.source?.split('.').pop())))];
      rows.push(`<tr><td>${label(entry.name)}<br><code>${label(entry.id)}</code></td>`
        + `<td class="${entry.passed ? 'ok' : 'bad'}">${entry.passed ? 'rendered' : label(entry.problems[0])}</td>${links}`
        + `<td><code>${label(materials.join(', '))}</code></td><td>${entry.delivered.length} files</td></tr>`);
    }
    rows.push('</table>');
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Accessory preview captures</title>
<style>body{background:#0f1218;color:#e6edf3;font:13px Arial,sans-serif;margin:24px}
h1{font-size:20px}h2{font-size:15px;margin-top:28px;border-bottom:1px solid #2a303c;padding-bottom:4px}
a{color:#7cc4ff}table{border-collapse:collapse;margin:8px 0 18px}td,th{border:1px solid #2a303c;padding:4px 8px;text-align:left;vertical-align:top}
code{color:#9fb0c0}.ok{color:#7fd88f}.bad{color:#ff8f8f}</style>
<h1>Accessory preview captures</h1>
<p>Preview index <code>${label(PREVIEW)}</code> served in place of <code>${label(ACTIVE_INDEX)}</code>.
Viewport ${VIEWPORT.width}×${VIEWPORT.height}, A-pose, Medium reference body, camera fitted to each item's assembled bounds.
These are renders and diagnostics; <b>no item here is visually accepted</b>.</p>
<p><a href="${sheets.find(s => s.showcase)?.file ?? '#'}">Six-example showcase</a></p>
${rows.join('\n')}`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  write('sheets.json', { formatVersion: 1, sheets, index: 'index.html', out: OUT });
  console.log(`sheets: ${sheets.length}`);
  return sheets;
}

if (!sheetsOnly) {
  const report = await capture();
  console.log(JSON.stringify(report.counts));
  if (report.counts.passed !== report.counts.items) process.exitCode = 1;
}
await buildSheets();
