// Resumable audit of the CURRENT mixed renderer against the whole catalog.
//
// What this produces is evidence, not approval. A capture proves a screenshot exists; the
// attachment checks prove the requested choice reached the rig and changed the image; only
// a human review can say a choice looks right, and only an outfit review can say it behaves
// beside its neighbours. Those states are recorded separately and never collapsed.
//
// The renderer under audit is the one the app runs today: source assemblies where the
// active index supports them, the legacy mesh/material path everywhere else, and the decal
// compositor for 2D body cosmetics. Nothing here enables, rebuilds or edits any of it.
//
//   node scripts/shader-probe/catalog-audit.mjs --mode manifest
//   node scripts/shader-probe/catalog-audit.mjs --mode capture --limit 64
//   node scripts/shader-probe/catalog-audit.mjs --mode capture --items id-a,id-b
//   node scripts/shader-probe/catalog-audit.mjs --mode sheets
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { APP_URL, BASE_OUTFIT, CAMERAS, classify, outfitUrl, read, shoot, swap, storeModuleUrl, waitIdle, watch }
  from './coverage-preview-harness.mjs';
import * as core from './catalog-audit-core.mjs';

// ---- command line ----------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
};
const has = (name) => argv.includes(`--${name}`);
const mode = flag('mode', 'all');
const generated = path.resolve(flag('out', 'scripts/generated/shader-probe/current-catalog-audit-02'));
const capturesRoot = path.resolve(flag('captures', 'visual-diff/reconstructed/current-catalog-audit-02'));
let captures = capturesRoot;
const cohortSize = Number(flag('cohort-size', '64'));
const limit = Number(flag('limit', '0'));
const seed = flag('seed', 'current-catalog-audit-01');
const explicitItems = flag('items', '').split(',').map(s => s.trim()).filter(Boolean);
const force = has('force');
const measureFraming = flag('measure', '1') !== '0';
const concurrency = Math.min(2, Math.max(1, Number(flag('concurrency', '1'))));

// ---- run configuration (part of the fingerprint) ---------------------------------------
const VIEWS = [['front', 0], ['back', Math.PI], ['oblique', 0.7]];
const VIEWPORT = { width: 1600, height: 1100 };
const FOV = 28;
const POSE = 'a';
// Only the front camera is pinned: the other views rotate the rig, so lighting, load and
// framing are identical across the three angles of one choice.
const FRAMING_CAMERAS = {
  head: '0,1.70,1.05,0,1.70,0',      // head+hair bounds measured on the Medium body
  hands: '0,1.13,2.00,0,1.13,0',     // both hands in the A-pose sit at y≈1.14, x≈±0.6
  upperBody: CAMERAS.upperBody.front,
  outerwear: CAMERAS.outerwear.front,
  lowerBody: CAMERAS.lowerBody.front,
  feet: CAMERAS.feet.front,
  full: CAMERAS.full.front,
};
// A repeat capture of the same state is bit-identical on this machine (measured: 0 changed
// pixels over 1600x1100, twice, including across a full equip cycle), so a change this small
// is still recorded rather than believed. The floor stays well above zero on purpose.
const CHANGE_THRESHOLD = 0.0002; // ≈352 px of 1,760,000
const BASES = {
  reference: { ...BASE_OUTFIT },
  // Body cosmetics need skin: garments would hide most of a tattoo or body paint.
  skin: { face: BASE_OUTFIT.face, hair: BASE_OUTFIT.hair },
};
const CONFIG = {
  app: APP_URL, viewport: `${VIEWPORT.width}x${VIEWPORT.height}`, deviceScaleFactor: 1,
  fov: FOV, pose: POSE, urlFlags: 'reconstructed=1&isolate=0 (the paths production uses)',
  scene: 'studio theme, default lighting, temporal StablePreview enabled',
  archetype: 'Customization.Archetype.Medium',
  bodyPreset: 'models/body/SK_Body_M.glb with models/reconstructed-meshes-v2/SK_Body_M.glb as the source body',
  bodyCaveat: 'Medium only. No other body preset or archetype is exercised, so nothing here '
    + 'says anything about Light or Heavy.',
  views: VIEWS.map(([view, y]) => ({ view, rigRotationY: +y.toFixed(3) })),
  bases: BASES, framingCameras: FRAMING_CAMERAS, measuredFraming: measureFraming,
  changeThreshold: CHANGE_THRESHOLD,
};

// ---- digests ---------------------------------------------------------------------------
const digestCache = new Map();
const digestCacheFile = path.resolve('scripts/generated/shader-probe/catalog-audit-digest-cache.json');
const persistentDigests = fs.existsSync(digestCacheFile) ? read(digestCacheFile) : {};
const fileVersion = stat => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => String(stat[key])).join(':');
const inputChanges = new Set();
const inputWatchers = [];
function watchInputs() {
  for (const file of ['src', 'public', 'package.json', 'package-lock.json', 'vite.config.ts', 'index.html',
    'scripts/shader-probe/catalog-audit.mjs', 'scripts/shader-probe/catalog-audit-core.mjs',
    'scripts/shader-probe/coverage-preview-harness.mjs']) {
    if (!fs.existsSync(file)) continue;
    const directory = fs.statSync(file).isDirectory();
    const watcher = fs.watch(file, { recursive: directory }, (event, name) => {
      const changed = path.resolve(directory && name ? path.join(file, String(name)) : file);
      // Windows also reports metadata/access notifications as "change". Retain
      // content changes, including ones later reverted, but ignore identical bytes.
      if (event === 'change' && fs.existsSync(changed)) {
        // Directory last-access updates contain no changed runtime bytes. Child
        // create/delete events and the final tree fingerprint cover membership.
        if (fs.statSync(changed).isDirectory()) return;
        const expected = digestCache.get(changed) ?? persistentDigests[changed]?.hash;
        const actual = createHash('sha256').update(fs.readFileSync(changed)).digest('hex');
        if (expected && actual === expected) return;
      }
      inputChanges.add(path.relative(process.cwd(), changed).replaceAll('\\', '/'));
    });
    watcher.on('error', error => inputChanges.add(`watch failed: ${error.message}`));
    watcher.unref(); inputWatchers.push(watcher);
  }
}
const captureHash = file => createHash('sha256').update(fs.readFileSync(path.join(captures, file))).digest('hex');
function fileDigest(file) {
  const key = path.resolve(file);
  if (!digestCache.has(key)) {
    if (!fs.existsSync(key)) { digestCache.set(key, null); return null; }
    const version = fileVersion(fs.statSync(key, { bigint: true }));
    const cached = persistentDigests[key];
    const hash = cached?.version === version ? cached.hash : createHash('sha256').update(fs.readFileSync(key)).digest('hex');
    if (fileVersion(fs.statSync(key, { bigint: true })) !== version) throw new Error(`Input changed while hashing: ${file}`);
    persistentDigests[key] = { version, hash };
    digestCache.set(key, hash);
  }
  return digestCache.get(key);
}
const publicPath = (assetPath) => path.resolve('public', assetPath);
const assetExists = (assetPath) => fs.existsSync(publicPath(assetPath));

function treeDigests(folder) {
  const result = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Audit inputs must not be symbolic links: ${file}`);
      if (entry.isDirectory()) walk(file);
      else result[path.relative(folder, file).replaceAll('\\', '/')] = fileDigest(file);
    }
  };
  walk(folder);
  return result;
}

// Conservative by design: source materials, transitive textures, automatic masks and
// embedded GLB maps all affect the picture. Hash all local runtime content, including
// previews, rather than pretending catalog-declared legacy paths enumerate those inputs.
function snapshotDigests() {
  const result = {
    renderer: core.stableHash(treeDigests('src')),
    runtimeAssets: core.stableHash(treeDigests('public')),
    build: Object.fromEntries(['package.json', 'package-lock.json', 'vite.config.ts', 'index.html']
      .map(file => [file, fileDigest(file)])),
    tools: {
      runner: fileDigest('scripts/shader-probe/catalog-audit.mjs'),
      core: fileDigest('scripts/shader-probe/catalog-audit-core.mjs'),
      harness: fileDigest('scripts/shader-probe/coverage-preview-harness.mjs'),
    },
  };
  fs.mkdirSync(path.dirname(digestCacheFile), { recursive: true });
  fs.writeFileSync(digestCacheFile, JSON.stringify(persistentDigests));
  return result;
}

let catalog = new Map();
function itemAssetDigest(id) {
  const item = catalog.get(id);
  if (!item) return null;
  return core.stableHash(core.itemAssets(item).map(p => [p, fileDigest(publicPath(p))]));
}

// ---- io helpers ------------------------------------------------------------------------
const write = (file, value) => {
  const target = path.join(generated, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
};
const label = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// ---- manifest --------------------------------------------------------------------------
function loadCatalog() {
  const items = read('src/data/items.json');
  catalog = new Map(items.map(i => [i.id, i]));
  const index = read('public/models/reconstructed-assemblies-v1/supported-items.json');
  return { items, sourceItems: index.items ?? [], sourceExceptions: index.exceptions ?? [], index };
}

function buildManifest() {
  const { items, sourceItems, sourceExceptions, index } = loadCatalog();
  const rows = core.buildManifest({ items, sourceItems, sourceExceptions, assetExists });
  const manifest = {
    formatVersion: core.AUDIT_FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    meaning: 'Every catalog choice, including decal, source-only and unrenderable rows. '
      + 'Structural eligibility only says a choice could be captured on the Medium reference '
      + 'body; it is not a capture, a visual review or an outfit acceptance.',
    catalog: 'src/data/items.json', activeIndex: 'public/models/reconstructed-assemblies-v1',
    sourceEnabledCount: sourceItems.length, sourceIndexScope: index.scope ?? null,
    summary: core.manifestSummary(rows),
    rows,
  };
  write('manifest.json', manifest);
  console.log(JSON.stringify(manifest.summary.choices ? {
    choices: manifest.summary.choices, eligible: manifest.summary.eligible,
    ineligible: manifest.summary.ineligible, sourceEnabled: sourceItems.length,
    families: manifest.summary.families,
  } : {}, null, 1));
  return manifest;
}

const readManifest = () => buildManifest(); // catalog and file availability may have changed

// ---- in-page evidence ------------------------------------------------------------------
/**
 * Everything the rig can tell us about what is actually attached. This traverses the whole
 * rig, not only the root's children: statics for earrings/eyewear/facewear/headwear are
 * re-parented onto bones, so a child-only scan reports them as empty.
 */
const rigEvidence = (page) => page.evaluate(() => {
  const root = window.__rigRoot;
  const THREE = window.__THREE;
  const shown = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const ownerOf = (o) => {
    for (let n = o; n; n = n.parent) if (n.userData.rigItemId) return n;
    return null;
  };
  const items = new Map();
  const decalMaterials = [];
  const seenMaterials = new Set();
  root.traverse((o) => {
    for (const m of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) {
      if (m.userData.decalPatched && !seenMaterials.has(m.uuid)) {
        seenMaterials.add(m.uuid);
        let key = null;
        try { key = m.customProgramCacheKey(); } catch { key = null; }
        const sig = key && /decal-(.*)-\d+$/.exec(key);
        const signature = sig ? sig[1] : '';
        const targets = [...signature.matchAll(/(?:^|-)(head|body|eyes|nails)[cmte]*(?=-|$)/g)].map(m => m[1]);
        decalMaterials.push({ material: m.name || '(unnamed)', layerSignature: signature, targets });
      }
    }
    if (!o.isMesh) return;
    const owner = ownerOf(o);
    if (!owner) return;
    const id = owner.userData.rigItemId;
    const entry = items.get(id) ?? {
      id, sourceAssembly: !!owner.userData.sourceAssembly, sourceSkinPair: !!owner.userData.sourceSkinPair,
      groupVisible: shown(owner), meshes: 0, visibleMeshes: 0, hiddenMeshes: 0, triangles: 0,
      materials: [], parts: [], boneAttached: false,
    };
    if (owner === o) entry.boneAttached = true; // static re-parented onto a bone
    const visible = shown(o);
    entry.meshes++;
    visible ? entry.visibleMeshes++ : entry.hiddenMeshes++;
    const geometry = o.geometry;
    if (visible && geometry) {
      entry.triangles += Math.round(((geometry.index ? geometry.index.count
        : geometry.attributes.position ? geometry.attributes.position.count : 0) / 3));
    }
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean)) {
      entry.materials.push({
        name: m.name || '(unnamed)', type: m.type, visible,
        sourceMaterial: m.userData.sourceMaterial ?? null,
        reconstructed: m.userData.reconstructed === true,
        maps: ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']
          .filter(k => m[k]).map(k => `${k}:${(m[k].userData && m[k].userData.url)
            || (m[k].image && (m[k].image.currentSrc || m[k].image.src)) || 'inline'}`.replace(location.origin, '')),
      });
      if (m.userData.sourceSlot && m.userData.sourceSlot.MaterialSlotName) {
        entry.parts.push({ slot: m.userData.sourceSlot.MaterialSlotName, source: m.userData.sourceMaterial ?? null });
      }
    }
    if (visible && THREE) {
      const box = new THREE.Box3().setFromObject(o);
      if (!box.isEmpty()) {
        entry.bounds = entry.bounds
          ? { min: entry.bounds.min.map((v, i) => Math.min(v, box.min.toArray()[i])),
              max: entry.bounds.max.map((v, i) => Math.max(v, box.max.toArray()[i])) }
          : { min: box.min.toArray(), max: box.max.toArray() };
      }
    }
    items.set(id, entry);
  });
  const assembly = window.__sourceAssembly ?? null;
  return {
    items: [...items.values()].map(e => ({
      ...e,
      bounds: e.bounds ? { min: e.bounds.min.map(v => +v.toFixed(3)), max: e.bounds.max.map(v => +v.toFixed(3)) } : null,
      materials: e.materials.slice(0, 24),
    })),
    decalMaterials,
    sourceOutfit: assembly ? {
      unresolvedItems: assembly.unresolvedItems ?? [],
      slotConflicts: assembly.slotConflicts ?? [],
      fittingTags: assembly.fittingTags ?? [],
      items: Object.fromEntries(Object.entries(assembly.items ?? {}).map(([id, v]) => [id,
        { source: v.source, hidden: !!v.hidden, parts: (v.parts ?? []).length }])),
    } : null,
    // The viewer reports a load failure as visible text; the capture layout hides overlays,
    // so read the node rather than trusting the picture.
    viewerError: (document.body.textContent.match(/Couldn’t load[^.]*\./) ?? [null])[0],
  };
});

const angle = (page, y) => page.evaluate(async (radians) => {
  window.__rigRoot.rotation.y = radians;
  window.__rigRoot.updateMatrixWorld(true);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}, y);

const frameCamera = (bounds, framing) => core.fitAuditCamera(bounds, {
  framing, ...VIEWPORT, fov: FOV, rotations: VIEWS.map(([, angle]) => angle),
});

// ---- image comparison ------------------------------------------------------------------
const rawCache = new Map();
async function rawPixels(file) {
  if (!rawCache.has(file)) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    rawCache.set(file, { data, width: info.width, height: info.height });
    // One frame is ~7 MB raw; keep only the control set and the choice being compared.
    if (rawCache.size > 8) rawCache.delete(rawCache.keys().next().value);
  }
  return rawCache.get(file);
}

/** Did this choice change any pixels against its own control render, and where? */
async function compare(file, controlFile, diffFile) {
  const a = await rawPixels(controlFile), b = await rawPixels(file);
  if (a.width !== b.width || a.height !== b.height) return { changedPixels: null, error: 'size mismatch' };
  const diff = Buffer.alloc(a.width * a.height * 4);
  const changedPixels = pixelmatch(a.data, b.data, diff, a.width, a.height,
    { threshold: 0.1, diffMask: true, alpha: 0 });
  let x0 = a.width, y0 = a.height, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (diff[(y * a.width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const result = {
    changedPixels, changedFraction: +(changedPixels / (a.width * a.height)).toFixed(6),
    changedBox: x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
  };
  if (diffFile) {
    fs.mkdirSync(path.dirname(diffFile), { recursive: true });
    await sharp(diff, { raw: { width: a.width, height: a.height, channels: 4 } }).png().toFile(diffFile);
    result.diffFile = path.relative(captures, diffFile).replaceAll('\\', '/');
  }
  return result;
}

// ---- capture ---------------------------------------------------------------------------
const clearRecord = record => { for (const key of Object.keys(record)) record[key].length = 0; };
const rel = file => path.relative(captures, file).replaceAll('\\', '/');

class Session {
  constructor(page, record) {
    this.page = page; this.record = record;
    this.cam = null; this.outfitKey = null; this.controls = new Map(); this.loadedAssets = new Set();
  }

  rememberLoads() {
    for (const request of this.record.requests) if (request.outcome === 'finished' && request.status !== null && request.status < 400)
      this.loadedAssets.add(new URL(request.url).pathname);
  }

  /** Idempotent: already showing this outfit at this camera is a no-op, a new camera is a
   *  navigation, and anything else is an in-place equip through the app's own store. */
  async show(slots, cam) {
    const key = JSON.stringify(slots);
    if (this.cam === cam && this.outfitKey === key) return false;
    if (this.cam === cam) {
      await swap(this.page, slots);
    } else {
      await this.page.goto(outfitUrl(slots, { cam, fov: FOV, pose: POSE }), { waitUntil: 'networkidle' });
      this.cam = cam;
    }
    this.outfitKey = key;
    await waitIdle(this.page);
    await angle(this.page, 0);
    return true;
  }

  async captureViews(dir, prefix) {
    const views = [];
    for (const [view, y] of VIEWS) {
      await angle(this.page, y);
      const file = path.join(dir, `${prefix}.${view}.png`);
      await shoot(this.page, file);
      views.push({ view, rigRotationY: +y.toFixed(3), file: rel(file), absolute: file });
    }
    await angle(this.page, 0);
    return views;
  }

  /** The same base, same camera, with the audited slot empty: what the choice must change. */
  async control(row, base, cam, fingerprint) {
    const key = `${base.key}|${row.slot}|${cam}`;
    if (this.controls.has(key)) return this.controls.get(key);
    const dir = path.join(captures, 'controls', fingerprint.slice(0, 8));
    const prefix = `${base.key}.${row.slot}.${createHash('sha1').update(cam).digest('hex').slice(0, 8)}`;
    // Reuse controls within this session; a new run measures fresh controls.
    await this.show(base.slots, cam);
    const views = await this.captureViews(dir, prefix);
    const repeat = path.join(dir, `${prefix}.repeat.png`);
    await shoot(this.page, repeat);
    const noiseFraction = (await compare(repeat, views[0].absolute, null)).changedFraction;
    fs.rmSync(repeat, { force: true });
    const control = { key, baseKey: base.key, slots: base.slots, camera: cam, views, noiseFraction };
    this.controls.set(key, control);
    return control;
  }
}

async function captureItem(session, row, item, context, fingerprint) {
  const { manifestRows } = context;
  const base = core.baseFor(row, BASES);
  const slots = { ...base.slots, [row.slot]: row.id };
  const framing = core.framingFor(row);
  const started = performance.now();
  const record = {
    id: row.id, name: row.name, slot: row.slot, requestedSlots: slots, baseKey: base.key,
    declaredPath: row.declaredPath, sourceEnabled: row.sourceEnabled,
    materialKinds: row.materialKinds, bindingFamilies: row.bindingFamilies,
    familyKey: row.familyKey, variantKey: row.variantKey,
    declaredMaterialAssets: core.itemAssets(item).filter(p => !p.endsWith('.glb')).slice(0, 12),
    framing, fingerprint, archetype: CONFIG.archetype, bodyPreset: CONFIG.bodyPreset,
    pose: POSE, fov: FOV, viewport: CONFIG.viewport, scene: CONFIG.scene,
    thumbnail: row.thumbnail && assetExists(row.thumbnail) ? row.thumbnail : null,
    interactions: core.interactionRequirements(row.slot),
    prospectiveFamilyGain: core.prospectiveFamilyGain(row, manifestRows),
    capturedAt: new Date().toISOString(),
    captureStatus: 'failed', targetEvidence: 'unknown', observedPath: 'none',
    visualReview: 'pending', outfitAcceptance: 'pending', notes: [], views: [],
  };
  try {
    session.rememberLoads();
    clearRecord(session.record);
    let cam = context.cams.get(row.familyKey) ?? FRAMING_CAMERAS[framing];
    await session.show(slots, cam);
    // Measure the choice on the body once per mesh family, then frame every sibling the same.
    if (measureFraming && !context.cams.has(row.familyKey)) {
      const measured = await rigEvidence(session.page);
      const found = measured.items.find(e => e.id === row.id);
      const fitted = found?.bounds ? frameCamera(found.bounds, framing) : null;
      cam = fitted ?? cam;
      context.cams.set(row.familyKey, cam);
      record.framingSource = fitted ? `fitted to the measured bounds of ${row.id}` : `slot default (${framing})`;
      if (cam !== session.cam) await session.show(slots, cam);
    } else {
      record.framingSource = context.cams.has(row.familyKey)
        ? `measured framing shared by ${row.familyKey}` : `slot default (${framing})`;
    }
    record.camera = cam;

    let evidence = await rigEvidence(session.page);
    let attached = evidence.items.find(e => e.id === row.id) ?? null;
    const observed = classify(session.record);
    const ownAssets = new Set(core.itemAssets(item).map(p => p.split('/').pop()));
    const mentions = (entry) => [...ownAssets].some(name => entry.includes(name));
    record.attached = attached;
    // Captures swap outfits in place, so a silently failed equip leaves the PREVIOUS choice
    // on the body. Name everything the rig is actually carrying, not just the one we asked for.
    record.rigItemIds = evidence.items.map(e => e.id).sort();
    record.unexpectedInRig = record.rigItemIds.filter(id => !Object.values(slots).includes(id));
    record.missingFromRig = Object.values(slots).filter(id => !record.rigItemIds.includes(id)
      && !(catalog.get(id)?.decal)); // decals have no rig node of their own
    record.viewerError = evidence.viewerError;
    if (evidence.viewerError) record.notes.push(`viewer reported: ${evidence.viewerError}`);
    record.decalMaterials = evidence.decalMaterials;
    record.sourceOutfit = evidence.sourceOutfit ? {
      hidden: evidence.sourceOutfit.items[row.id]?.hidden ?? null,
      parts: evidence.sourceOutfit.items[row.id]?.parts ?? null,
      source: evidence.sourceOutfit.items[row.id]?.source ?? null,
      unresolved: (evidence.sourceOutfit.unresolvedItems ?? []).includes(row.id),
      slotConflicts: (evidence.sourceOutfit.slotConflicts ?? []).filter(c => (c.items ?? []).includes(row.id)),
    } : null;
    record.errors = observed.errors;
    record.failedRequests = observed.failedRequests;
    record.failedRequestsForThisChoice = observed.failedRequests.filter(mentions);
    record.supersededLoads = observed.supersededLoads; // aborted StrictMode loads, not failures
    record.completedRequests = observed.completedRequests;
    record.renderClean = !observed.errors.length && !observed.failedRequests.length;

    const decalTexturesRequested = (item.decal?.layers ?? [])
      .flatMap(l => [l.colorPath, l.maskPath]).filter(Boolean).map(p => '/' + p.replace(/^\//, ''));
    let decalTexturesFetched;

    const control = await session.control(row, base, cam, fingerprint);
    record.control = { baseKey: control.baseKey, slots: control.slots, camera: control.camera,
      views: control.views.map(v => ({ view: v.view, file: v.file })), noiseFraction: control.noiseFraction };
    record.controlViews = control.views.map(v => ({ view: v.view, file: v.file }));
    // Capturing the control moved the page off this choice; put it back before shooting.
    await session.show(slots, cam);

    const storeUrl = await storeModuleUrl(session.page);
    record.equippedSlots = await session.page.evaluate(async url => {
      const { useBuildStore } = await import(url); return useBuildStore.getState().build;
    }, storeUrl);
    if (record.equippedSlots[row.slot] !== row.id) throw new Error('Captured outfit does not contain the requested choice');
    evidence = await rigEvidence(session.page);
    attached = evidence.items.find(e => e.id === row.id) ?? null;
    record.attached = attached;
    record.rigItemIds = evidence.items.map(e => e.id).sort();
    record.decalMaterials = evidence.decalMaterials;

    const views = await session.captureViews(path.join(captures, 'items', row.slot), row.id);
    const diffs = [];
    for (const view of views) {
      const control_ = control.views.find(v => v.view === view.view);
      const result = await compare(view.absolute, control_.absolute, null);
      diffs.push({ view: view.view, ...result });
    }
    record.views = views.map(v => ({ view: v.view, rigRotationY: v.rigRotationY, file: v.file }));
    record.imageDigests = Object.fromEntries([...record.views, ...record.controlViews].map(view => [view.file, captureHash(view.file)]));
    record.diffs = diffs;
    const changedFraction = Math.max(...diffs.map(d => d.changedFraction ?? 0));
    record.changedFraction = changedFraction;
    record.changeThreshold = Math.max(CHANGE_THRESHOLD, 3 * (control.noiseFraction ?? 0));

    session.rememberLoads();
    decalTexturesFetched = decalTexturesRequested.filter(name => session.loadedAssets.has(name));
    const finalLoads = classify(session.record);
    record.errors = finalLoads.errors;
    record.failedRequests = finalLoads.failedRequests;
    record.failedRequestsForThisChoice = finalLoads.failedRequests.filter(mentions);
    record.supersededLoads = finalLoads.supersededLoads;
    record.completedRequests = finalLoads.completedRequests;
    record.renderClean = !finalLoads.errors.length && !finalLoads.failedRequests.length && !evidence.viewerError;

    const verdict = core.classifyEvidence(row, {
      attached: !!attached, sourceAssembly: !!attached?.sourceAssembly, sourceSkinPair: !!attached?.sourceSkinPair,
      groupVisible: !!attached?.groupVisible, visibleMeshes: attached?.visibleMeshes ?? 0,
      decalPatchedMaterials: evidence.decalMaterials.length,
      decalTexturesRequested, decalTexturesFetched,
      decalAppliedTargets: [...new Set(evidence.decalMaterials.flatMap(m => m.targets))],
      changedFraction, changeThreshold: record.changeThreshold, views,
    });
    Object.assign(record, verdict, { notes: [...record.notes, ...verdict.notes] });
    if (!record.renderClean) record.targetEvidence = 'uncertain-render-failure';
    record.decal = row.declaredPath === 'decal'
      ? { requested: decalTexturesRequested, fetched: decalTexturesFetched,
          patchedMaterials: evidence.decalMaterials,
          note: 'Evidence combines the intended compositor targets, observed texture loads where applicable, '
            + 'actual store selection and pixel change against the matching control. Tint-only choices need no per-item texture.' }
      : null;
    // A diff image is kept exactly where it is the interesting evidence: nothing changed.
    if (record.targetEvidence !== 'confirmed-visible') {
      const front = views.find(v => v.view === 'front');
      const control_ = control.views.find(v => v.view === 'front');
      const result = await compare(front.absolute, control_.absolute,
        path.join(captures, 'diffs', `${row.id}.front.png`));
      record.diffImage = result.diffFile ?? null;
    }
  } catch (error) {
    record.renderClean = false;
    record.captureStatus = 'failed';
    record.targetEvidence = 'unknown';
    record.error = String(error && error.stack ? error.stack.split('\n')[0] : error);
    record.notes.push('capture threw before finishing; this is a failure, not an unsupported case');
    try {
      const shot = path.join(captures, 'failures', `${row.id}.png`);
      await shoot(session.page, shot);
      record.failureShot = rel(shot);
    } catch { /* the page may be unusable; the record already says so */ }
    session.cam = null; // force a clean navigation for the next choice
    session.outfitKey = null;
  }
  record.elapsedSeconds = +((performance.now() - started) / 1000).toFixed(1);
  return record;
}

async function runCapture() {
  watchInputs();
  const manifest = readManifest();
  const rows = manifest.rows;
  const byId = new Map(rows.map(r => [r.id, r]));
  const cohortFile = path.join(generated, 'cohort.json');
  let cohort;
  if (explicitItems.length) {
    const missing = explicitItems.filter(id => !byId.has(id));
    if (missing.length) throw new Error(`Unknown item id(s): ${missing.join(', ')}`);
    cohort = { seed, size: explicitItems.length, selectedIds: explicitItems,
      selected: explicitItems.map(id => ({ ...byId.get(id), reasons: ['requested explicitly'] })) };
  } else if (!force && fs.existsSync(cohortFile) && read(cohortFile).seed === seed
    && read(cohortFile).selectedIds.length === cohortSize
    && read(cohortFile).selectedIds.every(id => byId.get(id)?.eligible)) {
    cohort = read(cohortFile);
    cohort.selected = cohort.selectedIds.map(id => ({ ...byId.get(id),
      reasons: cohort.selected?.find(s => s.id === id)?.reasons ?? [] }));
  } else {
    cohort = core.selectCohort(rows, { size: cohortSize, seed });
  }
  if (!explicitItems.length) {
    write('cohort.json', {
      formatVersion: core.AUDIT_FORMAT_VERSION, generatedAt: new Date().toISOString(), seed,
      meaning: 'Deterministic first cohort: seeded strata over slots, surface-production paths, '
        + 'decal targets, variant sets on one mesh, and reconstructed controls.',
      strata: cohort.selected.map(r => ({ id: r.id, slot: r.slot, declaredPath: r.declaredPath,
        materialKinds: r.materialKinds, reasons: r.reasons })),
      selectedIds: cohort.selectedIds,
    });
  }

  const ordered = core.captureOrder(cohort.selected);
  const wanted = limit ? ordered.slice(0, limit) : ordered;
  const digests = snapshotDigests();
  const fingerprint = core.globalFingerprint({ config: CONFIG, digests });
  captures = path.join(capturesRoot, 'snapshots', fingerprint);
  fs.mkdirSync(captures, { recursive: true });

  const resultsFile = path.join(generated, 'results.json');
  const previous = !force && fs.existsSync(resultsFile) ? read(resultsFile) : null;
  const records = new Map(Object.entries(previous?.fingerprint === fingerprint ? previous.records : {}));
  const results = {
    formatVersion: core.AUDIT_FORMAT_VERSION,
    startedAt: new Date().toISOString(),
    meaning: 'Per-choice capture and attachment evidence for the current renderer. A capture is '
      + 'not a visual acceptance and not an outfit acceptance; both stay pending for human review.',
    config: CONFIG, fingerprint, digests,
    captures, selectedIds: wanted.map(row => row.id), snapshotValid: true,
    cohortSize: wanted.length, records: Object.fromEntries(records),
    resumed: [], captured: [],
  };
  const save = () => {
    results.records = Object.fromEntries([...records.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    results.summary = core.resultsSummary(wanted.map(row => results.records[row.id]).filter(Boolean));
    write('results.json', results);
    write(`snapshots/${fingerprint}/results.json`, results);
  };

  // Decide resume before touching the browser, so an unchanged batch costs nothing.
  const todo = [];
  for (const row of wanted) {
    const itemFp = core.itemFingerprint(fingerprint, itemAssetDigest(row.id),
      { base: core.baseKeyFor(row), framing: core.framingFor(row) });
    // A structurally unrenderable choice is recorded as unsupported. It is never attempted,
    // and never counted as a capture that happens to be empty.
    if (!row.eligible) {
      records.set(row.id, {
        id: row.id, name: row.name, slot: row.slot, declaredPath: row.declaredPath,
        materialKinds: row.materialKinds, familyKey: row.familyKey, variantKey: row.variantKey,
        fingerprint: itemFp, captureStatus: 'unsupported', targetEvidence: 'not-applicable',
        observedPath: 'none', visualReview: 'pending', outfitAcceptance: 'pending',
        notes: row.ineligibleReasons, renderClean: null, views: [],
        interactions: core.interactionRequirements(row.slot),
        capturedAt: new Date().toISOString(),
      });
      continue;
    }
    const decision = core.isResumable(records.get(row.id), itemFp,
      (file) => fs.existsSync(path.join(captures, file)), captureHash);
    if (decision.resume) {
      results.resumed.push({ id: row.id, reason: decision.reason });
      continue;
    }
    todo.push({ row, fingerprint: itemFp, reason: decision.reason });
  }
  console.log(`${wanted.length} in cohort · ${results.resumed.length} resumed · ${todo.length} to capture`);
  save();
  if (!todo.length) { finishResults(results, save); return results; }

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = { cams: new Map(), manifestRows: rows };
  try {
    // Contiguous chunks keep camera and base locality inside each worker.
    const chunks = Array.from({ length: concurrency }, (_, i) =>
      todo.filter((_, index) => Math.floor(index * concurrency / todo.length) === i));
    let done = 0;
    await Promise.all(chunks.filter(c => c.length).map(async (chunk) => {
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      const session = new Session(page, watch(page));
      try {
        for (const job of chunk) {
          const record = await captureItem(session, job.row, catalog.get(job.row.id), context, job.fingerprint);
          record.resumeReason = job.reason;
          records.set(job.row.id, record);
          results.captured.push(job.row.id);
          save(); // saved after every choice: an interrupted run keeps everything it earned
          done++;
          console.log(`${done}/${todo.length} ${job.row.id} · ${record.captureStatus}`
            + ` · ${record.targetEvidence} · ${record.observedPath}`
            + ` · Δ${(record.changedFraction ?? 0).toFixed(4)}${record.error ? ` · ${record.error}` : ''}`);
        }
      } finally { await page.close(); }
    }));
  } finally { await browser.close(); }
  finishResults(results, save);
  return results;
}

function finishResults(results, save) {
  for (const watcher of inputWatchers) watcher.close();
  digestCache.clear();
  results.snapshotValid = !inputChanges.size
    && core.globalFingerprint({ config: CONFIG, digests: snapshotDigests() }) === results.fingerprint;
  if (!results.snapshotValid) {
    for (const record of Object.values(results.records)) {
      record.captureStatus = 'stale'; record.targetEvidence = 'stale-evidence'; record.renderClean = false;
    }
    results.invalidationReason = 'Runtime or tool content changed during capture; these records cannot resume.';
    results.changedInputs = [...inputChanges];
  }
  results.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify(results.summary, null, 1));
}

// ---- contact sheets --------------------------------------------------------------------
const TILE = { width: 430, header: 40, get height() { return this.header + Math.round(this.width * VIEWPORT.height / VIEWPORT.width); } };

async function tile(file, title, subtitle, thumbnail) {
  const body = file && fs.existsSync(file)
    ? await sharp(file).resize(TILE.width, TILE.height - TILE.header, { fit: 'contain', background: '#20242e' }).toBuffer()
    : await sharp({ create: { width: TILE.width, height: TILE.height - TILE.header, channels: 4, background: '#3a2020' } }).png().toBuffer();
  const composites = [{ input: body, left: 0, top: TILE.header }];
  if (thumbnail && fs.existsSync(thumbnail)) {
    composites.push({ input: await sharp(thumbnail).resize(78, 78, { fit: 'contain', background: '#20242e' }).png().toBuffer(),
      left: TILE.width - 82, top: TILE.header + 4 });
  }
  const text = `<svg width="${TILE.width}" height="${TILE.header}">`
    + `<rect width="${TILE.width}" height="${TILE.header}" fill="#171a22"/>`
    + `<text x="8" y="15" fill="#ffffff" font-family="Arial" font-size="12">${label(title)}</text>`
    + `<text x="8" y="30" fill="#9fb0c0" font-family="Arial" font-size="10">${label(subtitle)}</text></svg>`;
  composites.push({ input: Buffer.from(text), left: 0, top: 0 });
  return sharp({ create: { width: TILE.width, height: TILE.height, channels: 4, background: '#20242e' } })
    .composite(composites).png().toBuffer();
}

async function sheet(name, heading, tiles, columns = 4) {
  const rows = Math.ceil(tiles.length / columns) || 1;
  const head = 50;
  const svg = `<svg width="${columns * TILE.width}" height="${head}">`
    + `<rect width="${columns * TILE.width}" height="${head}" fill="#0f1218"/>`
    + `<text x="10" y="20" fill="#ffffff" font-family="Arial" font-size="14">${label(heading)}</text>`
    + `<text x="10" y="38" fill="#94a3b4" font-family="Arial" font-size="11">Local preview renders on the Medium `
    + `reference body, studio preview lighting. Evidence for review — no choice here is visually accepted.</text></svg>`;
  const composites = [{ input: Buffer.from(svg), left: 0, top: 0 }];
  for (const [i, buffer] of tiles.entries()) {
    composites.push({ input: buffer, left: (i % columns) * TILE.width, top: head + Math.floor(i / columns) * TILE.height });
  }
  const file = path.join(captures, 'sheets', `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: columns * TILE.width, height: head + rows * TILE.height, channels: 4, background: '#0f1218' } })
    .composite(composites).png().toFile(file);
  return `sheets/${name}.png`;
}

async function buildSheets() {
  const results = read(path.join(generated, 'results.json'));
  captures = results.captures ?? capturesRoot;
  const records = Object.values(results.records).filter(r => results.selectedIds?.includes(r.id) ?? true).sort((a, b) =>
    a.slot.localeCompare(b.slot) || a.familyKey.localeCompare(b.familyKey) || a.id.localeCompare(b.id));
  const bySlot = new Map();
  for (const record of records) bySlot.set(record.slot, [...(bySlot.get(record.slot) ?? []), record]);
  const sheets = [];
  for (const [slot, entries] of [...bySlot.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const view of VIEWS.map(v => v[0])) {
      const tiles = [];
      for (const entry of entries) {
        const capture = entry.views?.find(v => v.view === view);
        tiles.push(await tile(capture ? path.join(captures, capture.file) : null, entry.name,
          `${entry.id} · ${entry.observedPath} · ${entry.targetEvidence}`,
          view === 'front' && entry.thumbnail ? publicPath(entry.thumbnail) : null));
      }
      sheets.push({ slot, view, items: entries.map(e => e.id),
        file: await sheet(`${slot}-${view}`, `${slot} · ${view} · ${entries.length} choice(s)`, tiles) });
    }
  }
  const rows = [];
  for (const [slot, entries] of [...bySlot.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push(`<h2>${label(slot)} · ${entries.length} choice(s)</h2><p>`
      + VIEWS.map(([view]) => {
        const s = sheets.find(x => x.slot === slot && x.view === view);
        return s ? `<a href="${s.file}">${view} sheet</a>` : '';
      }).filter(Boolean).join(' · ') + '</p>');
    rows.push('<table><tr><th>choice</th><th>path</th><th>evidence</th><th>Δ pixels</th>'
      + '<th>views</th><th>materials</th><th>notes</th></tr>');
    for (const entry of entries) {
      const links = (entry.views ?? []).map(v => `<a href="${v.file}">${v.view}</a>`).join(' · ')
        + (entry.diffImage ? ` · <a href="${entry.diffImage}">diff</a>` : '')
        + (entry.failureShot ? ` · <a href="${entry.failureShot}">failure</a>` : '');
      const materials = [...new Set((entry.attached?.materials ?? []).map(m => m.sourceMaterial
        ? m.sourceMaterial.split('.').pop() : m.name))].slice(0, 6).join(', ')
        || (entry.decal ? entry.decal.fetched.join(', ') : '');
      const good = entry.targetEvidence === 'confirmed-visible';
      rows.push(`<tr><td>${label(entry.name)}<br><code>${label(entry.id)}</code>`
        + `${entry.sourceEnabled ? '<br><b>source control</b>' : ''}</td>`
        + `<td>${label(entry.observedPath)}<br><code>${label(entry.materialKinds.join('+'))}</code></td>`
        + `<td class="${good ? 'ok' : 'warn'}">${label(entry.targetEvidence)}<br>`
        + `<small>${label(entry.captureStatus)}${entry.renderClean ? '' : ' · render not clean'}</small></td>`
        + `<td>${entry.changedFraction ?? '—'}</td><td>${links}</td>`
        + `<td><code>${label(materials)}</code></td>`
        + `<td><small>${label([...(entry.notes ?? []), ...(entry.failedRequestsForThisChoice ?? [])].join(' · ')) || '—'}</small></td></tr>`);
    }
    rows.push('</table>');
  }
  const summary = results.summary ?? {};
  const html = `<!doctype html><meta charset="utf-8"><title>Current renderer catalog audit</title>
<style>body{background:#0f1218;color:#e6edf3;font:13px Arial,sans-serif;margin:24px}
h1{font-size:20px}h2{font-size:15px;margin-top:28px;border-bottom:1px solid #2a303c;padding-bottom:4px}
a{color:#7cc4ff}table{border-collapse:collapse;margin:8px 0 18px;width:100%}
td,th{border:1px solid #2a303c;padding:4px 8px;text-align:left;vertical-align:top}
code{color:#9fb0c0}.ok{color:#7fd88f}.warn{color:#ffc46b}</style>
<h1>Current renderer catalog audit · cohort 01</h1>
<p>${label(results.meaning)}</p>
<p><b>Tested:</b> ${label(CONFIG.archetype)} · ${label(CONFIG.bodyPreset)} · pose ${label(CONFIG.pose)} ·
${label(CONFIG.viewport)} · fov ${CONFIG.fov} · ${label(CONFIG.scene)} · views ${VIEWS.map(v => v[0]).join('/')}
(the rig is rotated, the camera is not moved).<br><b>${label(CONFIG.bodyCaveat)}</b></p>
<p><b>Base outfits:</b> reference <code>${label(JSON.stringify(BASES.reference))}</code>;
skin <code>${label(JSON.stringify(BASES.skin))}</code>. Each choice is compared against its own
control render: the same base and camera with the audited slot empty.</p>
<p><b>Counts:</b> ${label(JSON.stringify(summary))}</p>
${rows.join('\n')}`;
  fs.writeFileSync(path.join(captures, 'index.html'), html);
  write('sheets.json', { formatVersion: core.AUDIT_FORMAT_VERSION, generatedAt: new Date().toISOString(),
    index: path.join(captures, 'index.html'), sheets });
  console.log(`sheets: ${sheets.length} · ${path.join(captures, 'index.html')}`);
  return sheets;
}

// ---- main ------------------------------------------------------------------------------
fs.mkdirSync(generated, { recursive: true });
fs.mkdirSync(captures, { recursive: true });
if (mode === 'manifest') { loadCatalog(); buildManifest(); }
if (mode === 'capture' || mode === 'all') { loadCatalog(); await runCapture(); }
if (mode === 'sheets' || mode === 'all') { loadCatalog(); await buildSheets(); }
if (!['manifest', 'capture', 'sheets', 'all'].includes(mode)) {
  throw new Error(`Unknown --mode ${mode}; expected manifest, capture, sheets or all`);
}
