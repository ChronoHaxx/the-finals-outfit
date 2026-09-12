// Prepare the audited Stage A coverage cohort: exact choices, per-choice material
// dependencies and reproducible extraction requests. Preparing a batch is not a
// build, a validation or any visual acceptance of these items.
// Run with `node --import tsx` so the real source resolver can be imported.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { resolveSourceOutfit, resolveSourceRigParts } = await import(pathToFileURL(path.resolve('src/rig/SourceAssembly.ts')));

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const uniq = a => [...new Set(a.filter(Boolean))].sort();
const soft = v => v?.AssetPathName || '';
const leaf = p => p?.split('.').pop();
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const fail = message => { throw new Error(message); };

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value`);
  return value;
};
const has = name => argv.includes(`--${name}`);
const outDir = path.resolve(flag('output', 'scripts/generated/shader-probe/coverage-sprint-a-01'));
const expectedItems = Number(flag('expect-items', 56));
const expectedMaterials = Number(flag('expect-materials', 58));
const auditPath = flag('audit', '_docs/reconstruction-roadmap-2026-09-09/audit.json');
if (has('force') || has('allow-input-drift')) fail('Use a new output directory and a fresh audit; stale-input and overwrite bypasses are not supported.');
// Generated game data never leaves the ignored generated tree.
if (!path.resolve(outDir).startsWith(path.resolve('scripts/generated') + path.sep)) {
  fail(`Output must stay under scripts/generated: ${outDir}`);
}
for (let parent = outDir; parent !== path.resolve('.'); parent = path.dirname(parent)) {
  if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) fail(`Output ancestor is a symbolic link or junction: ${parent}`);
}
if (fs.existsSync(outDir) && !fs.existsSync(path.join(outDir, 'cohort.json')) && fs.readdirSync(outDir).length) {
  fail(`Output directory is nonempty and is not owned by this preparer: ${outDir}`);
}

const catalog = read('src/data/items.json');
const data = read('public/models/reconstructed-assembly-v2/customization.json');
const assets = read('public/models/reconstructed-assemblies-v1/assets.json');
const supported = new Set(read('public/models/reconstructed-assemblies-v1/supported-items.json').items);
const coverage = read('scripts/generated/shader-probe/material-inventory-v2/coverage.json');
const records = new Map(read('scripts/generated/shader-probe/material-inventory-v2/materials.json').records.map(r => [r.path, r]));
const extra = 'scripts/generated/shader-probe/reference-outfit-01/extra-material-inventory/materials.json';
if (fs.existsSync(extra)) for (const r of read(extra).records) if (!records.has(r.path)) records.set(r.path, r);
const selected = new Map(coverage.resolved.map(r => [r.path, r]));
const audit = read(auditPath);

// The cohort is only meaningful against the inputs the audit measured.
const inputDrift = Object.entries(audit.inputHashes)
  .filter(([p, hash]) => !fs.existsSync(p) || sha256(fs.readFileSync(p)) !== hash).map(([p]) => p);
if (inputDrift.length) {
  fail(`Audit inputs changed since the roadmap audit: ${inputDrift.join(', ')}. Re-run the audit.`);
}

function describeMaterial(p) {
  const chain = []; const seen = new Set(); let current = p;
  while (current && !seen.has(current)) { seen.add(current); chain.push(current); current = records.get(current)?.parent; }
  let s = selected.get(p);
  if (!s) {
    for (const q of chain) {
      const shaders = (records.get(q)?.resources || []).filter(r => r.platform === 'SP_PCD3D_SM5' && r.quality === 'Num')
        .flatMap(r => r.basePassShaders || []).filter(r => r.vertexFactory === 'TGPUSkinVertexFactoryDefault' && r.type === 'TBasePassPSFNoLightMapPolicy');
      const hashes = uniq(shaders.map(r => r.outputHash));
      if (hashes.length === 1) { s = { outputHash: hashes[0], shaderOwner: q }; break; }
    }
  }
  const scalars = {};
  for (const q of [...chain].reverse()) for (const v of records.get(q)?.properties?.ScalarParameterValues || []) scalars[v.ParameterInfo?.Name] = v.ParameterValue;
  return { path: p, chain, root: selected.get(p)?.root || chain.at(-1), outputHash: s?.outputHash || null, shaderOwner: s?.shaderOwner || selected.get(p)?.shaderOwner || null,
    inventoried: records.has(p),
    activeEmissive: Object.entries(scalars).filter(([k, v]) => /EmissiveStrength/i.test(k) && typeof v === 'number' && Math.abs(v) > 1e-8).map(([k]) => k) };
}
const md = new Map([...records.keys()].map(p => [p, describeMaterial(p)]));
const getMat = p => md.get(p) || describeMaterial(p);

// Real compiled-program evidence: extracted SM5 assemblies whose shader map resolves
// to exactly one inventoried output hash. Names alone never establish reuse.
const exportDirs = ['exports-current', 'exports-verified', 'coat-assembly-shaders-v1', 'material-batch-01/exports',
  'assembly-batch-01/exports', 'reference-outfit-01/exports', 'reference-outfit-01/extra-shaders', 'reference-skin-01/exports'];
const resources = [...records.values()].flatMap(r => r.resources || []);
const shaderEvidence = [];
for (const dir of exportDirs) {
  const base = `scripts/generated/shader-probe/${dir}`;
  for (const s of read(`${base}/shader-extraction.json`)) {
    if (s.Platform !== 'SP_PCD3D_SM5' || s.error) continue;
    const asm = `${base}/shaders/${s.Name}.SP_PCD3D_SM5.basepass-pixel.dxbc.asm`;
    if (!fs.existsSync(asm)) continue;
    const outputs = uniq(resources.filter(r => r.platform === s.Platform && r.mapHash === s.Hash)
      .flatMap(r => r.basePassShaders || []).filter(p => p.resourceIndex === s.ResourceIndex).map(p => p.outputHash));
    if (outputs.length !== 1) continue;
    shaderEvidence.push({ owner: s.Name, hash: outputs[0], assembly: asm, assemblySha256: sha256(fs.readFileSync(asm)) });
  }
}
const builtEvidence = Object.entries(assets.materials).map(([source, url]) => {
  const manifest = read(path.resolve('public/models/reconstructed-assemblies-v1', url));
  const hits = shaderEvidence.filter(e => e.owner === manifest.sourceShaderOwner && e.assemblySha256 === manifest.assemblySha256);
  const hashes = uniq(hits.map(e => e.hash));
  if (hashes.length !== 1) fail(`Missing or ambiguous compiled shader evidence: ${source}`);
  if (getMat(source).outputHash !== hashes[0]) fail(`Inventory/active shader mismatch: ${source}`);
  return { source, url, outputHash: hashes[0], assembly: hits[0].assembly, assemblySha256: hits[0].assemblySha256 };
});
const builtHashes = new Set(builtEvidence.map(e => e.outputHash));
const auditHashes = new Set(audit.builtShaderEvidence.map(e => e.outputHash));
if (builtHashes.size !== auditHashes.size || [...builtHashes].some(h => !auditHashes.has(h))) {
  fail('Recomputed built shader evidence differs from the audited evidence');
}
const evidenceByHash = new Map([...builtHashes].map(h => [h, shaderEvidence.filter(e => e.hash === h).sort((a, b) => a.owner.localeCompare(b.owner))]));

// Stage A hypothesis, exactly as audited: reuse every material whose selected
// compiled program is already built. Shared bytecode is not adapter support.
const reusable = Object.fromEntries([...md.values()]
  .filter(m => builtHashes.has(m.outputHash) && !m.activeEmissive.length).map(m => [m.path, '__stage_a_placeholder__']));
const stageAssets = { ...assets, materials: { ...assets.materials, ...reusable } };

const rows = [];
for (const item of catalog) {
  const name = data.catalog[item.id], d = name && data.definitions[name];
  if (!d) continue;
  const outfit = resolveSourceOutfit([{ ...d, id: item.id, formatVersion: 1 }], ['Customization.Archetype.Medium']);
  const resolved = outfit.items[item.id];
  let parts = [];
  try { parts = resolveSourceRigParts(resolved, stageAssets); } catch { continue; }
  if (!parts.length) continue;
  const visible = resolved.parts.filter(p => !p.hidden);
  const bindings = visible.flatMap(p => {
    const meshPath = p.skeletalMesh || p.staticMesh;
    const mesh = assets.meshes[meshPath];
    return (mesh?.slots || []).map(s => ({ mesh: meshPath, slot: s.slot, material: p.materials[s.slot] ?? s.material,
      overridden: p.materials[s.slot] !== undefined }));
  });
  rows.push({ id: item.id, name: item.name, slot: item.slot, supported: supported.has(item.id), bindings,
    mediumMeshes: uniq(visible.flatMap(p => [p.skeletalMesh, p.staticMesh])),
    missingMediumMeshes: uniq(visible.flatMap(p => [p.skeletalMesh, p.staticMesh])).filter(m => !assets.meshes[m]),
    unresolved: resolved.parts.flatMap(p => p.unresolved) });
}

const added = rows.filter(r => !r.supported).sort((a, b) => a.id.localeCompare(b.id));
const newMaterials = uniq(added.flatMap(r => r.bindings.map(b => b.material))).filter(p => !assets.materials[p]);
const newHashes = uniq(newMaterials.map(p => getMat(p).outputHash)).filter(h => !builtHashes.has(h));
const withoutShader = newMaterials.filter(p => !getMat(p).outputHash);
const missingMeshes = added.filter(r => r.missingMediumMeshes.length);
const stillSupported = added.filter(r => supported.has(r.id));
const emissive = newMaterials.filter(p => getMat(p).activeEmissive.length);
const notInventoried = newMaterials.filter(p => !getMat(p).inventoried);

// Extraction and translation address materials by unique leaf name.
const byLeaf = new Map();
for (const p of records.keys()) byLeaf.set(leaf(p), [...(byLeaf.get(leaf(p)) || []), p]);
const requestedPaths = uniq(newMaterials.flatMap(p => getMat(p).chain));
const collisions = requestedPaths.filter(p => (byLeaf.get(leaf(p)) || []).length > 1)
  .map(p => ({ leaf: leaf(p), paths: byLeaf.get(leaf(p)) }));

const discrepancies = [
  JSON.stringify(added.map(r => r.id).sort()) !== JSON.stringify(audit.rows.filter(r => !r.supported && r.scenarios?.sameShaderExistingMeshes?.pass).map(r => r.id).sort())
    && 'resolved IDs do not match the exact audited Stage A cohort',
  added.length !== expectedItems && `expected ${expectedItems} additional choices, resolved ${added.length}`,
  newMaterials.length !== expectedMaterials && `expected ${expectedMaterials} missing base material dependencies, resolved ${newMaterials.length}`,
  missingMeshes.length && `missing standalone Medium meshes: ${missingMeshes.map(r => r.id).join(', ')}`,
  newHashes.length && `new selected compiled programs: ${newHashes.join(', ')}`,
  withoutShader.length && `materials without a selected SM5 program: ${withoutShader.join(', ')}`,
  notInventoried.length && `materials missing from the inventory: ${notInventoried.join(', ')}`,
  emissive.length && `active emissive materials in the cohort: ${emissive.join(', ')}`,
  stillSupported.length && `already supported IDs leaked into the cohort: ${stillSupported.map(r => r.id).join(', ')}`,
  collisions.length && `ambiguous material leaf names: ${collisions.map(c => c.leaf).join(', ')}`,
].filter(Boolean);
if (discrepancies.length) fail(`Stage A evidence discrepancy:\n  - ${discrepancies.join('\n  - ')}`);

const jobId = p => leaf(p).replace(/^MI_/, '').toLowerCase().replaceAll('_', '-') + '-' + crypto.createHash('sha256').update(p).digest('hex').slice(0, 10);
const jobs = newMaterials.map(p => ({ id: jobId(p), instance: leaf(p) }));
if (new Set(jobs.map(j => j.id)).size !== jobs.length) fail('Duplicate generated material job IDs');
const shaderNames = uniq(requestedPaths.map(leaf));
const dependencies = added.map(r => ({ id: r.id, name: r.name, slot: r.slot, meshes: r.mediumMeshes,
  bindings: r.bindings.map(b => {
    const m = getMat(b.material);
    return { ...b, status: assets.materials[b.material] ? 'already-built' : 'requested', jobId: assets.materials[b.material] ? null : jobId(b.material),
      root: m.root, shaderOwner: m.shaderOwner, outputHash: m.outputHash, parents: m.chain.slice(1),
      compiledEvidence: (evidenceByHash.get(m.outputHash) || []).map(e => ({ owner: e.owner, assembly: e.assembly, assemblySha256: e.assemblySha256 })) };
  }) }));

const cohort = {
  formatVersion: 1, generatedAt: new Date().toISOString(), audit: auditPath, auditDate: audit.date,
  scenario: 'sameShaderExistingMeshes', allowedInputDrift: inputDrift,
  meaning: 'Prepared extraction/build inputs for the audited Stage A cohort. No material is built, validated or visually accepted by this preparation.',
  counts: { additionalChoices: added.length, alreadySupported: supported.size, requestedMaterials: newMaterials.length,
    requestedShaderNames: shaderNames.length, reusedCompiledPrograms: uniq(newMaterials.map(p => getMat(p).outputHash)).length,
    newCompiledPrograms: newHashes.length, missingMediumMeshes: 0, leafNameCollisions: collisions.length },
  verified: ['exact additional-choice count', 'exact missing base material count', 'no missing standalone Medium mesh',
    'no new selected compiled program', 'all requested materials inventoried with a selected SM5 program',
    'no active emissive material', 'current supported IDs excluded', 'unique material leaf names'],
  supportedExcluded: [...supported].sort(), itemIds: added.map(r => r.id), materialPaths: newMaterials,
  compiledProgramReuse: uniq(newMaterials.map(p => getMat(p).outputHash)).map(hash => ({ hash,
    requestedMaterials: newMaterials.filter(p => getMat(p).outputHash === hash).map(leaf),
    builtMaterials: builtEvidence.filter(e => e.outputHash === hash).map(e => leaf(e.source)),
    assemblies: (evidenceByHash.get(hash) || []).map(e => ({ owner: e.owner, assemblySha256: e.assemblySha256 })) })),
  unresolvedSourceReferences: added.flatMap(r => r.unresolved.map(u => ({ id: r.id, unresolved: u }))),
};
const cohortSha = sha256(JSON.stringify({ items: cohort.itemIds, materials: cohort.materialPaths, shaders: shaderNames }));
cohort.cohortSha256 = cohortSha;

fs.mkdirSync(outDir, { recursive: true });
const existing = path.join(outDir, 'cohort.json');
if (fs.existsSync(existing) && read(existing).cohortSha256 !== cohortSha) {
  fail(`${outDir} holds a different prepared cohort. Use a new --output directory.`);
}
for (const [file, value] of [['cohort.json', cohort], ['dependencies.json', dependencies],
  ['shaders.requests.json', shaderNames], ['materials.requests.json', jobs]]) {
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(value, null, 2) + '\n');
}
console.log(JSON.stringify({ output: outDir, ...cohort.counts, cohortSha256: cohortSha }, null, 2));
