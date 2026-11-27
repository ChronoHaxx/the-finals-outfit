// (23 Nov 2026 release copy of release-2026-11-12/tools; default worktree = loving-napier-b93181.)
// (Release copy, 21 Nov 2026: OUT_DIR env added; run 'active' against a release dev server whose VITE_RECONSTRUCTION_BASE/ROUTES point at the uploaded hosts.)
// Head-socket frames check in the real app (release commit dev server).
//   node verify-head-sockets.mjs candidate   -> serves head-socket-frames-v1/candidate/assets.json as the active index
//   node verify-head-sockets.mjs active      -> the active index as it is on disk
// Captures each face with earrings + Laugh Trigger from three head-close cameras, and records page errors, the
// "can't be placed" notice, which items rendered through the source assembly, and each attachment's distance to
// the worn head's own anchor bone (supplemental: the captures are the judgement).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = (process.env.APP_URL ?? 'http://127.0.0.1:5231').replace(/\/$/, '');
const MODE = process.argv[2];
if (!['candidate', 'active'].includes(MODE)) throw new Error('mode: candidate | active');
const OUT = process.env.OUT_DIR ?? path.join(HERE, 'captures', MODE);
fs.mkdirSync(OUT, { recursive: true });

const FACES = ['head-face-01-base', 'head-face-09-base', 'head-face-20-base', 'head-face-30-base'];
const EARRINGS = [
  { id: 'bodycosmetics-earrings-gem-01', note: 'has a legacy GLB fallback' },
  { id: 'bodycosmetics-earrings-bigthinhoops', note: 'no legacy GLB: the notice case' },
];
const NOSE = 'attachment-clownnose'; // Laugh Trigger, no legacy GLB
const BASE = { upperBody: 'casual-basictshirt-cotton-alfaacta' };
const CAMS = {
  front: '0,1.63,0.75,0,1.6,0',
  left: '0.62,1.63,0.38,0,1.6,0',   // the character's left ear (screen right when facing +Z)
  right: '-0.62,1.63,0.38,0,1.6,0',
};
const outfitUrl = (slots, cam) => `${APP}/?outfit=1.${Buffer.from(JSON.stringify({ slots })).toString('base64url')}`
  + `&cam=${cam}&fov=28&pose=a&reconstructed=1`;

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11'] });
const results = [];
try {
  for (const face of FACES) for (const earring of EARRINGS) {
    const slots = { ...BASE, face, earrings: earring.id, facewear: NOSE };
    const row = { face, earring: earring.id, note: earring.note, nose: NOSE, captures: {}, errors: [] };
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
    page.setDefaultTimeout(300000);
    page.on('pageerror', e => row.errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') row.errors.push(m.text()); });
    let indexServed = null;
    if (MODE === 'candidate') {
      const file = path.join(HERE, 'candidate', 'assets.json');
      await page.route(u => new URL(u).pathname === '/models/reconstructed-assemblies-v1/assets.json', route => {
        indexServed = file;
        return route.fulfill({ contentType: 'application/json', body: fs.readFileSync(file, 'utf8') });
      });
    }
    for (const [view, cam] of Object.entries(CAMS)) {
      await page.goto(outfitUrl(slots, cam), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 });
      await page.evaluate(() => new Promise(r => setTimeout(r, 1500)));
      await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 180000 });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const file = path.join(OUT, `${face}__${earring.id}__${view}.png`);
      await page.screenshot({ path: file });
      row.captures[view] = path.relative(HERE, file).replaceAll('\\', '/');
    }
    row.indexServed = MODE === 'candidate' ? indexServed : 'active on disk';
    row.notice = (await page.textContent('body')).includes('placed on the current face');
    row.state = await page.evaluate(({ ids }) => {
      const THREE = window.__THREE, root = window.__rigRoot;
      const out = {};
      const bones = {};
      root.traverse(o => { if (o.isBone && /^FACIAL_(L_Ear|R_Ear|L_Earlobe_jj|R_Earlobe_jj|C_NoseTip)$/.test(o.name)) {
        const p = new THREE.Vector3(); o.getWorldPosition(p); (bones[o.name] ??= []).push(p.toArray()); } });
      for (const child of root.children) {
        const id = child.userData.rigItemId;
        if (!ids.includes(id)) continue;
        const shown = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
        const box = new THREE.Box3();
        child.traverse(o => { if (o.isMesh && shown(o)) box.expandByObject(o); });
        out[id] = { sourceAssembly: !!child.userData.sourceAssembly, visible: shown(child),
          center: box.isEmpty() ? null : box.getCenter(new THREE.Vector3()).toArray(),
          size: box.isEmpty() ? null : box.getSize(new THREE.Vector3()).toArray() };
      }
      return { items: out, bones };
    }, { ids: [earring.id, NOSE] });
    results.push(row);
    console.log(JSON.stringify({ face, earring: earring.id, notice: row.notice, errors: row.errors.length,
      items: Object.fromEntries(Object.entries(row.state.items).map(([k, v]) => [k, v.sourceAssembly])) }));
    await page.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ mode: MODE, app: APP, at: new Date().toISOString(), results }, null, 2) + '\n');
