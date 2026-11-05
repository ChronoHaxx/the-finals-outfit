import { readFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, posix } from 'node:path';
import { PAGES_FREE } from './stage-selection.mjs';
import { reconstructionDependencies, RECONSTRUCTION_ROOTS, OPTIONAL_RECONSTRUCTION_ROOTS } from './reconstruction-assets.mjs';
import { isReconstructionPath, joinBase, parseReconstructionRoutes } from '../../src/lib/asset-routing.mjs';

export const CONTROL_FILES = ['assets.json', 'skin-pairs.json', 'supported-items.json', 'face-cosmetics.json']
  .map(name => `models/reconstructed-assemblies-v1/${name}`);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = values => [...values].sort();
const union = (a, b) => new Set([...a, ...b]);

export function dependencyPath(parent, value) {
  const target = posix.normalize(posix.join(posix.dirname(parent), value));
  if (target === '..' || target.startsWith('../') || target.startsWith('/')) throw new Error(`Asset escapes public/: ${value}`);
  return target;
}

// The plan pins bytes as well as topology; staging refuses a changed extraction.
// GLB buffers/images with external URIs are included, not assumed embedded.
export function readAssetGraph(publicDir, roots, { onProgress } = {}) {
  const root = resolve(publicDir), nodes = {};
  let count = 0, totalBytes = 0;
  function add(rel) {
    if (nodes[rel]) return;
    const file = resolve(root, rel), local = relative(root, file);
    if (local === '..' || local.startsWith('..\\') || local.startsWith('../') || isAbsolute(local))
      throw new Error(`Asset escapes public/: ${rel}`);
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Missing asset: ${rel}`);
    const bytes = readFileSync(file); let json;
    if (/\.(json|gltf)$/i.test(rel)) json = JSON.parse(bytes.toString('utf8'));
    if (rel.endsWith('.glb')) {
      if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2
        || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a
        || 20 + bytes.readUInt32LE(12) > bytes.length) throw new Error(`Invalid GLB: ${rel}`);
      json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trim());
    }
    const checkReference = value => {
      if (typeof value === 'string' && /\.(json|glsl|bin|glb|gltf|png|webp|jpg|jpeg|ktx2)(?:[?#].*)?$/i.test(value)
        && /^(?:[a-z]+:|\/)|[%?#\\]/i.test(value)) throw new Error(`Untracked external or encoded asset reference in ${rel}: ${value}`);
      if (Array.isArray(value)) value.forEach(checkReference);
      else if (value && typeof value === 'object') Object.values(value).forEach(checkReference);
    };
    if (json) checkReference(json);
    const dependencies = json ? sorted(reconstructionDependencies(json, rel)).map(p => dependencyPath(rel, p)) : [];
    // Reject unsupported external glTF URIs rather than silently leaving a hole.
    if (/\.(glb|gltf)$/i.test(rel)) for (const row of [...(json.buffers ?? []), ...(json.images ?? [])]) {
      if (!row.uri || row.uri.startsWith('data:')) continue;
      if (/^[a-z]+:|^\/|[?#%\\]/i.test(row.uri)) throw new Error(`Unsupported glTF URI in ${rel}: ${row.uri}`);
      const target = dependencyPath(rel, row.uri);
      if (!dependencies.includes(target)) dependencies.push(target);
    }
    nodes[rel] = { bytes: bytes.length, sha256: digest(bytes), dependencies: sorted(new Set(dependencies)) };
    totalBytes += bytes.length;
    if (++count % 1000 === 0) onProgress?.({ files: count, bytes: totalBytes });
    for (const p of dependencies) add(p);
  }
  for (const rel of sorted(roots)) add(rel);
  return nodes;
}

export function planAssetShards(nodes, { version, limits = PAGES_FREE, controls = CONTROL_FILES,
  requiredRoots = [...RECONSTRUCTION_ROOTS, ...OPTIONAL_RECONSTRUCTION_ROOTS] } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(version ?? '')) throw new Error('Invalid immutable release version');
  const capacity = limits.maxFiles - limits.reservedFiles;
  if (capacity < 1) throw new Error('No package capacity');
  for (const [p, n] of Object.entries(nodes)) {
    if (n.bytes > limits.maxFileBytes) throw new Error(`Oversized asset cannot be fixed by sharding: ${p}`);
    for (const d of n.dependencies) if (!nodes[d]) throw new Error(`Missing graph dependency: ${p} -> ${d}`);
  }
  const control = new Set(controls.filter(p => nodes[p]));
  const roots = requiredRoots.filter(p => nodes[p]);
  function closure(seeds) {
    const files = new Set();
    const add = p => {
      if (files.has(p)) return;
      if (control.has(p)) throw new Error(`Leaf dependency points back to a control index: ${p}`);
      files.add(p); nodes[p].dependencies.forEach(add);
    };
    seeds.forEach(add); return files;
  }
  const baseline = union(control, closure(roots.filter(p => !control.has(p))));
  if (baseline.size > capacity) throw new Error('Required control-root closure exceeds one shard; change the index contract before release');
  const groups = new Map();
  for (const p of Object.keys(nodes).filter(p => !control.has(p))) {
    const prefix = p.split('/').slice(0, 2).join('/') + '/';
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(p);
  }
  const units = [];
  function split(prefix, seeds) {
    const files = closure(seeds);
    if (files.size <= capacity) { units.push({ prefix, seeds: sorted(seeds), files }); return; }
    if (seeds.length === 1) throw new Error(`Unsplittable dependency closure exceeds one shard: ${seeds[0]}`);
    const children = new Map();
    for (const p of seeds) {
      const tail = p.slice(prefix.length), slash = tail.indexOf('/');
      const child = slash < 0 ? p : prefix + tail.slice(0, slash + 1);
      if (!children.has(child)) children.set(child, []);
      children.get(child).push(p);
    }
    for (const [child, members] of children) split(child, members);
  }
  for (const [prefix, seeds] of groups) split(prefix, seeds);
  // A unit whose route prefix covers a control index must live on shard 0, or its route would send the control
  // indexes to a leaf host (the Season 11 release: head-wraps.json beside assets.json). Place those first.
  const coversControl = unit => unit.prefix.endsWith('/') && [...control].some(p => p.startsWith(unit.prefix));
  units.sort((a, b) => coversControl(b) - coversControl(a) || b.files.size - a.files.size || a.prefix.localeCompare(b.prefix));
  const bins = [baseline], prefixShards = {}, owners = {};
  for (const p of control) owners[p] = 0;
  for (const unit of units) {
    if (coversControl(unit)) {
      const merged = union(bins[0], unit.files);
      if (merged.size > capacity) throw new Error(`Control directory group does not fit shard 0: ${unit.prefix}`);
      bins[0] = merged; prefixShards[unit.prefix] = 0;
      for (const p of unit.seeds) owners[p] = 0;
      continue;
    }
    const candidates = bins.map((files, i) => ({ i, merged: union(files, unit.files) }))
      .filter(b => b.merged.size <= capacity)
      .sort((a, b) => a.merged.size - bins[a.i].size - (b.merged.size - bins[b.i].size)
        || b.merged.size - a.merged.size || a.i - b.i);
    const target = candidates[0]?.i ?? bins.length;
    bins[target] = candidates[0]?.merged ?? new Set(unit.files);
    prefixShards[unit.prefix] = target;
    for (const p of unit.seeds) owners[p] = target;
  }
  const shards = bins.map((files, id) => ({ id, name: `reconstruction-${String(id).padStart(3, '0')}`,
    paths: sorted(files), files: files.size + limits.reservedFiles,
    bytes: [...files].reduce((s, p) => s + nodes[p].bytes, 0) }));
  const plan = { formatVersion: 1, version, limits, controls: sorted(control), requiredRoots: roots,
    nodes, owners, prefixShards, shards, uniqueFiles: Object.keys(nodes).length,
    duplicatedFiles: shards.reduce((s, b) => s + b.paths.length, 0) - Object.keys(nodes).length };
  validateShardPlan(plan);
  return plan;
}

export function validateShardPlan(plan) {
  if (plan.formatVersion !== 1 || !plan.shards.length) throw new Error('Invalid shard plan');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(plan.version)) throw new Error('Invalid release version');
  for (const key of ['maxFiles', 'reservedFiles', 'maxFileBytes'])
    if (!Number.isInteger(plan.limits[key]) || plan.limits[key] < 1) throw new Error('Invalid package limits');
  if (plan.limits.maxFiles > PAGES_FREE.maxFiles || plan.limits.maxFileBytes > PAGES_FREE.maxFileBytes
    || plan.limits.reservedFiles < 3) throw new Error('Plan exceeds supported free limits or omits package metadata');
  const identities = new Set();
  for (const p of Object.keys(plan.nodes)) {
    if (!/^[\w./-]+$/.test(p) || p.startsWith('/') || p !== posix.normalize(p) || p.split('/').includes('..'))
      throw new Error(`Invalid release path: ${p}`);
    if (identities.has(p.toLowerCase())) throw new Error(`Case-ambiguous release path: ${p}`);
    identities.add(p.toLowerCase());
  }
  const controls = new Set(plan.controls);
  const locations = plan.shards.map(shard => new Set(shard.paths));
  const prefixes = Object.entries(plan.prefixShards).sort(([a], [b]) => b.length - a.length);
  for (const shard of plan.shards) {
    const files = new Set(shard.paths);
    if (files.size !== shard.paths.length || files.size + plan.limits.reservedFiles > plan.limits.maxFiles)
      throw new Error(`Shard file limit or duplicate path: ${shard.name}`);
    for (const p of files) {
      if (!plan.nodes[p]) throw new Error(`Unpinned shard file: ${p}`);
      if (controls.has(p)) {
        if (shard.id !== 0) throw new Error('Control indices must remain on shard 0');
        continue;
      }
      for (const d of plan.nodes[p].dependencies) if (!files.has(d)) throw new Error(`Broken relative dependency: ${p} -> ${d}`);
    }
  }
  for (const [p, n] of Object.entries(plan.nodes)) {
    if (!locations[plan.owners[p]]?.has(p)) throw new Error(`Missing primary owner: ${p}`);
    if (isReconstructionPath(p)) {
      const match = prefixes.find(([prefix]) => p === prefix || (prefix.endsWith('/') && p.startsWith(prefix)));
      if (!locations[match?.[1] ?? 0]?.has(p)) throw new Error(`Runtime route misses file: ${p}`);
    }
    if (n.bytes > plan.limits.maxFileBytes) throw new Error(`Oversized asset: ${p}`);
  }
  for (const p of plan.requiredRoots) if (!plan.shards[0].paths.includes(p)) throw new Error(`Missing primary release root: ${p}`);
}

export function shardHosts(plan, config, { requireAll = false } = {}) {
  if (config?.planSha256 !== digest(JSON.stringify(plan))) throw new Error('Host mapping does not pin this exact shard plan');
  const hosts = {};
  for (const shard of plan.shards) {
    const entry = config.shards?.[shard.name];
    if (!entry) { if (requireAll) throw new Error(`Missing immutable host: ${shard.name}`); continue; }
    if (entry.immutable !== true) throw new Error(`Host must be confirmed immutable: ${shard.name}`);
    const probe = parseReconstructionRoutes({ 'models/reconstructed-host-check/': entry.baseUrl });
    hosts[shard.id] = Object.values(probe)[0];
  }
  if (new Set(Object.values(hosts)).size !== Object.keys(hosts).length) throw new Error('Different shards require different immutable base URLs');
  return hosts;
}

export function routesForShards(plan, hosts) {
  if (!hosts[0]) throw new Error('Primary immutable host is not known yet');
  const routes = {};
  for (const [prefix, id] of Object.entries(plan.prefixShards)) {
    if (!isReconstructionPath(prefix) || id === 0) continue;
    if (!hosts[id]) throw new Error(`Missing immutable host for ${prefix}`);
    routes[prefix] = hosts[id];
  }
  return parseReconstructionRoutes(routes);
}

export function stagedControlBytes(plan, name, sourceBytes, hosts) {
  if (!plan.controls.includes(name) || digest(sourceBytes) !== plan.nodes[name]?.sha256) throw new Error(`Control index changed: ${name}`);
  const rewrite = value => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
    if (typeof value !== 'string') return value;
    if (!reconstructionDependencies({ value }, name).has(value)) return value;
    const target = dependencyPath(name, value);
    // Canonical ownership matters even when shard 0 contains a duplicate: the
    // rig checks that skin/attachment body URLs match the loaded body's URL.
    if (!plan.nodes[name].dependencies.includes(target) || plan.owners[target] === 0) return value;
    const host = hosts[plan.owners[target]];
    if (!host) throw new Error(`Publish leaf shard ${plan.owners[target]} first: ${target}`);
    return joinBase(host, target);
  };
  return Buffer.from(JSON.stringify(rewrite(JSON.parse(sourceBytes)), null, 2) + '\n');
}
