import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { readAssetGraph, planAssetShards, validateShardPlan, stagedControlBytes, shardHosts, routesForShards, digest } from '../scripts/lib/asset-shards.mjs';
import { parseReconstructionRoutes, compactReconstructionRoutes, modelUrlFor } from '../src/lib/asset-routing.mjs';
import { catalogHostGroups } from '../scripts/lib/catalog-host-groups.mjs';
import { verifyShardRelease } from '../scripts/lib/verify-shards.mjs';

const control = 'models/reconstructed-assemblies-v1/assets.json';
const limits = { maxFiles: 8, reservedFiles: 3, maxFileBytes: 25 * 1024 * 1024 };
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finals-shard-'));
  const put = (p, bytes) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), typeof bytes === 'string' || Buffer.isBuffer(bytes) ? bytes : JSON.stringify(bytes)); };
  const materials = {};
  for (const id of ['a', 'b', 'c']) {
    materials[`/Game/${id}`] = `../reconstructed-${id}/material.json`;
    put(`models/reconstructed-${id}/material.json`, { shader: 'shader.glsl', textures: ['texture.bin', '../shared/common.bin'] });
    put(`models/reconstructed-${id}/shader.glsl`, id); put(`models/reconstructed-${id}/texture.bin`, id);
  }
  put('models/shared/common.bin', 'shared'); put(control, { materials, source: '/Game/Keep.This' });
  const nodes = readAssetGraph(root, [control]);
  const plan = planAssetShards(nodes, { version: 'fixture-v1', controls: [control], requiredRoots: [control], limits });
  const config = { planSha256: digest(JSON.stringify(plan)), shards: Object.fromEntries(plan.shards.map(s =>
    [s.name, { immutable: true, baseUrl: `https://immutable-${s.id}.example/release-v1/` }])) };
  return { root, put, nodes, plan, config, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('adaptive packing adds any required shards, duplicates dependencies and preserves all bytes', () => {
  const f = fixture();
  try {
    assert.equal(f.plan.shards.length, 3);
    assert.equal(f.plan.duplicatedFiles, 2);
    const shared = 'models/shared/common.bin';
    assert.ok(f.plan.shards.every(s => s.paths.includes(shared)));
    assert.ok(f.plan.shards.every(s => s.paths.length + 3 <= 8));
    assert.deepEqual(planAssetShards(f.nodes, { version: 'fixture-v1', controls: [control], requiredRoots: [control], limits }), f.plan);
    const broken = structuredClone(f.plan); broken.shards[1].paths = broken.shards[1].paths.filter(p => p !== shared);
    assert.throws(() => validateShardPlan(broken), /Broken relative dependency/);
  } finally { f.clean(); }
});

test('control links are rewritten only to pinned immutable leaf hosts; relative leaf references survive', () => {
  const f = fixture();
  try {
    const hosts = shardHosts(f.plan, f.config, { requireAll: true });
    const bytes = fs.readFileSync(path.join(f.root, control));
    assert.throws(() => stagedControlBytes(f.plan, control, bytes, {}), /Publish leaf shard/);
    const staged = JSON.parse(stagedControlBytes(f.plan, control, bytes, hosts));
    assert.equal(staged.source, '/Game/Keep.This');
    const routes = routesForShards(f.plan, hosts);
    for (const [source, value] of Object.entries(staged.materials)) {
      const id = source.slice(-1), relative = `models/reconstructed-${id}/material.json`;
      const resolved = new URL(value, hosts[0] + control).href;
      const owner = f.plan.owners[relative];
      const expected = hosts[owner] + relative;
      assert.equal(resolved, expected);
      assert.equal(modelUrlFor(relative, { assetsBase: 'https://icons.example/', reconstructionBase: hosts[0], reconstructionRoutes: routes }), expected);
      const material = JSON.parse(fs.readFileSync(path.join(f.root, relative)));
      for (const dependency of [material.shader, ...material.textures]) {
        const pathname = new URL(dependency, resolved).pathname.replace('/release-v1/', '');
        assert.ok(f.plan.shards[owner].paths.includes(pathname));
      }
    }
    assert.throws(() => shardHosts(f.plan, { ...f.config, planSha256: 'wrong' }), /exact shard plan/);
    const mutable = structuredClone(f.config); mutable.shards['reconstruction-001'].immutable = false;
    assert.throws(() => shardHosts(f.plan, mutable), /confirmed immutable/);
  } finally { f.clean(); }
});

test('large flat folders split with exact file routes, while oversized files and unsplittable closures fail', () => {
  const nodes = Object.fromEntries(Array.from({ length: 13 }, (_, i) =>
    [`models/reconstructed-flat/${i}.bin`, { bytes: 1, sha256: 'test', dependencies: [] }]));
  const plan = planAssetShards(nodes, { version: 'flat', controls: [], requiredRoots: [], limits });
  assert.equal(plan.shards.length, 3);
  const hosts = Object.fromEntries(plan.shards.map(s => [s.id, `https://shard-${s.id}.example/`]));
  const routes = routesForShards(plan, hosts);
  for (const [p, id] of Object.entries(plan.owners)) assert.equal(modelUrlFor(p, { assetsBase: hosts[0], reconstructionRoutes: routes }), hosts[id] + p);
  const huge = structuredClone(nodes); huge['models/reconstructed-flat/0.bin'].bytes = limits.maxFileBytes + 1;
  assert.throws(() => planAssetShards(huge, { version: 'huge', controls: [], requiredRoots: [], limits }), /Oversized asset/);
  const joined = structuredClone(nodes); joined['models/reconstructed-flat/0.bin'].dependencies = Object.keys(nodes).slice(1);
  assert.throws(() => planAssetShards(joined, { version: 'joined', controls: [], requiredRoots: [], limits }), /Unsplittable/);
});

test('a non-control file beside the control indexes keeps their directory on shard 0', () => {
  // Season 11 release (28 Oct 2026): a large family filled shard 0 first, the control directory's own group
  // (head-wraps.json and its closure) went to a leaf, and its route then sent the control indexes there.
  const node = (...dependencies) => ({ bytes: 1, sha256: '0'.repeat(64), dependencies });
  const wraps = 'models/reconstructed-assemblies-v1/head-wraps.json';
  const nodes = { [control]: node(), [wraps]: node('models/reconstructed-wraps/w1.bin'), 'models/reconstructed-wraps/w1.bin': node(),
    ...Object.fromEntries([1, 2, 3, 4].map(i => [`models/reconstructed-x/x${i}.bin`, node()])) };
  const plan = planAssetShards(nodes, { version: 'control-dir', controls: [control], requiredRoots: [control], limits });
  assert.equal(plan.prefixShards['models/reconstructed-assemblies-v1/'], 0);
  assert.equal(plan.owners[wraps], 0);
  assert.ok(plan.shards[0].paths.includes(control) && plan.shards[0].paths.includes(wraps));
  assert.equal(plan.shards.length, 2);
});

test('duplicated body references use the same canonical host as direct runtime requests', () => {
  const f = fixture();
  try {
    const common = 'models/reconstructed-shared/body.bin';
    for (const id of ['a', 'b', 'c']) f.put(`models/reconstructed-${id}/material.json`, {
      shader: 'shader.glsl', textures: ['texture.bin', '../reconstructed-shared/body.bin'] });
    f.put(common, 'body'); f.put('models/reconstructed-shared/extra1.bin', 'x'); f.put('models/reconstructed-shared/extra2.bin', 'y');
    const index = JSON.parse(fs.readFileSync(path.join(f.root, control)));
    index.bodyUrl = '../reconstructed-shared/body.bin';
    index.extras = ['../reconstructed-shared/extra1.bin', '../reconstructed-shared/extra2.bin']; f.put(control, index);
    const nodes = readAssetGraph(f.root, [control]);
    const plan = planAssetShards(nodes, { version: 'body', limits, controls: [control], requiredRoots: [control, common] });
    assert.ok(plan.shards[0].paths.includes(common)); assert.notEqual(plan.owners[common], 0);
    const hosts = Object.fromEntries(plan.shards.map(s => [s.id, `https://shard-${s.id}.example/`]));
    const result = JSON.parse(stagedControlBytes(plan, control, fs.readFileSync(path.join(f.root, control)), hosts));
    assert.equal(new URL(result.bodyUrl, hosts[0] + control).href,
      modelUrlFor(common, { assetsBase: hosts[0], reconstructionRoutes: routesForShards(plan, hosts) }));
  } finally { f.clean(); }
});

test('routing uses segment boundaries and longest prefix, validates hosts, and keeps old configurations', () => {
  const routes = parseReconstructionRoutes({ 'models/reconstructed-a/': 'https://a.example/v1',
    'models/reconstructed-a/nested/': 'https://b.example/v2/' });
  const bases = { assetsBase: 'https://old.example/', reconstructionRoutes: routes };
  assert.deepEqual(parseReconstructionRoutes(JSON.stringify(compactReconstructionRoutes(routes))), routes);
  assert.equal(modelUrlFor('models/reconstructed-a/nested/x.bin', bases), 'https://b.example/v2/models/reconstructed-a/nested/x.bin');
  assert.equal(modelUrlFor('models/reconstructed-a', bases), 'https://a.example/v1/models/reconstructed-a');
  assert.equal(modelUrlFor('models/reconstructed-ab/x.bin', bases), 'https://old.example/models/reconstructed-ab/x.bin');
  assert.equal(modelUrlFor('models/body/body.glb', bases), 'https://old.example/models/body/body.glb');
  for (const bad of [{ '../escape/': 'https://a.example' }, { 'models/reconstructed-a/': 'http://external.example/' },
    { 'models/reconstructed-a/': 'https://user:secret@example/' }, []]) assert.throws(() => parseReconstructionRoutes(bad));
  const groups = catalogHostGroups(['models/reconstructed-a/x.bin'], 'https://icons.example/', 'https://base.example/', 'https://root.example/', routes);
  assert.equal(groups.find(g => g.base === 'https://a.example/v1/').paths.length, 1);
  assert.equal(groups.filter(g => g.reconstruction).length, 1, 'only primary host owns global index roots');
});

test('GLB external buffers join the graph; escaping resources are rejected', () => {
  const f = fixture();
  try {
    let json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'external.bin', byteLength: 1 }] }));
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const glb = Buffer.alloc(20 + json.length);
    glb.writeUInt32LE(0x46546c67); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
    f.put('models/reconstructed-glb/model.glb', glb); f.put('models/reconstructed-glb/external.bin', 'x');
    const graph = readAssetGraph(f.root, ['models/reconstructed-glb/model.glb']);
    assert.equal(Object.keys(graph).length, 2);
    f.put('models/reconstructed-glb/bad.json', { url: '../../../../secret.bin' });
    assert.throws(() => readAssetGraph(f.root, ['models/reconstructed-glb/bad.json']), /escapes/);
    f.put('models/reconstructed-glb/bad.json', { url: 'https://untracked.example/texture.bin' });
    assert.throws(() => readAssetGraph(f.root, ['models/reconstructed-glb/bad.json']), /Untracked external/);
  } finally { f.clean(); }
});

test('staging refuses stale bytes and emits complete metadata without copying anything in dry-run', () => {
  const f = fixture();
  try {
    const planFile = path.join(f.root, 'plan.json'), hostsFile = path.join(f.root, 'hosts.json'), output = path.join(f.root, 'output');
    fs.writeFileSync(planFile, JSON.stringify(f.plan)); fs.writeFileSync(hostsFile, JSON.stringify(f.config));
    const run = extra => spawnSync(process.execPath, ['scripts/stage-asset-shard.mjs', planFile, '0', '--hosts', hostsFile, ...extra],
      { encoding: 'utf8', env: { ...process.env, ASSET_SOURCE_DIR: f.root, ASSET_SHARD_OUT: output } });
    let result = run(['--dry-run']); assert.equal(result.status, 0, result.stderr); assert.equal(fs.existsSync(output), false);
    result = run([]); assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
    assert.equal(manifest.count + 3, 8); assert.equal(fs.existsSync(path.join(output, '404.html')), true);
    assert.equal(run([]).status, 1, 'must never overwrite an existing release directory');
    f.put(control, { changed: true });
    assert.match(run(['--dry-run']).stderr, /Asset changed since plan/);
  } finally { f.clean(); }
});

test('release verification checks every shard manifest and detects missing or corrupt served dependencies', async () => {
  const f = fixture();
  try {
    const planFile = path.join(f.root, 'plan.json'), hostsFile = path.join(f.root, 'hosts.json');
    fs.writeFileSync(planFile, JSON.stringify(f.plan)); fs.writeFileSync(hostsFile, JSON.stringify(f.config));
    const directories = {};
    for (const shard of f.plan.shards) {
      const out = path.join(f.root, `staged-${shard.id}`); directories[shard.id] = out;
      const result = spawnSync(process.execPath, ['scripts/stage-asset-shard.mjs', planFile, String(shard.id), '--hosts', hostsFile],
        { encoding: 'utf8', env: { ...process.env, ASSET_SOURCE_DIR: f.root, ASSET_SHARD_OUT: out } });
      assert.equal(result.status, 0, result.stderr);
      f.config.shards[shard.name].manifestSha256 = digest(fs.readFileSync(path.join(out, 'manifest.json')));
    }
    const fetcher = async input => {
      const url = new URL(input), id = Number(url.hostname.match(/^immutable-(\d+)/)[1]);
      const local = path.join(directories[id], url.pathname.replace('/release-v1/', ''));
      return fs.existsSync(local) ? new Response(fs.readFileSync(local)) : new Response('missing', { status: 404 });
    };
    const report = await verifyShardRelease(f.plan, f.config, fetcher);
    assert.equal(report.shards.length, 3);
    assert.ok(report.shards.every(s => s.sampled.length > 0));
    fs.writeFileSync(hostsFile, JSON.stringify(f.config));
    const configRun = spawnSync(process.execPath, ['scripts/asset-shard-config.mjs', planFile, hostsFile], { encoding: 'utf8' });
    assert.equal(configRun.status, 0, configRun.stderr);
    const settings = JSON.parse(configRun.stdout);
    assert.equal(settings.build.VITE_RECONSTRUCTION_BASE, f.config.shards['reconstruction-000'].baseUrl);
    assert.equal(settings.build.VITE_RECONSTRUCTION_ROUTES, settings.validation.RECONSTRUCTION_ROUTES);
    assert.deepEqual(parseReconstructionRoutes(settings.build.VITE_RECONSTRUCTION_ROUTES),
      routesForShards(f.plan, shardHosts(f.plan, f.config, { requireAll: true })));
    const moved = structuredClone(f.config);
    moved.shards['reconstruction-001'].baseUrl = 'https://new-leaf.example/release-v1/';
    const movedFetch = input => fetcher(String(input).replace('new-leaf.example', 'immutable-1.example'));
    await assert.rejects(verifyShardRelease(f.plan, moved, movedFetch), /Control index and runtime host mapping disagree/);
    const leaf = f.plan.shards[1].paths.find(p => p.endsWith('.glsl'));
    fs.writeFileSync(path.join(directories[1], leaf), 'corrupt');
    await assert.rejects(verifyShardRelease(f.plan, f.config, fetcher), /Hosted asset bytes differ/);
    fs.rmSync(path.join(directories[1], leaf));
    await assert.rejects(verifyShardRelease(f.plan, f.config, fetcher), /Asset HTTP 404/);
    const wrong = structuredClone(f.config); wrong.shards['reconstruction-000'].manifestSha256 = '0'.repeat(64);
    await assert.rejects(verifyShardRelease(f.plan, wrong, fetcher), /differs from staged bytes/);
  } finally { f.clean(); }
});

test('--gzip-meshes publishes each mesh gzipped and verification checks it against the planned source', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finals-gzip-mesh-'));
  try {
    const put = (p, bytes) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), bytes); };
    let json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }));
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const body = Buffer.alloc(20 + json.length + 4096); // mostly zeros, like unmoved morph-target vertices
    body.writeUInt32LE(0x46546c67); body.writeUInt32LE(2, 4); body.writeUInt32LE(body.length, 8);
    body.writeUInt32LE(json.length, 12); body.writeUInt32LE(0x4e4f534a, 16); json.copy(body, 20);
    put('models/reconstructed-meshes/body.glb', body);
    put(control, JSON.stringify({ meshes: { body: { url: '../reconstructed-meshes/body.glb' } } }));
    const plan = planAssetShards(readAssetGraph(root, [control]), { version: 'gzip-v1', controls: [control], requiredRoots: [control], limits });
    const config = { planSha256: digest(JSON.stringify(plan)), shards: Object.fromEntries(plan.shards.map(s =>
      [s.name, { immutable: true, baseUrl: `https://immutable-${s.id}.example/release-v1/` }])) };
    const planFile = path.join(root, 'plan.json'), hostsFile = path.join(root, 'hosts.json'), out = path.join(root, 'staged-0');
    fs.writeFileSync(planFile, JSON.stringify(plan)); fs.writeFileSync(hostsFile, JSON.stringify(config));
    const run = spawnSync(process.execPath, ['scripts/stage-asset-shard.mjs', planFile, '0', '--hosts', hostsFile, '--gzip-meshes'],
      { encoding: 'utf8', env: { ...process.env, ASSET_SOURCE_DIR: root, ASSET_SHARD_OUT: out } });
    assert.equal(run.status, 0, run.stderr);
    const staged = fs.readFileSync(path.join(out, 'models/reconstructed-meshes/body.glb'));
    assert.deepEqual([staged[0], staged[1]], [0x1f, 0x8b]);
    assert.ok(staged.length < body.length / 4);
    assert.deepEqual(zlib.gunzipSync(staged), body);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json')));
    assert.equal(manifest.meshEncoding, 'gzip');
    assert.deepEqual(manifest.files['models/reconstructed-meshes/body.glb'], { sha256: digest(staged), bytes: staged.length,
      encoding: 'gzip', sourceSha256: plan.nodes['models/reconstructed-meshes/body.glb'].sha256, sourceBytes: body.length });
    assert.equal(manifest.files[control].encoding, undefined); // indexes stay plain JSON
    config.shards['reconstruction-000'].manifestSha256 = digest(fs.readFileSync(path.join(out, 'manifest.json')));
    const fetcher = async input => {
      const local = path.join(out, new URL(input).pathname.replace('/release-v1/', ''));
      return fs.existsSync(local) ? new Response(fs.readFileSync(local)) : new Response('missing', { status: 404 });
    };
    const report = await verifyShardRelease(plan, config, fetcher);
    assert.ok(report.shards[0].sampled.includes('models/reconstructed-meshes/body.glb'));
    // A hosted gzip that decompresses to anything but the planned source fails, even with a matching manifest row.
    const tampered = zlib.gzipSync(Buffer.concat([body.subarray(0, -1), Buffer.from([1])]), { level: 9 });
    const forged = structuredClone(manifest);
    Object.assign(forged.files['models/reconstructed-meshes/body.glb'], { sha256: digest(tampered), bytes: tampered.length });
    fs.writeFileSync(path.join(out, 'models/reconstructed-meshes/body.glb'), tampered);
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(forged));
    config.shards['reconstruction-000'].manifestSha256 = digest(fs.readFileSync(path.join(out, 'manifest.json')));
    await assert.rejects(verifyShardRelease(plan, config, fetcher), /Hosted gzip mesh differs from planned source/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
