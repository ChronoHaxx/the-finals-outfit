// Opt-in activeComponentReuse checks for freeze-multipart-family.mjs (see multipart-family.md); the same
// accept/reject rules as multipart_active_reuse.py. The receipt is re-derived from the current active entry, GLB,
// mask and originating report bytes and today's coverage inputs, then compared with the manifest and the early
// receipt in frozen-baseline.json; a JSON pin is never trusted on its own. Pure functions, no module state.
import fs from 'node:fs';
import nodePath from 'node:path';
import assert from 'node:assert/strict';
import {entrySha, sha, read, fittedTags, FITTED_MODE, INDEX_FILES} from './freeze-family.mjs';

export const FIELD = 'activeComponentReuse';
export const POLICY = 'exact-active-component-v1';
// The explicit opt-in whose origin may have applied other (valid, pinned) fitting tags; POLICY keeps tag equality.
export const TAG_POLICY = 'exact-active-component-tag-delta-v1';
export const POLICIES = [POLICY, TAG_POLICY];
export const PINS = ['entrySha256', 'glbSha256', 'maskSha256', 'originReportSha256'];
export const TAG_PINS = ['originFittingTags', 'appliedFittingTags', 'fittingTagDelta'];
// freeze-family.mjs FITTED_TAG: the shape tags the fitted generator can apply.
const FITTED_TAG = /^Customization\.Shape\.(?:PushInsideClothes|ShrinkWrap|HeadNeckMatch)\.[A-Za-z0-9_]+$/;
// prepare-family.py GENERATOR, HELPER and FITTED_BODY.
export const GENERATOR = 'scripts/shader-probe/build-companion-masks.mjs';
export const HELPER = 'scripts/shader-probe/coverage-projection.mjs';
export const FITTED_BODY = 'models/reconstructed-meshes-v2/SK_Body_M.glb';
const PATH = /^[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*$/, HEX = /^[0-9a-f]{64}$/;
const MASK_KEYS = ['bodyMaskUrl', 'bodyMaskUvTiles', 'coverageSource'];
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const check = (ok, message) => assert(ok, `${FIELD}: ${message}`);
const same = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch { return false; } };
// ASCII-only case folding, as the existing identity safeguards; non-ASCII letters stay distinct.
export const fold = text => text.replace(/[A-Z]/g, c => c.toLowerCase());
const overlaps = (a, b) => { [a, b] = [fold(a), fold(b)]; return a === b || a.startsWith(b + '/') || b.startsWith(a + '/'); };
const stem = source => source.split('.').at(-1);

export function policyOf(receipt) {
  const policy = isObject(receipt) ? receipt.policy : undefined;
  check(POLICIES.includes(policy), `unsupported policy ${JSON.stringify(policy)}; only ${JSON.stringify(POLICIES)}`);
  return policy;
}

// A nonempty list of unique strings that are each a supported fitted shape tag.
export const shapeTags = tags => Array.isArray(tags) && tags.length > 0 && tags.every(t => typeof t === 'string' && FITTED_TAG.test(t))
  && new Set(tags).size === tags.length;

// TAG_POLICY pins: both ordered applied tag lists and the delta (each side in its own list order).
export const tagReceipt = (originTags, applied) => ({originFittingTags: [...originTags], appliedFittingTags: [...applied],
  fittingTagDelta: {removed: originTags.filter(t => !applied.includes(t)), added: applied.filter(t => !originTags.includes(t))}});

export function validateComponentReuse(doc, pinned = true) {
  const value = doc[FIELD];
  check(isObject(value) && same(Object.keys(value).sort(), ['components', 'policy']), "must be an object with exactly ['components', 'policy']");
  const tagged = policyOf(value) === TAG_POLICY;
  check(doc.coverage?.mode === FITTED_MODE, `only ${FITTED_MODE} coverage is compared with an active fitted mask in this slice`);
  const listed = value.components, sources = doc.components.map(c => c.source);
  const applied = doc.fittingTags.filter(t => typeof t === 'string' && FITTED_TAG.test(t));
  check(Array.isArray(listed) && listed.length > 0, 'components must name at least one reused component');
  const keys = ['originReport', 'source', ...(pinned ? PINS : []), ...(pinned && tagged ? TAG_PINS : [])].sort();
  listed.forEach((c, i) => {
    check(isObject(c) && same(Object.keys(c).sort(), keys), `components[${i}] must have exactly ${JSON.stringify(keys)}`);
    check(typeof c.source === 'string' && sources.includes(c.source), `components[${i}].source is not exactly a manifest component`);
    const report = c.originReport;
    check(typeof report === 'string' && PATH.test(report) && !report.split('/').some(p => p === '.' || p === '..')
      && report.startsWith('public/models/') && report.endsWith('/derived-coverage.json'),
      `components[${i}].originReport must be an explicit public/models/.../derived-coverage.json path`);
    check(!['docs', 'work', 'runtime', 'preview'].some(k => overlaps(report, doc.paths[k])), `components[${i}].originReport lies inside this family output folders`);
    if (!pinned) return;
    check(PINS.every(k => typeof c[k] === 'string' && HEX.test(c[k])), `components[${i}] pins must be lowercase sha256 hex`);
    check(c.glbSha256 === doc.components.find(x => x.source === c.source).sha256, `components[${i}].glbSha256 must equal the component sha256`);
    if (tagged) check(shapeTags(c.originFittingTags) && !same(c.originFittingTags, applied)
      && same(Object.fromEntries(TAG_PINS.map(k => [k, c[k]])), tagReceipt(c.originFittingTags, applied)),
      `components[${i}] tag pins must be distinct valid shape tags, today's applied tags and their exact delta`);
  });
  const named = listed.map(c => c.source);
  check(new Set(named.map(fold)).size === named.length, 'components repeat a source (compared ASCII case-insensitively)');
  check(same(named, sources.filter(s => named.includes(s))), 'components must be listed in manifest component order');
  check(named.length < sources.length, 'every component would be reused; at least one component must stay new in this slice');
  return value;
}

export function exactFile(path) {
  let parent = '.';
  for (const part of path.split('/')) {
    check(fs.existsSync(parent) && fs.statSync(parent).isDirectory() && fs.readdirSync(parent).includes(part),
      `${path} is missing or not spelled with its exact on-disk case`);
    parent = parent === '.' ? part : `${parent}/${part}`;
  }
  check(fs.statSync(path).isFile(), `${path} is not a file`);
  return path;
}

// family_active_reuse.resolve: an index-relative URL inside public/.
function indexFile(root, url, label) {
  check(typeof url === 'string' && url && url === url.trim() && !url.startsWith('/') && !/[:\\?#]/.test(url), `the active entry ${label} is not an index-relative URL`);
  const path = nodePath.posix.normalize(nodePath.posix.join(root, url));
  check(path.startsWith('public/'), `the active entry ${label} resolves outside public/: ${path}`);
  return exactFile(path);
}

export function componentPin(assets, root, source) {
  const entry = assets?.meshes?.[source];
  check(isObject(entry) && Object.hasOwn(assets.meshes, source), `${source} has no active assets.json entry to reuse`);
  const variants = Object.keys(assets.meshes).filter(k => fold(k) === fold(source));
  check(same(variants, [source]), `the active index holds case variants of ${source}: ${JSON.stringify(variants)}`);
  check(entry.kind === 'skeletal' && Array.isArray(entry.slots) && entry.slots.length === 1, `the active entry of ${source} must be one skeletal mesh with exactly one slot`);
  check(MASK_KEYS.every(k => entry[k] && !(Array.isArray(entry[k]) && !entry[k].length)) && entry.coverageSource === 'derived-projection',
    `the active entry of ${source} lacks complete derived body coverage`);
  const glb = indexFile(root, entry.url, 'url'), mask = indexFile(root, entry.bodyMaskUrl, 'bodyMaskUrl');
  check(entry.sha256 === sha(glb), `the active entry sha256 of ${source} does not describe its GLB bytes`);
  return {entry, mask, pins: {entrySha256: entrySha(entry), glbSha256: sha(glb), maskSha256: sha(mask)}};
}

function completed(record, source) {
  const poses = Array.isArray(record.poseCounts) ? record.poseCounts : [], covered = record.coveredPixels;
  return record.file === `${stem(source)}.bodymask.png` && record.diagnosticFile === `${stem(source)}.fitted-occlusion-diagnostic.png`
    && same(poses.filter(isObject).map(p => p.pose), ['a', 'idle']) && poses.every(p => 'sharedUvRemovedPixels' in p && p.fittedOcclusion?.fittingMorphs?.length)
    && Number.isInteger(covered) && covered >= 1 && record.restoration?.candidatePixels === covered && HEX.test(String(record.previousPolicy?.sha256));
}

export function currentInputs(cfg) {
  const present = p => fs.existsSync(p) ? sha(p) : null;
  return {appliedFittingTags: fittedTags(cfg.fittingTags), helper: HELPER, helperSha256: present(HELPER), generatorSha256: present(GENERATOR),
    bodyFile: FITTED_BODY, bodySha256: present(`public/${FITTED_BODY}`)};
}

// Returns the report. Under TAG_POLICY only, applied-tag equality becomes: the report's own recorded tags are valid
// shape tags that differ from today's (identical tags belong to POLICY).
export function origin(c, entry, mask, pins, current, reusePolicy = POLICY) {
  const tagged = policyOf({policy: reusePolicy}) === TAG_POLICY;
  const path = exactFile(c.originReport);
  check(sha(path) === pins.originReportSha256, `the originating coverage report of ${c.source} changed since it was pinned`);
  const report = read(path), policy = isObject(report.occlusionPolicy) ? report.occlusionPolicy : {};
  const records = (Array.isArray(report.records) ? report.records : []).filter(r => isObject(r) && r.source === c.source);
  const record = records.length === 1 ? records[0] : {};
  const checks = {
    'one record of the source': records.length === 1,
    'the active mask file': typeof record.file === 'string' && mask === `${nodePath.posix.dirname(path)}/${record.file}`,
    'mesh/mask/uvTiles': same([record.meshSha256, record.sha256, record.uvTiles], [pins.glbSha256, pins.maskSha256, entry.bodyMaskUvTiles]),
    'source geometry fitted shared-UV report': same([report.formatVersion, report.geometryMode, report.sharedUvPolicy, policy.name], [1, 'source', 'all-surfaces-covered', 'fitted-occlusion']),
    'derivation settings': isObject(policy.settings) && Object.keys(policy.settings).length > 0,
    ...(tagged ? {'recorded valid unique shape fitting tags': shapeTags(policy.fittingTags) && shapeTags(current.appliedFittingTags),
      [`a fitting tag delta (identical tags use ${POLICY})`]: !same(policy.fittingTags, current.appliedFittingTags)}
      : {'applied fitting tags': same(policy.fittingTags, current.appliedFittingTags)}),
    'helper': same([policy.helper, policy.helperSha256], [current.helper, current.helperSha256]),
    'generator': policy.generatorSha256 === current.generatorSha256,
    'body': same([report.bodyFile, report.bodySha256], [current.bodyFile, current.bodySha256]),
    'completed A/idle fitted record': completed(record, c.source),
  };
  const wrong = Object.keys(checks).filter(k => !checks[k]);
  check(!wrong.length, `the originating report of ${c.source} does not prove its active mask under the current inputs: ${JSON.stringify(wrong)}`);
  return report;
}

export function requireNew(cfg, cohort, assets, pairs, supported) {
  const reused = new Set(cfg[FIELD].components.map(c => c.source)), active = new Map();
  for (const key of Object.keys(assets.meshes ?? {})) active.set(fold(key), [...(active.get(fold(key)) ?? []), key]);
  for (const {source} of cfg.components) {
    const found = active.get(fold(source)) ?? [];
    if (reused.has(source)) check(same(found, [source]), `the declared component ${source} is not exactly one active entry: ${JSON.stringify(found)}`);
    else check(!found.length, `the new component ${source} collides with active ${JSON.stringify(found)}; undeclared active overlap`);
  }
  const materials = [...new Set(cohort.items.flatMap(item => item.materials))].sort();
  check(new Set(materials.map(fold)).size === materials.length, 'cohort materials differ only by case; ambiguous');
  // Only exactly the sources an activeMaterialReuse field declares may be active (multipart-material-reuse.mjs).
  const kept = new Set((cfg.activeMaterialReuse?.materials ?? []).map(m => m?.source)), found = new Map();
  for (const key of Object.keys(assets.materials ?? {})) found.set(fold(key), [...(found.get(fold(key)) ?? []), key]);
  const wrong = materials.filter(m => kept.has(m) && !same(found.get(fold(m)), [m]));
  check(!wrong.length, `declared materials are not exactly one active binding each (ASCII case-insensitive): ${JSON.stringify(wrong)}`);
  const taken = materials.filter(m => !kept.has(m) && found.has(fold(m)));
  check(!taken.length, `active material reuse is out of this slice unless declared in activeMaterialReuse; already active (ASCII case-insensitive): ${JSON.stringify(taken)}`);
  const ids = new Set([...(supported.items ?? []), ...Object.keys(pairs.items ?? {})].map(fold));
  const listed = cohort.items.map(item => item.id).filter(id => ids.has(fold(id)));
  check(!listed.length, `candidates are already advertised or skin-paired: ${JSON.stringify(listed)}`);
}

// The receipt re-derived from today's files; it must equal the manifest field and the early receipt of preflight.
export function assertComponentReuse(cfg, cohort) {
  const p = cfg.paths, docs = INDEX_FILES.map(name => read(`${p.active}/${name}`));
  requireNew(cfg, cohort, ...docs);
  const current = currentInputs(cfg), policy = policyOf(cfg[FIELD]);
  const receipt = {policy, components: cfg[FIELD].components.map(c => {
    const {entry, mask, pins} = componentPin(docs[0], p.active, c.source);
    pins.originReportSha256 = sha(exactFile(c.originReport));
    const report = origin(c, entry, mask, pins, current, policy);
    // TAG_POLICY: the tags come from the pinned report bytes and today's manifest, never from the receipt.
    const tags = policy === TAG_POLICY ? tagReceipt(report.occlusionPolicy.fittingTags, current.appliedFittingTags) : {};
    return {source: c.source, originReport: c.originReport, ...pins, ...tags};
  })};
  check(same(receipt, cfg[FIELD]), 'the receipt re-derived from the current active files and inputs differs from the manifest');
  const saved = read(`${p.docs}/frozen-baseline.json`);
  check(same(saved[FIELD], cfg[FIELD]), 'frozen-baseline.json does not hold exactly the manifest early receipt');
  return {receipt, entries: Object.fromEntries(receipt.components.map(c => [c.source, docs[0].meshes[c.source]]))};
}
