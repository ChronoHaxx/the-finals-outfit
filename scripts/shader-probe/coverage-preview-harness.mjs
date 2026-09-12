// Shared harness for exercising a preview index in the real app.
//
// The app always reads the active index folder, so the preview is served by intercepting
// exactly the three index documents it fetches. Nothing else is redirected: every mesh,
// mask, shader and texture request still goes to the real dev server, so a binding that
// silently fell back to the active set stays visible in the recorded requests.
import fs from 'node:fs';
import path from 'node:path';

export const APP_URL = (process.env.APP_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
export const ACTIVE_INDEX = 'models/reconstructed-assemblies-v1';
export const PREVIEW_DIR = 'public/models/reconstructed-coverage-a-preview-v1';
export const STAGE_A_SET = 'models/reconstructed-coverage-a-v1';
// The exact documents the viewer loads from the index folder.
export const INDEX_FILES = ['assets.json', 'supported-items.json', 'skin-pairs.json'];
export const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));

export const CAMERAS = {
  // Frame the garment, not the whole scene; the target follows the slot being reviewed.
  upperBody: { front: '0,1.05,2.5,0,1.05,0', back: '0,1.05,-2.5,0,1.05,0', oblique: '1.7,1.2,1.9,0,1.05,0' },
  outerwear: { front: '0,0.95,3.1,0,0.95,0', back: '0,0.95,-3.1,0,0.95,0', oblique: '2.1,1.15,2.4,0,0.95,0' },
  lowerBody: { front: '0,0.6,2.3,0,0.6,0', back: '0,0.6,-2.3,0,0.6,0', oblique: '1.6,0.75,1.7,0,0.6,0' },
  feet: { front: '0,0.2,1.4,0,0.2,0', back: '0,0.2,-1.4,0,0.2,0', oblique: '0.95,0.35,1.0,0,0.2,0' },
  full: { front: '0,0.95,4.3,0,0.95,0', back: '0,0.95,-4.3,0,0.95,0', oblique: '2.9,1.15,3.3,0,0.95,0' },
};
export const cameras = slot => CAMERAS[slot] ?? CAMERAS.full;

// A complete, already supported reference outfit on the Medium body.
export const BASE_OUTFIT = { face: 'head-face-01-base', hair: 'hairs-afrofade',
  upperBody: 'casual-basictshirt-cotton-alfaacta', lowerBody: 'casual-loosejeans-denim-darkblue',
  feet: 'casual-tallsneakers-canvas' };

export function outfitUrl(slots, { cam, fov = 28, pose = 'a', isolate = 0, extra = '' } = {}) {
  const outfit = '1.' + Buffer.from(JSON.stringify({ slots })).toString('base64url');
  return `${APP_URL}/?outfit=${outfit}${cam ? `&cam=${cam}` : ''}&fov=${fov}`
    + `${pose ? `&pose=${pose}` : ''}&reconstructed=1&isolate=${isolate}${extra}`;
}

/** Serve a sibling preview index in place of the active one, without touching either folder. */
export async function servePreviewIndex(page, previewDir = PREVIEW_DIR, { onIndexRequest } = {}) {
  const folder = path.resolve(previewDir);
  const targets = new Map(INDEX_FILES.map(name => [`/${ACTIVE_INDEX}/${name}`, path.join(folder, name)]));
  for (const file of targets.values()) {
    if (!fs.existsSync(file)) throw new Error(`Preview index is incomplete: ${file}`);
  }
  const matchesIndex = url => targets.has(new URL(url).pathname);
  await page.route(matchesIndex, async (route) => {
    const file = targets.get(new URL(route.request().url()).pathname);
    onIndexRequest?.(file);
    // Relative urls inside the preview index are written as ../<sibling>/… so they
    // resolve to the same files from either index folder. Verified by check-coverage-preview.
    await route.fulfill({ contentType: 'application/json', body: fs.readFileSync(file, 'utf8') });
  });
  return () => page.unroute(matchesIndex);
}

/** Record everything a review needs to distrust a screenshot: errors and failed requests. */
export function watch(page) {
  const record = { errors: [], requests: [], indexRequests: [], stageARequests: [], activeRequests: [] };
  const status = new WeakMap();
  let seq = 0;
  page.on('pageerror', e => record.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') record.errors.push(m.text()); });
  page.on('response', r => {
    const url = r.url();
    status.set(r.request(), r.status());
    if (url.includes(`/${STAGE_A_SET}/`)) record.stageARequests.push(`${r.status()} ${url}`);
    else if (url.includes(`/${ACTIVE_INDEX}/`)) record.activeRequests.push(`${r.status()} ${url}`);
  });
  // Only a finished request proves the body arrived: response headers can still be followed
  // by a failure, so a header alone must never vindicate an earlier abort of the same url.
  page.on('requestfinished', r => record.requests.push({ seq: seq++, outcome: 'finished', url: r.url(),
    status: status.get(r) ?? null }));
  page.on('requestfailed', r => record.requests.push({ seq: seq++, outcome: 'failed', url: r.url(),
    error: r.failure()?.errorText ?? 'unknown', status: status.get(r) ?? null }));
  return record;
}

const isApp = url => url.startsWith(APP_URL) && !url.includes('/@vite') && !url.includes('/node_modules/');

// React StrictMode mounts the viewer twice, so the first equip pass is aborted mid-flight.
// An abort only counts as superseded when the same url later *completes* successfully; a
// permanent failure, an incomplete body or an error status stays a real failure.
export function classify(record) {
  const completed = record.requests.filter(r => r.outcome === 'finished' && r.status !== null && r.status < 400);
  const failedRequests = [], supersededLoads = [];
  for (const request of record.requests) {
    const bad = request.outcome === 'failed' || (request.status !== null && request.status >= 400);
    if (!bad || !isApp(request.url)) continue;
    const entry = `${request.outcome === 'failed' ? request.error : request.status} ${request.url}`;
    const retried = completed.some(r => r.url === request.url && r.seq > request.seq);
    (request.outcome === 'failed' && /ERR_ABORTED/.test(request.error ?? '') && retried
      ? supersededLoads : failedRequests).push(entry);
  }
  // Aborted fetches surface as `TypeError: Failed to fetch`. Reclassify those only while no
  // request actually failed, so a genuine missing asset keeps its console evidence.
  const abortNoise = e => /Failed to fetch/.test(e.split('\n')[0]);
  const quiet = !failedRequests.length && supersededLoads.length > 0;
  const errors = record.errors.filter(e => !(quiet && abortNoise(e)));
  return { errors, failedRequests, supersededLoads: [...supersededLoads, ...record.errors.filter(e => !errors.includes(e))],
    completedRequests: completed.length, observedRequests: record.requests.length };
}

export async function waitIdle(page, timeout = 90000) {
  await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** What the rig actually assembled: source parts, meshes and the material file per slot. */
export async function rigState(page) {
  return page.evaluate(() => {
    const assemblies = [], other = [];
    // A mesh is only on screen when every ancestor is visible too: slot suppression hides
    // the assembly group, leaving each child mesh's own flag untouched.
    const shown = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
    for (const child of window.__rigRoot?.children ?? []) {
      const entry = { id: child.userData.rigItemId, sourceAssembly: !!child.userData.sourceAssembly,
        sourceSkinPair: !!child.userData.sourceSkinPair, parts: [], visibleMeshes: 0, hiddenMeshes: 0,
        groupVisible: shown(child) };
      const parts = new Map();
      child.traverse(o => {
        if (!o.isMesh) return;
        const visible = shown(o);
        visible ? entry.visibleMeshes++ : entry.hiddenMeshes++;
        const index = o.userData.sourcePartIndex;
        if (index === undefined) return;
        const part = parts.get(index) ?? { sourceIndex: index, sourceMesh: o.userData.sourceMesh, materials: [] };
        for (const m of (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean)) {
          part.materials.push({ name: m.name, sourceMaterial: m.userData.sourceMaterial,
            reconstructed: m.userData.reconstructed === true, visible });
        }
        parts.set(index, part);
      });
      entry.parts = [...parts.values()].sort((a, b) => a.sourceIndex - b.sourceIndex);
      (entry.sourceAssembly || entry.sourceSkinPair ? assemblies : other).push(entry);
    }
    return { assemblies, other: other.map(o => ({ id: o.id, visibleMeshes: o.visibleMeshes, groupVisible: o.groupVisible })) };
  });
}

// Vite can retain a ?t=... import after an edit, even in a fresh page. Importing the
// bare URL then creates a second Zustand store and tests an outfit the app never sees.
export async function storeModuleUrl(page) {
  return page.evaluate(() => {
    const urls = [...new Set(performance.getEntriesByType('resource').map(r => r.name)
      .filter(url => new URL(url).pathname === '/src/store/useBuildStore.ts'))];
    if (urls.length !== 1) throw new Error(`Expected one loaded build store module, found ${urls.length}`);
    return urls[0];
  });
}

export async function swap(page, slots) {
  const moduleUrl = await storeModuleUrl(page);
  await page.evaluate(async ({ next, moduleUrl }) => {
    const { useBuildStore } = await import(moduleUrl);
    window.__rigIdle = false;
    useBuildStore.getState().load(next);
  }, { next: slots, moduleUrl });
}

/** Give the render surface the whole viewport and clear the controls that sit over it.
 *  The responsive layout otherwise leaves a ~420px wide canvas, far too small to review a
 *  garment, and its overlay panel covers the chest. Re-apply after every navigation. */
export async function frameViewer(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const viewer = canvas?.closest('div.relative.h-full.w-full');
    if (!viewer) throw new Error('Viewer surface not found');
    Object.assign(viewer.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      zIndex: '9999', borderRadius: '0' });
    for (const child of viewer.children) if (!child.contains(canvas)) child.style.visibility = 'hidden';
    if (!document.getElementById('capture-style')) {
      const style = document.createElement('style');
      style.id = 'capture-style';
      style.textContent = 'body{overflow:hidden !important;background:#14191f !important}';
      document.head.append(style);
    }
    window.dispatchEvent(new Event('resize'));
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Screenshot the render surface only, so page chrome never covers the garment. */
export async function shoot(page, file) {
  await frameViewer(page);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.locator('canvas').first().screenshot({ path: file });
  return path.basename(file);
}
