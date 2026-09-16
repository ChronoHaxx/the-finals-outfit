#!/usr/bin/env node
// capture-family.mjs — reusable local capture runner for THE FINALS garment-family acceptance.
//
// This is a bounded structural capture tool. It validates a garment-family config, equips one
// item at a time on a base outfit through the shared harness, proves the rig assembled the
// exact expected source meshes/materials (or, in `before` mode, that it did NOT), keeps the
// rig's yaw rotation between shots, hashes the evidence and writes report.json progressively.
//
// It never decides whether an image looks correct and never claims visual/human acceptance:
// every `acceptance` field stays 'pending' for Astra to review. Physical input is out of scope.
// Playwright is imported lazily inside the run path, so the pure helpers in this module are
// unit-testable with Node alone. The harness owns routing, rig inspection, swapping and request
// classification; this module only drives it and records evidence.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  APP_URL,
  INDEX_FILES,
  classify,
  outfitUrl,
  rigState,
  servePreviewIndex,
  shoot,
  swap,
  waitIdle,
  watch,
} from './coverage-preview-harness.mjs';

export const TOOL = 'capture-family';
export const MODES = Object.freeze(['before', 'preview', 'active']);
export const DEFAULT_POSE = 'a';
export const BROWSER_CHANNEL = process.env.CAPTURE_CHANNEL ?? 'msedge';
export const LAUNCH_OPTIONS = Object.freeze({ channel: BROWSER_CHANNEL, headless: true });
export const DEFAULT_ANGLE_NAMES = Object.freeze([
  'front', 'front-right', 'right', 'back-right', 'back', 'back-left', 'left', 'front-left',
]);
// The camera is fixed; a view is named for the part of the garment it shows after the rig is
// rotated by angle.radians about +Y. Eight evenly spaced yaw angles, front at 0.
export const FRONT_ANGLE = Object.freeze({ name: 'front', radians: 0 });
export const LIMITS = 'Structural checks only. Physical input and whether an image looks correct are out of scope. '
  + "acceptance stays 'pending' even when every structural check passes.";

export const USAGE = `Usage: node scripts/shader-probe/capture-family.mjs \\
  --config <json> --output <new-directory> --mode before|preview|active [--preview <folder>]

  --config     path to the garment-family JSON config
  --output     new (or empty) directory that will receive report.json and views/
  --mode       before   legacy item must be visible and NOT yet a sourceAssembly (front view only)
               preview  serve the preview index and require the exact reconstructed assembly
               active   require the exact reconstructed assembly from the active index
  --preview    index folder to serve; required in preview mode, ignored otherwise`;

// ---------------------------------------------------------------------------------------------
// Small pure helpers: safety, hashing, defaults.
// ---------------------------------------------------------------------------------------------

/** True when `name` is a single safe path component (no separators, no traversal, no NUL). */
export function isSafeComponent(name) {
  return typeof name === 'string'
    && name.length > 0
    && name !== '.'
    && name !== '..'
    && !name.includes('/')
    && !name.includes('\\')
    && !name.includes('\0')
    && !name.endsWith('.')
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    && /^[A-Za-z0-9._-]+$/.test(name);
}

/** Resolve components under `root`, refusing anything that could escape it. */
export function resolveUnder(root, ...components) {
  for (const component of components) {
    if (!isSafeComponent(component)) throw new Error(`unsafe path component: ${JSON.stringify(component)}`);
  }
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...components);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`refusing to write outside output directory: ${resolved}`);
  }
  return resolved;
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Stable SHA256 of a (normalized) config, so evidence can be tied to exact inputs. */
export function configHash(config) {
  return createHash('sha256').update(canonicalJson(config)).digest('hex');
}

export function defaultAngles() {
  return DEFAULT_ANGLE_NAMES.map((name, index) => ({ name, radians: (index * Math.PI) / 4 }));
}

export function serializeError(error) {
  if (!error) return null;
  return { name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack ?? null };
}

export function errorMessage(error) {
  return error?.message ? String(error.message) : String(error);
}

// ---------------------------------------------------------------------------------------------
// CLI / option validation.
// ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { config: null, output: null, mode: null, preview: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`missing value for ${arg}`);
      index += 1;
      return next;
    };
    if (arg === '--config') options.config = value();
    else if (arg === '--output') options.output = value();
    else if (arg === '--mode') options.mode = value();
    else if (arg === '--preview') options.preview = value();
    else throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
  }
  return options;
}

export function validateOptions(options) {
  const errors = [];
  if (!options?.config) errors.push('--config <json> is required');
  if (!options?.output) errors.push('--output <new-directory> is required');
  if (!options?.mode) errors.push('--mode <before|preview|active> is required');
  else if (!MODES.includes(options.mode)) {
    errors.push(`malformed mode ${JSON.stringify(options.mode)} (expected before|preview|active)`);
  }
  if (options?.mode === 'preview' && !options.preview) {
    errors.push('--preview <folder> is required in preview mode');
  }
  if (errors.length) throw new Error(`invalid arguments:\n- ${errors.join('\n- ')}\n\n${USAGE}`);
  return options;
}

/** The output directory must be new or empty; a reused nonempty directory is rejected. */
export function assertFreshOutput(output) {
  const resolved = path.resolve(output);
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) throw new Error(`--output exists and is not a directory: ${resolved}`);
    const entries = fs.readdirSync(resolved);
    if (entries.length > 0) {
      throw new Error(`--output directory is not empty (reused): ${resolved}`);
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------------------------
// Config validation. Never infers or rewrites catalog data; only normalizes defaults.
// ---------------------------------------------------------------------------------------------

function validateStringSet(value, where, label, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${where} must be a nonempty array of exact ${label} paths`);
    return;
  }
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      errors.push(`${where} entries must be nonempty strings`);
      continue;
    }
    if (seen.has(entry)) errors.push(`${where} has a duplicate ${label}: ${entry}`);
    seen.add(entry);
  }
}

/** Parse 'x,y,z,tx,ty,tz' into six finite numbers, or null when malformed. */
export function parseCamera(camera) {
  if (typeof camera !== 'string') return null;
  const parts = camera.split(',').map(part => part.trim());
  if (parts.length !== 6) return null;
  const numbers = parts.map(part => (part === '' ? Number.NaN : Number(part)));
  if (!numbers.every(Number.isFinite)) return null;
  return numbers;
}

/**
 * Validate and normalize a parsed config. Throws one Error listing every problem.
 * Catalog values (baseOutfit ids, mesh/material paths, path) are passed through untouched.
 */
export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config must be a JSON object');
  }
  const errors = [];

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    errors.push('config.items must be a nonempty array');
  }
  const ids = new Set();
  const items = [];
  for (const [index, item] of (Array.isArray(raw.items) ? raw.items : []).entries()) {
    const where = `items[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    if (!isSafeComponent(item.id)) {
      errors.push(`${where}.id must be a nonempty safe name without path separators or traversal: ${JSON.stringify(item.id)}`);
    } else if (ids.has(item.id.toLowerCase())) {
      errors.push(`duplicate item id: ${item.id}`);
    } else {
      ids.add(item.id.toLowerCase());
    }
    if (typeof item.slot !== 'string' || item.slot.length === 0) {
      errors.push(`${where}.slot is required`);
    }
    validateStringSet(item.meshes, `${where}.meshes`, 'source mesh', errors);
    validateStringSet(item.materials, `${where}.materials`, 'source material', errors);
    items.push({
      id: item.id,
      slot: item.slot,
      meshes: Array.isArray(item.meshes) ? [...item.meshes] : [],
      materials: Array.isArray(item.materials) ? [...item.materials] : [],
    });
  }

  if (!raw.baseOutfit || typeof raw.baseOutfit !== 'object' || Array.isArray(raw.baseOutfit)) {
    errors.push('config.baseOutfit must be an object mapping slot -> id');
  } else {
    for (const [slot, id] of Object.entries(raw.baseOutfit)) {
      if (typeof id !== 'string' || id.length === 0) {
        errors.push(`config.baseOutfit[${JSON.stringify(slot)}] must be a nonempty id`);
      }
    }
  }

  if (parseCamera(raw.camera) === null) {
    errors.push(`config.camera must be exactly six finite numbers 'x,y,z,tx,ty,tz': ${JSON.stringify(raw.camera)}`);
  }

  if (typeof raw.path !== 'string' || !raw.path.startsWith('/')) {
    errors.push(`config.path must be an absolute URL path starting with '/': ${JSON.stringify(raw.path)}`);
  } else if (raw.path.split('/').includes('..')) {
    errors.push(`config.path must not contain '..': ${JSON.stringify(raw.path)}`);
  }

  const angles = raw.angles === undefined ? defaultAngles() : raw.angles;
  if (!Array.isArray(angles) || angles.length === 0) {
    errors.push('config.angles must be a nonempty array when provided');
  } else {
    const names = new Set();
    for (const [index, angle] of angles.entries()) {
      if (!angle || typeof angle !== 'object' || Array.isArray(angle)) {
        errors.push(`config.angles[${index}] must be an object`);
        continue;
      }
      if (!isSafeComponent(angle.name)) {
        errors.push(`config.angles[${index}].name must be a nonempty safe name: ${JSON.stringify(angle.name)}`);
      } else if (names.has(angle.name.toLowerCase())) {
        errors.push(`duplicate angle name: ${angle.name}`);
      } else {
        names.add(angle.name.toLowerCase());
      }
      if (typeof angle.radians !== 'number' || !Number.isFinite(angle.radians)) {
        errors.push(`config.angles[${index}].radians must be a finite number`);
      }
    }
  }

  const pose = raw.pose === undefined ? DEFAULT_POSE : raw.pose;
  if (pose !== 'a' && pose !== 'idle') {
    errors.push(`config.pose must be 'a' or 'idle': ${JSON.stringify(raw.pose)}`);
  }

  if (errors.length) throw new Error(`invalid config:\n- ${errors.join('\n- ')}`);

  return {
    items,
    baseOutfit: { ...raw.baseOutfit },
    camera: raw.camera,
    path: raw.path,
    angles: angles.map(angle => ({ name: angle.name, radians: angle.radians })),
    pose,
  };
}

// ---------------------------------------------------------------------------------------------
// Exact assembly validation. Pure: takes harness rigState output, returns a verdict.
// ---------------------------------------------------------------------------------------------

export function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

/** Locate the exact target id, whether the rig classed it as an assembly/skin pair or as other. */
export function findRigItem(state, id) {
  return (state?.assemblies ?? []).find(entry => entry.id === id)
    ?? (state?.other ?? []).find(entry => entry.id === id)
    ?? null;
}

/** Collect the exact source mesh/material set the rig actually assembled for one entry. */
export function collectAssembledSet(entry) {
  const meshes = new Set();
  const materials = new Set();
  const unreconstructed = [];
  const bindingErrors = [];
  let materialCount = 0;
  for (const part of entry?.parts ?? []) {
    if (typeof part.sourceMesh === 'string' && part.sourceMesh.trim()) meshes.add(part.sourceMesh);
    else bindingErrors.push(`part ${part.sourceIndex} has no identified source mesh`);
    if (!part.materials?.length) bindingErrors.push(`part ${part.sourceIndex} has no materials`);
    if (!part.materials?.some(material => material.visible === true)) {
      bindingErrors.push(`part ${part.sourceIndex} has no visible material-bearing mesh`);
    }
    for (const material of part.materials ?? []) {
      materialCount += 1;
      if (typeof material.sourceMaterial === 'string' && material.sourceMaterial.trim()) {
        materials.add(material.sourceMaterial);
      } else bindingErrors.push(`part ${part.sourceIndex} has an unidentified source material`);
      if (material.reconstructed !== true) {
        unreconstructed.push(material.sourceMaterial ?? material.name ?? '(unnamed material)');
      }
    }
  }
  return {
    meshes: uniqueSorted(meshes),
    materials: uniqueSorted(materials),
    unreconstructed: uniqueSorted(unreconstructed),
    bindingErrors,
    materialCount,
  };
}

/**
 * The acceptance-critical structural verdict for one item.
 *
 * `before`: the exact target id must be visible as a legacy item (a visible sourceSkinPair is
 *           fine) and must NOT already be a reconstructed sourceAssembly.
 * `preview`/`active`: the exact target id must be a visible reconstructed sourceAssembly whose
 *           unique source meshes and materials are exactly the expected sets, with every
 *           material flagged reconstructed. An unrelated visible item never counts.
 */
export function validateItemState(state, item, mode) {
  const errors = [];
  const entry = findRigItem(state, item.id);
  if (!entry) {
    return { ok: false, errors: [`target ${JSON.stringify(item.id)} is not present on the rig`], target: null };
  }
  if (!entry.groupVisible) errors.push(`target ${JSON.stringify(item.id)} is hidden by a hidden ancestor`);
  if ((entry.visibleMeshes ?? 0) <= 0) errors.push(`target ${JSON.stringify(item.id)} has no visible meshes`);

  if (mode === 'before') {
    if (entry.sourceAssembly) {
      errors.push(`target ${JSON.stringify(item.id)} is already a reconstructed sourceAssembly in before mode`);
    }
    return { ok: errors.length === 0, errors, target: entry };
  }

  if (mode !== 'preview' && mode !== 'active') {
    errors.push(`unknown validation mode: ${JSON.stringify(mode)}`);
    return { ok: false, errors, target: entry };
  }

  if (!entry.sourceAssembly) {
    errors.push(`target ${JSON.stringify(item.id)} is not a reconstructed sourceAssembly`);
  }

  const actual = collectAssembledSet(entry);
  errors.push(...actual.bindingErrors);
  const expectedMeshes = uniqueSorted(item.meshes ?? []);
  const expectedMaterials = uniqueSorted(item.materials ?? []);
  const missingMeshes = expectedMeshes.filter(mesh => !actual.meshes.includes(mesh));
  const extraMeshes = actual.meshes.filter(mesh => !expectedMeshes.includes(mesh));
  const missingMaterials = expectedMaterials.filter(material => !actual.materials.includes(material));
  const extraMaterials = actual.materials.filter(material => !expectedMaterials.includes(material));

  if (missingMeshes.length) errors.push(`missing source meshes: ${missingMeshes.join(', ')}`);
  if (extraMeshes.length) errors.push(`unexpected source meshes: ${extraMeshes.join(', ')}`);
  if (missingMaterials.length) errors.push(`missing source materials: ${missingMaterials.join(', ')}`);
  if (extraMaterials.length) errors.push(`unexpected source materials: ${extraMaterials.join(', ')}`);
  if (actual.unreconstructed.length) {
    errors.push(`materials not reconstructed: ${actual.unreconstructed.join(', ')}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    target: entry,
    actual,
    expected: { meshes: expectedMeshes, materials: expectedMaterials },
  };
}

// ---------------------------------------------------------------------------------------------
// Browser-driven capture. All harness interaction happens here.
// ---------------------------------------------------------------------------------------------

export function buildSlots(baseOutfit, item) {
  return { ...baseOutfit, [item.slot]: item.id };
}

/** Build the viewer URL from the harness query builder, then move it onto the configured path. */
export function viewUrl(config, slots) {
  const url = new URL(outfitUrl(slots, { cam: config.camera, pose: config.pose }));
  url.pathname = config.path;
  return url.toString();
}

/** Rotate the rig root, flush the matrix and wait two animation frames so the shot is settled. */
export async function rotateRig(page, radians) {
  await page.evaluate(async (yaw) => {
    const root = window.__rigRoot;
    if (!root) throw new Error('window.__rigRoot is not available; cannot rotate the rig');
    root.rotation.y = yaw;
    root.updateMatrixWorld(true);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, radians);
}

export async function runCapture({ config, mode, previewDir, outDir, report, persist }) {
  let browser = null;
  let context = null;
  let record = null;
  const flush = () => {
    report.requests = record ? classify(record) : null;
    persist();
  };
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch(LAUNCH_OPTIONS);
    context = await browser.newContext();
    const page = await context.newPage();
    record = watch(page);
    if (mode === 'preview') await servePreviewIndex(page, previewDir);

    await page.goto(viewUrl(config, buildSlots(config.baseOutfit, config.items[0])), {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await waitIdle(page);

    for (const item of config.items) {
      const entry = {
        id: item.id,
        slot: item.slot,
        status: 'pending',
        acceptance: 'pending',
        checkedAt: null,
        errors: [],
        error: null,
        checks: null,
        state: null,
        views: [],
      };
      report.items.push(entry);
      flush();
      try {
        await swap(page, buildSlots(config.baseOutfit, item));
        await waitIdle(page);
        entry.state = await rigState(page);
        const check = validateItemState(entry.state, item, mode);
        entry.checkedAt = new Date().toISOString();
        entry.checks = {
          ok: check.ok,
          errors: check.errors,
          expected: check.expected ?? null,
          actual: check.actual ?? null,
        };
        if (!check.ok) {
          entry.status = 'failed';
          entry.errors = check.errors;
          flush();
          continue;
        }
        const angles = mode === 'before' ? [FRONT_ANGLE] : config.angles;
        for (const [index, angle] of angles.entries()) {
          await rotateRig(page, angle.radians);
          const file = resolveUnder(outDir, 'views', item.id, `${String(index).padStart(2, '0')}-${angle.name}.png`);
          await shoot(page, file);
          entry.views.push({
            angle: { name: angle.name, radians: angle.radians },
            image: path.relative(outDir, file),
            sha256: sha256File(file),
            bytes: fs.statSync(file).size,
            capturedAt: new Date().toISOString(),
            rigState: entry.state,
          });
          flush();
        }
        entry.status = 'passed';
        flush();
      } catch (error) {
        entry.status = 'failed';
        entry.error = serializeError(error);
        entry.errors = [...entry.errors, errorMessage(error)];
        flush();
      }
    }
  } catch (error) {
    report.error = serializeError(error);
  } finally {
    try { if (context) await context.close(); } catch { /* keep closing */ }
    // Close the browser in finally, even when setup or an item assertion failed.
    try { if (browser) await browser.close(); } catch { /* keep closing */ }
    report.requests = record ? classify(record) : null;
    report.finishedAt = new Date().toISOString();
    const allItemsFinished = report.items.length === config.items.length
      && report.items.length > 0
      && report.items.every(item => item.status === 'passed' && item.views.length > 0);
    const cleanRequests = Boolean(report.requests)
      && report.requests.failedRequests.length === 0
      && report.requests.errors.length === 0;
    // Structural pass only; acceptance stays 'pending' for Astra.
    report.passed = Boolean(allItemsFinished && cleanRequests && !report.error);
    flush();
  }
  return report;
}

// ---------------------------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = validateOptions(parseArgs(argv));
  } catch (error) {
    console.error(`${TOOL}: ${errorMessage(error)}`);
    return 2;
  }

  let outDir;
  try {
    outDir = assertFreshOutput(options.output);
  } catch (error) {
    console.error(`${TOOL}: ${errorMessage(error)}`);
    return 2;
  }
  fs.mkdirSync(outDir, { recursive: true });

  const report = {
    tool: TOOL,
    acceptance: 'pending',
    mode: options.mode,
    appUrl: APP_URL,
    configPath: path.resolve(options.config),
    outputDir: outDir,
    previewDir: options.mode === 'preview' ? path.resolve(options.preview) : null,
    configHash: null,
    config: null,
    angles: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    passed: false,
    error: null,
    items: [],
    requests: null,
    limits: LIMITS,
  };
  const reportPath = path.join(outDir, 'report.json');
  const persist = () => {
    report.updatedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  };
  persist();

  let config;
  try {
    const text = fs.readFileSync(report.configPath, 'utf8').replace(/^\uFEFF/, '');
    config = validateConfig(JSON.parse(text));
  } catch (error) {
    report.error = serializeError(error);
    report.finishedAt = new Date().toISOString();
    persist();
    console.error(`${TOOL}: ${errorMessage(error)}`);
    return 2;
  }
  report.config = config;
  report.configHash = configHash(config);
  report.angles = config.angles;
  persist();

  if (options.mode === 'preview') {
    const missing = INDEX_FILES
      .map(name => path.join(report.previewDir, name))
      .filter(file => !fs.existsSync(file));
    if (missing.length) {
      report.error = { name: 'Error', message: `preview index is incomplete: ${missing.join(', ')}`, stack: null };
      report.finishedAt = new Date().toISOString();
      persist();
      console.error(`${TOOL}: ${report.error.message}`);
      return 2;
    }
  } else if (options.preview) {
    console.error(`${TOOL}: --preview is only used in preview mode; ignoring ${options.preview}`);
  }

  await runCapture({ config, mode: options.mode, previewDir: report.previewDir, outDir, report, persist });

  const passedItems = report.items.filter(item => item.status === 'passed').length;
  console.log(`${TOOL}: mode=${report.mode} items=${passedItems}/${config.items.length} passed=${report.passed}`);
  if (report.error) console.error(`${TOOL}: error: ${report.error.message}`);
  return report.passed ? 0 : 1;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = await main();
