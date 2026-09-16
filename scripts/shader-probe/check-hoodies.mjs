// Independent checks of the Hoodies additive preview; reads only, writes one report.
// node scripts/shader-probe/check-hoodies.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const DOCS = '_docs/hoodies-2026-09-13', WORK = 'scripts/generated/shader-probe/hoodies-v1';
const ACTIVE = 'public/models/reconstructed-assemblies-v1', PREVIEW = 'public/models/reconstructed-hoodies-preview-v1';
const RUNTIME = 'public/models/reconstructed-hoodies-v1';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const failures = [], report = {};
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };
const URL_KEYS = new Set(['url', 'bodyMaskUrl', 'bodyUrl']);
const resolveUrls = (value, folder, key) => {
  if (typeof value === 'string') return URL_KEYS.has(key) ? path.resolve(folder, value) : value;
  if (Array.isArray(value)) return value.map(v => resolveUrls(v, folder));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveUrls(v, folder, k)]));
  return value;
};
const resolveAssets = (doc, folder) => ({ ...resolveUrls(doc, folder),
  materials: Object.fromEntries(Object.entries(doc.materials).map(([k, v]) => [k, path.resolve(folder, v)])),
  ...(doc.materialVariants ? { materialVariants: Object.fromEntries(Object.entries(doc.materialVariants).map(([k, v]) => [k, path.resolve(folder, v)])) } : {}) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. Frozen active/product files, and the frozen source definitions.
const frozen = read(`${DOCS}/frozen-baseline.json`);
report.frozenBaseline = Object.entries(frozen.hashes).map(([file, digest]) => ({ file, unchanged: check(sha(file) === digest, `Protected file changed: ${file}`) }));
const cohort = read(`${DOCS}/resolved-cohort.json`), preview = read(`${PREVIEW}/preview.json`);
for (const item of cohort.items) check(sha(`public/models/reconstructed-assembly-v2/items/${item.id}.json`) === item.definitionFileSha256, `Definition changed since freeze: ${item.id}`);

// 2. Mesh: the reused staged conversion, byte-identical in work and runtime, attributes verified against the DTO.
const meshReport = read(`${DOCS}/opus-mesh-report.json`);
const staged = read('scripts/generated/shader-probe/season11-staging-20260912/reports/glb-01.json').find(r => r.meshJson === meshReport.meshJson);
check(staged && staged.sha256 === meshReport.sha256 && staged.sourceDtoSha256 === meshReport.sourceDtoSha256, 'Mesh report differs from the staging record');
check(sha(meshReport.reusedFrom.glb) === meshReport.sha256 && sha(meshReport.meshJson) === meshReport.sourceDtoSha256, 'Staged DTO/GLB bytes changed');
check(sha(`${RUNTIME}/meshes/${meshReport.file}`) === meshReport.sha256, 'Runtime mesh differs from the staged conversion');
const verification = read(`${WORK}/mesh-verification.json`);
check(verification.passed && verification.sha256 === meshReport.sha256 && verification.morphs === 3 && verification.vertices === 4182, 'Mesh verification does not cover the runtime GLB');
report.mesh = { file: meshReport.file, sha256: meshReport.sha256, dtoSha256: meshReport.sourceDtoSha256, packageSha256: meshReport.sourcePackageSha256,
  vertices: meshReport.vertices, triangles: meshReport.triangles, uvSets: meshReport.uvSets, bones: meshReport.bones, maxInfluences: meshReport.maxInfluences,
  morphs: meshReport.morphs, sections: meshReport.sections, slots: cohort.sourceSlots };

// 3. Additive assets index.
const implemented = preview.implemented, deferred = cohort.items.map(i => i.id).filter(id => !implemented.includes(id));
const active = Object.fromEntries(['assets.json', 'skin-pairs.json', 'supported-items.json'].map(f => [f, read(`${ACTIVE}/${f}`)]));
const next = Object.fromEntries(['assets.json', 'skin-pairs.json', 'supported-items.json'].map(f => [f, read(`${PREVIEW}/${f}`)]));
const a = resolveAssets(active['assets.json'], ACTIVE), b = resolveAssets(next['assets.json'], PREVIEW);
for (const field of ['meshes', 'materials', 'materialVariants']) {
  for (const [key, value] of Object.entries(a[field] ?? {})) check(same(value, b[field]?.[key]), `Baseline ${field} binding changed: ${key}`);
}
for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!['meshes', 'materials', 'materialVariants'].includes(key)) check(same(a[key], b[key]), `Baseline assets field changed: ${key}`);
check(same(Object.keys(b.materialVariants ?? {}), Object.keys(a.materialVariants ?? {})), 'Material variants added or removed');
const addedMeshes = Object.keys(b.meshes).filter(k => !(k in a.meshes)), addedMaterials = Object.keys(b.materials).filter(k => !(k in a.materials));
const expectedMaterials = [...new Set(cohort.items.filter(i => implemented.includes(i.id)).flatMap(i => i.materials))].sort();
check(same(addedMeshes, cohort.meshes), 'Added meshes are not exactly the hoodie mesh');
check(same([...addedMaterials].sort(), expectedMaterials), 'Added materials are not exactly the implemented choices\' materials');
check(Object.values(next['assets.json'].materials).every(v => typeof v === 'string'), 'assets.materials values must be URL strings');
const mesh = next['assets.json'].meshes[cohort.meshes[0]];
check(sha(path.resolve(PREVIEW, mesh.url)) === mesh.sha256 && mesh.sha256 === meshReport.sha256, 'Mesh binding hash differs from its file');
check(same(mesh.slots, cohort.sourceSlots), 'Mesh binding slots differ from the source DTO');
report.assets = { addedMeshes, addedMaterials: addedMaterials.length, mesh: { url: mesh.url, sha256: mesh.sha256, kind: mesh.kind, bodyMaskUrl: mesh.bodyMaskUrl, bodyMaskUvTiles: mesh.bodyMaskUvTiles } };
check(same(resolveUrls(active['skin-pairs.json'], ACTIVE), resolveUrls(next['skin-pairs.json'], PREVIEW)), 'Skin pairs changed');

// 4. Supported items and resolver delta.
const sa = active['supported-items.json'], sb = next['supported-items.json'];
check(same(sb.items, [...sa.items, ...implemented]), 'Advertised items are not baseline plus implemented');
const readyA = new Map(sa.ready.map(r => [r.id, r])), readyB = new Map(sb.ready.map(r => [r.id, r]));
for (const [id, row] of readyA) check(same(resolveUrls(row, ACTIVE), resolveUrls(readyB.get(id), PREVIEW)), `Baseline ready entry changed: ${id}`);
check(same([...readyB.keys()].filter(id => !readyA.has(id)), implemented), 'New ready entries are not exactly implemented');
check(same(sa.exceptions.filter(e => !implemented.includes(e.id)), sb.exceptions), 'Exceptions changed beyond implemented');
const before = new Set(read(`${WORK}/resolver/before.json`).ready.map(r => r.id)), after = new Set(read(`${WORK}/resolver/after.json`).ready.map(r => r.id));
const gained = [...after].filter(id => !before.has(id)), lost = [...before].filter(id => !after.has(id));
check(same(gained.sort(), [...implemented].sort()) && !lost.length, 'Resolver delta is not exactly the implemented IDs');
const unadvertised = [...after].filter(id => !sb.items.includes(id));
check(same(unadvertised, ['medieval-knightpantsnoskirt-cotton-ultimate']), 'Unadvertised structurally ready set changed');
check(!deferred.some(id => after.has(id) || sb.items.includes(id)), 'A deferred choice became ready or advertised');
for (const id of implemented) {
  const row = readyB.get(id), item = cohort.items.find(i => i.id === id);
  check(row.parts.length === 1 && row.parts[0].sourceMesh === cohort.meshes[0], `Unexpected parts: ${id}`);
  check(same(Object.keys(row.parts[0].materials), ['Hoodie']) && same(Object.values(row.parts[0].materials).map(m => m.source), item.materials), `Unexpected material binding: ${id}`);
  check(!!row.parts[0].bodyMaskUrl, `No body coverage: ${id}`);
}
report.supported = { before: sa.items.length, after: sb.items.length, structuralBefore: before.size, structuralAfter: after.size, gained: gained.length, lost, unadvertised };

// 5. Every referenced file exists.
const urls = new Set();
const collect = (value, key) => {
  if (typeof value === 'string') { if (URL_KEYS.has(key)) urls.add(value); return; }
  if (Array.isArray(value)) value.forEach(v => collect(v)); else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => collect(v, k));
};
collect(next['assets.json']); collect(next['skin-pairs.json']); collect(sb);
Object.values(next['assets.json'].materials).forEach(u => urls.add(u)); Object.values(next['assets.json'].materialVariants ?? {}).forEach(u => urls.add(u));
const missing = [...urls].filter(u => !fs.statSync(path.resolve(PREVIEW, u), { throwIfNoEntry: false })?.isFile());
check(!missing.length, `Missing referenced files: ${missing.slice(0, 5)}`);
for (const key of addedMaterials) {
  const file = path.resolve(PREVIEW, next['assets.json'].materials[key]), manifest = read(file), folder = path.dirname(file);
  check(key.endsWith('.' + manifest.sourceInstance) && manifest.sourceRoot === 'M_Character_8Layers_Master', `Material manifest instance/root differs: ${key}`);
  for (const name of [manifest.shader, ...manifest.textures.map(t => t.file)]) check(fs.existsSync(path.join(folder, name)), `Missing material payload ${name}`);
}
report.references = { urls: urls.size, missing: missing.length };

// 6. CPU/GPU parity for exactly the staged materials, and the surface contract they share.
const cpu = read(`${WORK}/validation-implemented/translation-checks.json`), gpu = read(`${WORK}/validation-implemented/webgl-checks.json`);
const gpuRun = read(`${WORK}/validation/webgl-run.json`);
check(sha(`${WORK}/validation/webgl-checks.json`) === gpuRun.checksSha256 && sha(`${WORK}/validation/translation-fixtures.json`) === gpuRun.fixturesSha256, 'GPU run does not belong to current fixtures');
check(cpu.length === implemented.length, 'CPU checks do not cover exactly the implemented materials');
for (const row of cpu) { const g = gpu.find(x => x.itemId === row.itemId); check(g && !g.error && g.cases === row.cases && row.cases > 0, `CPU/GPU mismatch ${row.itemId}`); }
const audit = read(`${WORK}/surface-audit.json`);
for (const row of audit) {
  check(!row.blockers.length && row.root === 'M_Character_8Layers_Master' && row.discards === 1 && !row.discardSurfaceTextures.length && row.clipTail
    && !(row.liveEmissiveFields ?? []).length, `Surface contract not the audited opaque 8Layers form: ${row.instance}`);
}
report.shaders = { materials: cpu.length, cpuCases: cpu.reduce((s, r) => s + r.cases, 0), gpuCases: gpu.reduce((s, r) => s + r.cases, 0),
  maxGpuError: Math.max(...gpu.map(r => r.maxAbsoluteError)), gpuRun: gpuRun.result, gpuResult: gpuRun.exitCode,
  surface: { owners: [...new Set(audit.map(r => r.owner))], blendModes: [...new Set(audit.map(r => r.blendMode))], shadingModels: [...new Set(audit.map(r => r.shadingModel))],
    discardSurfaceTextures: 0, liveEmissiveFields: 0, clipTails: [...new Set(audit.map(r => JSON.stringify(r.clipTail)))].map(JSON.parse) } };

// 7. Coverage: both poses, tiles, mask pixels, and which body regions it hides (bind pose, dominant bone per vertex).
const derived = read(`${RUNTIME}/coverage/derived-coverage.json`), record = derived.records[0];
check(same(record.poseCounts.map(p => p.pose), ['a', 'idle']) && same(record.uvTiles, [2, 1]) && same(mesh.bodyMaskUvTiles, [2, 1]), 'Coverage poses/tiles unexpected');
check(record.meshSha256 === meshReport.sha256 && sha(`public/${derived.bodyFile}`) === derived.bodySha256 && derived.bodyFile === 'models/reconstructed-meshes-v2/SK_Body_M.glb', 'Coverage does not belong to this mesh and the current Medium body');
check(sha(`${RUNTIME}/coverage/${record.file}`) === record.sha256 && mesh.bodyMaskUrl?.endsWith(record.file), 'Mask bytes/binding differ from the coverage record');
const glb = file => {
  const raw = fs.readFileSync(file), length = raw.readUInt32LE(12), g = JSON.parse(raw.subarray(20, 20 + length)), bin = 28 + length;
  const accessor = i => { const x = g.accessors[i], v = g.bufferViews[x.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[x.type];
    const T = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[x.componentType], start = raw.byteOffset + bin + (v.byteOffset ?? 0) + (x.byteOffset ?? 0);
    return new T(raw.buffer.slice(start, start + x.count * n * T.BYTES_PER_ELEMENT)); };
  const attrs = g.meshes[0].primitives[0].attributes, names = g.skins[0].joints.map(j => g.nodes[j].name);
  const sets = [0, 1].filter(i => `JOINTS_${i}` in attrs).map(i => [accessor(attrs[`JOINTS_${i}`]), accessor(attrs[`WEIGHTS_${i}`])]);
  const position = accessor(attrs.POSITION), count = position.length / 3, bone = [];
  for (let v = 0; v < count; v++) { let best = 0, weight = -1; for (const [J, W] of sets) for (let k = 0; k < 4; k++) if (W[v * 4 + k] > weight) { weight = W[v * 4 + k]; best = J[v * 4 + k]; } bone.push(names[best]); }
  return { position, bone, uv: 'TEXCOORD_0' in attrs ? accessor(attrs.TEXCOORD_0) : null };
};
const region = name => /^(hand|index|ring|pinky|middle|thumb)_/.test(name) ? 'hand' : name === 'head' ? 'head' : /^neck/.test(name) ? 'neck'
  : /^(spine|chest|clavicle|pelvis|root)/.test(name) ? 'torso' : /^(upperarm|elbow)/.test(name) ? 'upperArm' : /^lowerarm/.test(name) ? 'forearm' : /^(thigh|calf|foot|ball|knee)/.test(name) ? 'leg' : 'other';
const body = glb(`public/${derived.bodyFile}`), hoodie = glb(`${RUNTIME}/meshes/${meshReport.file}`);
const { data, info } = await sharp(`${RUNTIME}/coverage/${record.file}`).raw().toBuffer({ resolveWithObject: true });
let on = 0; const tiles = [0, 0];
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * info.channels]) { on++; tiles[x < info.height ? 0 : 1]++; }
check(on === record.coveredPixels, 'Mask pixel count differs from its record');
const hoodieBones = new Set(hoodie.bone), regions = {}, coveredBones = {};
let hoodieMin = Infinity, lowestCovered = Infinity;
for (let v = 0; v < hoodie.bone.length; v++) hoodieMin = Math.min(hoodieMin, hoodie.position[v * 3 + 1]);
for (let v = 0; v < body.bone.length; v++) {
  const x = Math.floor(body.uv[v * 2] * info.height), y = Math.floor(body.uv[v * 2 + 1] * info.height);
  const covered = x >= 0 && x < info.width && y >= 0 && y < info.height && data[(y * info.width + x) * info.channels] > 0;
  const r = (regions[region(body.bone[v])] ??= { vertices: 0, covered: 0 }); r.vertices++;
  if (covered) { r.covered++; coveredBones[body.bone[v]] = (coveredBones[body.bone[v]] ?? 0) + 1; lowestCovered = Math.min(lowestCovered, body.position[v * 3 + 1]); }
}
const outside = Object.keys(coveredBones).filter(name => !hoodieBones.has(name));
check(!regions.hand?.covered, 'Coverage hides hand/wrist body vertices');
check(!regions.head?.covered && !regions.leg?.covered, 'Coverage hides head or leg body vertices');
check(!outside.length, `Coverage hides body vertices driven by bones the hoodie has no geometry for: ${outside}`);
check(lowestCovered >= hoodieMin - 0.04, 'Coverage extends below the hoodie hem beyond the 4 cm projection tolerance');
report.coverage = { file: record.file, sha256: record.sha256, poseCounts: record.poseCounts, coveredTriangles: record.coveredTriangles, pixels: on, pixelsByTile: tiles,
  bodyFile: derived.bodyFile, bodySha256: derived.bodySha256, bindPoseRegions: regions, coveredBodyVerticesByBone: coveredBones,
  hoodieHemHeightM: hoodieMin, lowestCoveredBodyVertexHeightM: lowestCovered, forearmBonesCovered: Object.keys(coveredBones).filter(n => n.startsWith('lowerarm')).sort() };

// 8. Dispositions: implemented, surface-audit blockers, build errors, or the translator's root rejection with its diagnosis.
const errors = read(`${RUNTIME}/staging/build-errors.json`), resolution = read(`${WORK}/source/material-resolution.json`);
const diagnosis = Object.fromEntries(read(`${WORK}/unsupported-roots.json`).map(r => [r.instance, r]));
report.dispositions = cohort.items.map(i => {
  const instance = i.materials[0].split('.').pop(), resolved = resolution.find(r => r.instance === instance), row = audit.find(r => r.instance === instance);
  const blockers = [...new Set([...(resolved.error ? [resolved.error] : []), ...(row?.blockers ?? []), ...errors.filter(e => e.instance === instance).map(e => e.error)])];
  const diag = diagnosis[instance];
  return { id: i.id, status: implemented.includes(i.id) ? 'implemented' : 'deferred', material: i.materials[0], root: resolved.root ?? diag?.root,
    chain: (resolved.chain ?? []).map(c => c.object.split('.').pop()).concat(resolved.chain ? [] : diag?.chain ?? []), blockers,
    ...(diag ? { liveContract: { viewRegistersBeyondAccepted8Layers: diag.viewRegistersBeyondAccepted8Layers,
      liveRootParameters: diag.liveRootParameters.map(f => `${f.expression}=${JSON.stringify(Object.values(f.parameters))}`), diagnosticSlice: diag.diagnosticOnly.slice } } : {}) };
});
check(report.dispositions.filter(d => d.status === 'deferred').every(d => d.blockers.length), 'A deferred choice lacks a blocker');
check(report.dispositions.filter(d => d.status === 'implemented').every(d => !d.blockers.length), 'An implemented choice has a blocker');
report.counts = { cohort: cohort.items.length, implemented: implemented.length, deferred: deferred.length };
report.failures = failures;
fs.writeFileSync(`${DOCS}/opus-check.json`, JSON.stringify({ at: new Date().toISOString(), passed: !failures.length, ...report }, null, 2) + '\n');
console.log(JSON.stringify({ passed: !failures.length, failures, counts: report.counts, supported: report.supported, references: report.references,
  shaders: { ...report.shaders, surface: undefined }, coverage: { pixels: on, regions, lowestCovered, hoodieMin, outside } }, null, 1));
process.exitCode = failures.length ? 1 : 0;
