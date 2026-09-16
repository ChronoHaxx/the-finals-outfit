// Independent checks of the Flag Shirt + Worn Cape additive preview (two skeletal parts per choice).
// Reads only; writes _docs/flag-shirts-2026-09-13/opus-check.json.   node scripts/shader-probe/check-flag-shirts.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const DOCS = '_docs/flag-shirts-2026-09-13', WORK = 'scripts/generated/shader-probe/flag-shirts-v1';
const ACTIVE = 'public/models/reconstructed-assemblies-v1', PREVIEW = 'public/models/reconstructed-flag-shirts-preview-v1';
const RUNTIME = 'public/models/reconstructed-flag-shirts-v1', EXPORTS = `${WORK}/source/working-01`;
const SHIRT = '/Game/Discovery/Characters/StarterSet/Assets/Shirt/SK_Shirt_M.SK_Shirt_M';
const CAPE = '/Game/Discovery/Characters/Samurai/Assets/WornCape/SK_Samurai_WornCape_M.SK_Samurai_WornCape_M';
const PARTS = [SHIRT, CAPE], short = k => k.split('.').pop();
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const failures = [], report = {};
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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

// 1. Protected files and frozen definitions.
const frozen = read(`${DOCS}/frozen-baseline.json`);
report.frozenBaseline = Object.entries(frozen.hashes).filter(([file, digest]) => !check(sha(file) === digest, `Protected file changed: ${file}`)).length;
const cohort = read(`${DOCS}/resolved-cohort.json`), preview = read(`${PREVIEW}/preview.json`);
check(cohort.items.length === 43, 'Cohort is not 43 choices');
for (const item of cohort.items) check(sha(`public/models/reconstructed-assembly-v2/items/${item.id}.json`) === item.definitionFileSha256, `Definition changed since freeze: ${item.id}`);

// 2. Both meshes: fresh conversions, byte-identical in work and runtime, attributes verified, original UV sets from the DTO.
const meshReport = read(`${DOCS}/opus-mesh-report.json`);
check(same(meshReport.meshes.map(m => m.object), PARTS), 'Mesh report is not Shirt then WornCape');
const verification = read(`${WORK}/mesh-verification.json`);
report.meshes = meshReport.meshes.map((m, i) => {
  const dto = read(m.meshJson), lod = dto.lods[0];
  check(sha(m.glb) === m.sha256 && sha(`${RUNTIME}/meshes/${m.file}`) === m.sha256 && sha(m.meshJson) === m.sourceDtoSha256, `Mesh bytes differ: ${m.file}`);
  check(verification[i]?.passed && verification[i].sha256 === m.sha256, `Mesh verification does not cover ${m.file}`);
  check(m.originalUvSets === lod.uvs.length && m.uvSets === lod.uvs.length, `UV set count differs from the DTO: ${m.file}`);
  check(same(m.slots, dto.sourceMaterials.map((n, j) => ({ slot: n.MaterialSlotName, material: dto.materials[j].path }))), `Slots differ from the DTO: ${m.file}`);
  return { file: m.file, sha256: m.sha256, packageSha256: m.sourcePackageSha256, vertices: lod.positions.length, triangles: lod.indices.length / 3,
    uvSets: lod.uvs.length, colourSets: (lod.colours ?? []).length, bones: dto.bones.length, morphs: lod.morphs.map(x => x.name),
    sections: lod.sections.map(s => ({ material: s.MaterialIndex, faces: s.NumFaces })), slots: m.slots.map(s => s.slot) };
});
check(meshReport.buildIdentityMatchesDefinitions === true, 'Mesh export build differs from the definitions');

// 3. Additive assets index.
const implemented = preview.implemented, deferred = cohort.items.map(i => i.id).filter(id => !implemented.includes(id));
const files = ['assets.json', 'skin-pairs.json', 'supported-items.json'];
const active = Object.fromEntries(files.map(f => [f, read(`${ACTIVE}/${f}`)])), next = Object.fromEntries(files.map(f => [f, read(`${PREVIEW}/${f}`)]));
const a = resolveAssets(active['assets.json'], ACTIVE), b = resolveAssets(next['assets.json'], PREVIEW);
for (const field of ['meshes', 'materials', 'materialVariants'])
  for (const [key, value] of Object.entries(a[field] ?? {})) check(same(value, b[field]?.[key]), `Baseline ${field} binding changed: ${key}`);
for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!['meshes', 'materials', 'materialVariants'].includes(key)) check(same(a[key], b[key]), `Baseline assets field changed: ${key}`);
check(same(Object.keys(b.materialVariants ?? {}), Object.keys(a.materialVariants ?? {})), 'Material variants added or removed');
const addedMeshes = Object.keys(b.meshes).filter(k => !(k in a.meshes)).sort(), addedMaterials = Object.keys(b.materials).filter(k => !(k in a.materials)).sort();
const expectedMaterials = [...new Set(cohort.items.filter(i => implemented.includes(i.id)).flatMap(i => i.materials))].sort();
check(same(addedMeshes, [...PARTS].sort()), 'Added meshes are not exactly the shirt and cape');
check(same(addedMaterials, expectedMaterials), 'Added materials are not exactly the implemented choices\' materials');
check(Object.values(next['assets.json'].materials).every(v => typeof v === 'string'), 'assets.materials values must be URL strings');
const derived = read(`${RUNTIME}/coverage/derived-coverage.json`);
for (const [i, key] of PARTS.entries()) {
  const mesh = next['assets.json'].meshes[key], record = derived.records.find(r => r.source === key);
  check(sha(path.resolve(PREVIEW, mesh.url)) === mesh.sha256 && mesh.sha256 === meshReport.meshes[i].sha256 && mesh.kind === 'skeletal', `Mesh binding differs: ${short(key)}`);
  check(same(mesh.slots, meshReport.meshes[i].slots), `Mesh binding slots differ from the DTO: ${short(key)}`);
  check(!!record && mesh.coverageSource === 'derived-projection' && path.resolve(PREVIEW, mesh.bodyMaskUrl) === path.resolve(RUNTIME, 'coverage', record.file)
    && same(mesh.bodyMaskUvTiles, record.uvTiles), `Mask is not this mesh's own derived record: ${short(key)}`);
}
check(same(resolveUrls(active['skin-pairs.json'], ACTIVE), resolveUrls(next['skin-pairs.json'], PREVIEW)), 'Skin pairs changed');
report.assets = { addedMeshes: addedMeshes.map(short), addedMaterials: addedMaterials.length };

// 4. Supported items and resolver delta.
const sa = active['supported-items.json'], sb = next['supported-items.json'];
check(same(sb.items, [...sa.items, ...implemented]), 'Advertised items are not baseline plus implemented');
const readyA = new Map(sa.ready.map(r => [r.id, r])), readyB = new Map(sb.ready.map(r => [r.id, r]));
for (const [id, row] of readyA) check(same(resolveUrls(row, ACTIVE), resolveUrls(readyB.get(id), PREVIEW)), `Baseline ready entry changed: ${id}`);
check(same([...readyB.keys()].filter(id => !readyA.has(id)), implemented), 'New ready entries are not exactly implemented');
check(same(sa.exceptions.filter(e => !implemented.includes(e.id)), sb.exceptions), 'Exceptions changed beyond implemented');
const before = new Set(read(`${WORK}/resolver/before.json`).ready.map(r => r.id)), after = new Set(read(`${WORK}/resolver/after.json`).ready.map(r => r.id));
const gained = [...after].filter(id => !before.has(id)).sort(), lost = [...before].filter(id => !after.has(id));
check(same(gained, [...implemented].sort()) && !lost.length, 'Resolver delta is not exactly the implemented IDs');
const unadvertised = [...after].filter(id => !sb.items.includes(id));
check(same(unadvertised, ['medieval-knightpantsnoskirt-cotton-ultimate']), 'Unadvertised structurally ready set changed');
check(sa.items.length === 349 && !deferred.some(id => after.has(id) || sb.items.includes(id)), 'Baseline count or deferred readiness differs');
for (const id of implemented) {
  const row = readyB.get(id), item = cohort.items.find(i => i.id === id);
  check(same(row.parts.map(p => [p.sourceIndex, p.sourceMesh]), [[0, SHIRT], [1, CAPE]]), `Parts are not Shirt[0] and WornCape[1]: ${id}`);
  check(same(row.parts.map(p => Object.fromEntries(Object.entries(p.materials).map(([k, v]) => [k, v.source]))),
    item.effectiveParts.map(p => Object.fromEntries(p.slots.map(s => [s.slot, s.material])))), `Slot bindings differ from the frozen resolution: ${id}`);
  check(row.parts.every((p, i) => path.resolve(PREVIEW, p.bodyMaskUrl) === path.resolve(PREVIEW, next['assets.json'].meshes[PARTS[i]].bodyMaskUrl)), `Part mask is not its own mesh's mask: ${id}`);
}
report.supported = { before: sa.items.length, after: sb.items.length, structuralBefore: before.size, structuralAfter: after.size, gained: gained.length, lost, unadvertised };

// 5. Every referenced file and payload exists; manifests are this root; twoSided equals the exported chain.
const urls = new Set();
const collect = (value, key) => {
  if (typeof value === 'string') { if (URL_KEYS.has(key)) urls.add(value); return; }
  if (Array.isArray(value)) value.forEach(v => collect(v)); else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => collect(v, k));
};
collect(next['assets.json']); collect(next['skin-pairs.json']); collect(sb);
Object.values(next['assets.json'].materials).forEach(u => urls.add(u)); Object.values(next['assets.json'].materialVariants ?? {}).forEach(u => urls.add(u));
const missing = [...urls].filter(u => !fs.statSync(path.resolve(PREVIEW, u), { throwIfNoEntry: false })?.isFile());
check(!missing.length, `Missing referenced files: ${missing.slice(0, 5)}`);
const resolution = new Map(read(`${WORK}/source/material-resolution.json`).map(r => [r.source, r]));
const exportedTwoSided = row => {
  let value = false;
  for (const [i, link] of row.chain.entries()) {
    const name = short(link.object), entry = read(`${EXPORTS}/${name}.json`).find(e => e.Name === name), p = entry.Properties ?? {};
    if (i === 0) value = !!p.TwoSided; else if (p.BasePropertyOverrides?.bOverride_TwoSided) value = !!p.BasePropertyOverrides.TwoSided;
  }
  return value;
};
const sides = { true: 0, false: 0 };
for (const key of addedMaterials) {
  const file = path.resolve(PREVIEW, next['assets.json'].materials[key]), manifest = read(file), folder = path.dirname(file), row = resolution.get(key);
  check(key.endsWith('.' + manifest.sourceInstance) && manifest.sourceRoot === 'M_Character_8Layers_Master', `Material manifest instance/root differs: ${key}`);
  for (const name of [manifest.shader, ...manifest.textures.map(t => t.file)]) check(fs.existsSync(path.join(folder, name)), `Missing material payload ${name}`);
  const twoSided = exportedTwoSided(row); sides[twoSided]++;
  check(manifest.twoSided === twoSided, `Manifest twoSided differs from the exported chain: ${key}`);
  check((manifest.requiredUvSets ?? [0, 1]).every(uv => cohort.items.flatMap(i => i.effectiveParts).filter(p => p.slots.some(s => s.material === key))
    .every(p => uv < meshReport.meshes[PARTS.indexOf(p.mesh)].originalUvSets)), `Shader UV requirement exceeds the original bound mesh: ${key}`);
}
check(sides.true === 43 && sides.false === 43, 'Expected 43 TwoSided cape and 43 one-sided shirt materials');
const prerequisite = read(`${DOCS}/astra-integration.json`);
check(prerequisite.passed && prerequisite.policyIdempotent && prerequisite.byteIdenticalFiles === 290
  && Object.entries(prerequisite.stagingHashes).every(([name,digest]) => sha(`${RUNTIME}/staging/${name}`) === digest),
  'Staged outputs differ from the checked shared builder output');
report.references = { urls: urls.size, missing: missing.length, twoSided: sides, builderPrerequisiteEquivalent: prerequisite.passed };

// 6. CPU/GPU parity for exactly the staged materials; surface contract; engine-effect deferrals.
const cpu = read(`${WORK}/validation-implemented/translation-checks.json`), gpu = read(`${WORK}/validation-implemented/webgl-checks.json`);
const gpuRun = read(`${WORK}/validation/webgl-run.json`);
check(sha(`${WORK}/validation/webgl-checks.json`) === gpuRun.checksSha256 && sha(`${WORK}/validation/translation-fixtures.json`) === gpuRun.fixturesSha256 && gpuRun.exitCode === 0, 'GPU run does not belong to current fixtures');
check(cpu.length === addedMaterials.length, 'CPU checks do not cover exactly the staged materials');
for (const row of cpu) { const g = gpu.find(x => x.itemId === row.itemId); check(g && !g.error && g.cases === row.cases && row.cases > 0, `CPU/GPU mismatch ${row.itemId}`); }
const audit = read(`${WORK}/surface-audit.json`);
for (const row of audit)
  check(!row.blockers.length && row.root === 'M_Character_8Layers_Master' && row.blendMode === 'EBlendMode::BLEND_Masked' && row.discards === 1
    && !row.discardSurfaceTextures.length && row.clipTail && !(row.liveEmissiveFields ?? []).length, `Surface contract not the audited 8Layers form: ${row.instance}`);
const live = read(`${WORK}/live-branches.json`).summary;
check(live.viewReadShapes.every(s => s.beyondAccepted.every(r => r === 'cb0[162].w')), 'Unexpected view-buffer read beyond accepted 8Layers programs');
report.shaders = { materials: cpu.length, cpuCases: cpu.reduce((s, r) => s + r.cases, 0), gpuCases: gpu.reduce((s, r) => s + r.cases, 0),
  maxGpuError: Math.max(...gpu.map(r => r.maxAbsoluteError)), gpuRun: gpuRun.result,
  surface: { blend: [...new Set(audit.map(r => r.blendMode))], shading: [...new Set(audit.map(r => r.shadingModel))], clipTails: [...new Set(audit.map(r => JSON.stringify(r.clipTail)))].length },
  deferredEngineEffects: live.engineEffectUniforms.map(([expression]) => expression) };

// 7. Coverage: one record per source mesh, A/idle intersection, current Medium body, regions by dominant body bone.
check(derived.records.length === 2 && same(derived.records.map(r => r.source).sort(), [...PARTS].sort()), 'Coverage is not exactly one record per mesh');
check(derived.bodyFile === 'models/reconstructed-meshes-v2/SK_Body_M.glb' && sha(`public/${derived.bodyFile}`) === derived.bodySha256 && path.resolve(derived.indexFolder) === path.resolve(PREVIEW), 'Coverage body/index differs');
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
const body = glb(`public/${derived.bodyFile}`);
const boundary = read(`${DOCS}/astra-boundary-check.json`);
const masks = {};
report.coverage = { tool: preview.coverage?.tool, records: {} };
for (const [i, key] of PARTS.entries()) {
  const record = derived.records.find(r => r.source === key), garment = glb(`${RUNTIME}/meshes/${meshReport.meshes[i].file}`);
  check(record.sourceIndex === i && same(record.poseCounts.map(p => p.pose), ['a', 'idle']) && same(record.uvTiles, [2, 1]), `Coverage record index/poses/tiles: ${short(key)}`);
  check(record.meshSha256 === meshReport.meshes[i].sha256 && sha(`${RUNTIME}/coverage/${record.file}`) === record.sha256, `Coverage mesh/mask hash: ${short(key)}`);
  const { data, info } = await sharp(`${RUNTIME}/coverage/${record.file}`).raw().toBuffer({ resolveWithObject: true });
  const on = new Uint8Array(info.width * info.height); for (let p = 0; p < on.length; p++) on[p] = data[p * info.channels] > 0 ? 1 : 0;
  masks[key] = on;
  check(on.reduce((s, x) => s + x, 0) === record.coveredPixels, `Mask pixel count differs from its record: ${short(key)}`);
  const garmentBones = new Set(garment.bone), regions = {}, coveredBones = {}, outsideVertices = [];
  let garmentMin = Infinity, lowestCovered = Infinity;
  for (let v = 0; v < garment.bone.length; v++) garmentMin = Math.min(garmentMin, garment.position[v * 3 + 1]);
  for (let v = 0; v < body.bone.length; v++) {
    const x = Math.floor(body.uv[v * 2] * info.height), y = Math.floor(body.uv[v * 2 + 1] * info.height);
    const covered = x >= 0 && x < info.width && y >= 0 && y < info.height && on[y * info.width + x] > 0;
    const r = (regions[region(body.bone[v])] ??= { vertices: 0, covered: 0 }); r.vertices++;
    if (covered) { r.covered++; coveredBones[body.bone[v]] = (coveredBones[body.bone[v]] ?? 0) + 1; lowestCovered = Math.min(lowestCovered, body.position[v * 3 + 1]);
      if (!garmentBones.has(body.bone[v])) outsideVertices.push(v); }
  }
  const outside = Object.keys(coveredBones).filter(name => !garmentBones.has(name));
  check(!regions.hand?.covered, `Coverage hides hand body vertices: ${short(key)}`);
  // Joint names alone do not locate a coverage boundary. The shirt touches a neck ring weighted to
  // head and a hem vertex weighted to a thigh helper. Require the exact independently inspected
  // points and source hashes; any additional unexpected coverage remains a failed check.
  check(!outside.length || (key === SHIRT && boundary.passed && boundary.bodySha256 === derived.bodySha256
    && boundary.shirtSha256 === meshReport.meshes[i].sha256 && boundary.maskSha256 === record.sha256
    && same(outsideVertices, boundary.flagged.map(v => v.vertex)) && boundary.flagged.every(v => v.distanceToShirt <= .04)),
    `Coverage has unreviewed body vertices driven by bones without garment geometry (${short(key)}): ${outside}`);
  check(lowestCovered >= garmentMin - 0.04, `Coverage extends below the garment beyond the 4 cm tolerance: ${short(key)}`);
  report.coverage.records[short(key)] = { file: record.file, sha256: record.sha256, poseCounts: record.poseCounts, coveredTriangles: record.coveredTriangles,
    pixels: record.coveredPixels, bindPoseRegions: regions, garmentLowestM: +garmentMin.toFixed(3), lowestCoveredBodyVertexM: +lowestCovered.toFixed(3) };
}
let union = 0, capeOnly = 0;
for (let p = 0; p < masks[SHIRT].length; p++) { if (masks[SHIRT][p] || masks[CAPE][p]) union++; if (masks[CAPE][p] && !masks[SHIRT][p]) capeOnly++; }
report.coverage.itemUnion = { pixels: union, capeOnlyPixels: capeOnly, semantics: 'CharacterRig unions every part mask of the slot (BodyDecals lighten composite)' };

// 8. Dispositions.
const dispositions = fs.existsSync(`${WORK}/dispositions.json`) ? read(`${WORK}/dispositions.json`) : {};
report.dispositions = { implemented: implemented.length, deferred: deferred.map(id => ({ id, blockers: dispositions[id] ?? null })) };
check(deferred.every(id => dispositions[id] && Object.keys(dispositions[id]).length), 'A deferred choice lacks a blocker');
report.failures = failures;
fs.writeFileSync(`${DOCS}/opus-check.json`, JSON.stringify({ at: new Date().toISOString(), passed: !failures.length, ...report }, null, 2) + '\n');
console.log(JSON.stringify({ passed: !failures.length, failures: failures.slice(0, 10), meshes: report.meshes.map(m => [m.file, m.uvSets, m.slots]),
  supported: report.supported, references: report.references, shaders: { ...report.shaders, surface: undefined },
  coverage: Object.fromEntries(Object.entries(report.coverage.records).map(([k, v]) => [k, { pixels: v.pixels, regions: v.bindPoseRegions }])), union: report.coverage.itemUnion }, null, 1));
process.exitCode = failures.length ? 1 : 0;
