// Opt-in activeMaterialReuse checks for freeze-multipart-family.mjs (see multipart-family.md); the same accept/reject
// rules and canonical pins as multipart_material_reuse.py. The receipt is re-derived from the current active binding,
// manifest, shader and texture bytes, then compared with the manifest and the early receipt in frozen-baseline.json;
// a JSON pin is never trusted on its own. Pure functions, no module state.
import fs from 'node:fs';
import crypto from 'node:crypto';
import nodePath from 'node:path';
import assert from 'node:assert/strict';
import {entrySha, sha, read} from './freeze-family.mjs';
import {FIELD as COMPONENTS, exactFile, fold} from './multipart-active-reuse.mjs';

export const FIELD = 'activeMaterialReuse';
export const POLICY = 'exact-active-material-v1';
export const PINS = ['entrySha256', 'manifestSha256', 'canonicalSha256', 'files'];
const MATERIAL = /^\/Game\/(?:[A-Za-z0-9_-]+\/)+([A-Za-z0-9_-]+)\.\1$/, NAME = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/, HEX = /^[0-9a-f]{64}$/;
const FORMAT = 1, SHADER = '.glsl', TEXTURE = '.rgba.gz.bin';
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const check = (ok, message) => assert(ok, `${FIELD}: ${message}`);
const same = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch { return false; } };

export function validateMaterialReuse(doc, pinned = true) {
  check(COMPONENTS in doc, `only an ${COMPONENTS} family (a proper subset of reused components) may reuse active materials`);
  const value = doc[FIELD];
  check(isObject(value) && same(Object.keys(value).sort(), ['materials', 'policy']), "must be an object with exactly ['materials', 'policy']");
  check(value.policy === POLICY, `unsupported policy ${JSON.stringify(value.policy)}; only ${POLICY}`);
  const listed = value.materials, keys = ['source', ...(pinned ? PINS : [])].sort();
  check(Array.isArray(listed) && listed.length > 0, 'materials must name at least one reused material');
  listed.forEach((m, i) => {
    check(isObject(m) && same(Object.keys(m).sort(), keys), `materials[${i}] must have exactly ${JSON.stringify(keys)}`);
    check(typeof m.source === 'string' && MATERIAL.test(m.source), `materials[${i}].source is not a material object path`);
    if (!pinned) return;
    check(PINS.slice(0, 3).every(k => typeof m[k] === 'string' && HEX.test(m[k])), `materials[${i}] pins must be lowercase sha256 hex`);
    check(isObject(m.files) && Object.keys(m.files).length > 0 && Object.entries(m.files).every(([k, h]) => NAME.test(k) && typeof h === 'string' && HEX.test(h)),
      `materials[${i}].files must map plain bundle file names to sha256 hex`);
  });
  const named = listed.map(m => m.source);
  check(new Set(named.map(fold)).size === named.length && same(named, [...named].sort()), 'materials must be unique (ASCII case-insensitively) and sorted');
  return value;
}

export function bundle(path) {
  exactFile(path);
  const data = fs.readFileSync(path);
  let manifest;
  try { manifest = JSON.parse(data.toString('utf8')); } catch { check(false, `${path} is not a JSON material manifest`); }
  const textures = isObject(manifest) ? manifest.textures : null;
  check(path.endsWith('.json') && manifest.formatVersion === FORMAT && Array.isArray(textures) && textures.every(isObject),
    `${path} is not a formatVersion ${FORMAT} material manifest; unknown formats are never reused`);
  const refs = [manifest.shader, ...textures.map(t => t.file)];
  check(refs.every(n => typeof n === 'string' && NAME.test(n)) && refs[0].endsWith(SHADER) && refs.slice(1).every(n => n.endsWith(TEXTURE)),
    `${path} references a file outside its bundle folder or of an unknown format`);
  const dir = nodePath.posix.dirname(path), names = [...new Set([nodePath.posix.basename(path), ...refs])].sort();
  check(new Set(names.map(fold)).size === names.length, `${path} references files that differ only by case; ambiguous`);
  const files = Object.fromEntries(names.map(n => [n, sha(exactFile(`${dir}/${n}`))]));
  return {manifest, pins: {manifestSha256: crypto.createHash('sha256').update(data).digest('hex'), canonicalSha256: entrySha(manifest), files}};
}

// family_active_reuse.resolve: an index-relative URL inside public/.
function indexFile(root, url) {
  check(typeof url === 'string' && url && url === url.trim() && !url.startsWith('/') && !/[:\\?#]/.test(url), 'the active material url is not an index-relative URL');
  const path = nodePath.posix.normalize(nodePath.posix.join(root, url));
  check(path.startsWith('public/'), `the active material url resolves outside public/: ${path}`);
  return path;
}

export function materialPin(assets, root, source) {
  const materials = assets?.materials, entry = isObject(materials) && Object.hasOwn(materials, source) ? materials[source] : undefined;
  check(typeof entry === 'string', `${source} has no active URL-string binding; only the documented URL-string binding is reusable`);
  const variants = Object.keys(materials).filter(k => fold(k) === fold(source));
  check(same(variants, [source]), `the active index holds case variants of ${source}: ${JSON.stringify(variants)}`);
  return {source, entrySha256: entrySha(entry), ...bundle(indexFile(root, entry)).pins};
}

// The receipt re-derived from today's files; it must equal the manifest field and the early receipt of preflight.
export function assertMaterialReuse(cfg, cohort) {
  const value = validateMaterialReuse(cfg), named = value.materials.map(m => m.source), materials = new Set(cohort.materials);
  check(named.every(m => materials.has(m)), 'declared materials are not cohort materials');
  check(materials.size > named.length, 'every material would be reused; at least one material must stay new in this slice');
  const assets = read(`${cfg.paths.active}/assets.json`);
  const receipt = {policy: POLICY, materials: named.map(source => materialPin(assets, cfg.paths.active, source))};
  check(same(receipt, value), 'the receipt re-derived from the current active bindings and bundle bytes differs from the manifest');
  check(same(read(`${cfg.paths.docs}/frozen-baseline.json`)[FIELD], value), 'frozen-baseline.json does not hold exactly the manifest early material receipt');
  return {receipt, kept: new Set(named)};
}
