import { gunzipSync } from 'node:zlib';
import { digest, shardHosts, validateShardPlan } from './asset-shards.mjs';
import { joinBase } from '../../src/lib/asset-routing.mjs';

export async function verifyShardRelease(plan, config, fetcher = fetch) {
  validateShardPlan(plan);
  const hosts = shardHosts(plan, config, { requireAll: true }), report = [];
  for (const shard of plan.shards) {
    const pinned = config.shards[shard.name].manifestSha256;
    if (!/^[a-f0-9]{64}$/.test(pinned ?? '')) throw new Error(`Pin the staged manifest hash: ${shard.name}`);
    const url = joinBase(hosts[shard.id], 'manifest.json');
    const response = await fetcher(url);
    if (response.status !== 200) throw new Error(`Manifest HTTP ${response.status}: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== pinned) throw new Error(`Hosted manifest differs from staged bytes: ${shard.name}`);
    const manifest = JSON.parse(bytes);
    if (manifest.formatVersion !== 2 || manifest.planSha256 !== config.planSha256 || manifest.shard !== shard.name
      || manifest.version !== plan.version || manifest.count !== shard.paths.length
      || JSON.stringify(manifest.paths) !== JSON.stringify(shard.paths)
      || JSON.stringify(manifest.reconstructionPaths) !== JSON.stringify(shard.paths))
      throw new Error(`Hosted shard membership differs from plan: ${shard.name}`);
    if (Object.keys(manifest.files ?? {}).length !== shard.paths.length) throw new Error(`Invalid file manifest: ${shard.name}`);
    for (const path of shard.paths) {
      const row = manifest.files[path];
      if (!/^[a-f0-9]{64}$/.test(row?.sha256 ?? '') || !Number.isInteger(row.bytes) || row.bytes < 0
        || row.bytes > plan.limits.maxFileBytes) throw new Error(`Invalid hosted file metadata: ${path}`);
      // A gzip-published mesh (stage-asset-shard --gzip-meshes) pins its source in the row; anything else is the source.
      if (row.encoding !== undefined && (row.encoding !== 'gzip' || !path.endsWith('.glb') || plan.controls.includes(path)))
        throw new Error(`Unsupported hosted encoding: ${path}`);
      const source = row.encoding ? { sha256: row.sourceSha256, bytes: row.sourceBytes } : row;
      if (!plan.controls.includes(path) && (source.sha256 !== plan.nodes[path].sha256 || source.bytes !== plan.nodes[path].bytes))
        throw new Error(`Hosted file differs from planned source: ${path}`);
    }
    // All roots plus deterministic representatives of each dependency type. The
    // exact staged manifest is exhaustive; downloads are explicitly a spot check.
    const sample = new Set(plan.requiredRoots.filter(p => shard.paths.includes(p)));
    for (const extension of [/\.json$/, /\.glsl$/, /\.bin$/, /\.glb$/, /\.(png|webp)$/]) {
      const matches = shard.paths.filter(p => extension.test(p));
      for (const p of [matches[0], matches.at(-1)]) if (p) sample.add(p);
    }
    const sampled = [];
    for (const path of sample) {
      const response = await fetcher(joinBase(hosts[shard.id], path));
      if (response.status !== 200) throw new Error(`Asset HTTP ${response.status}: ${path}`);
      const bytes = Buffer.from(await response.arrayBuffer()), expected = manifest.files[path];
      if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) throw new Error(`Hosted asset bytes differ: ${path}`);
      if (expected.encoding === 'gzip') {
        let source;
        try { source = gunzipSync(bytes); } catch { throw new Error(`Hosted gzip mesh does not decompress: ${path}`); }
        if (digest(source) !== plan.nodes[path].sha256) throw new Error(`Hosted gzip mesh differs from planned source: ${path}`);
      }
      if (plan.controls.includes(path)) {
        // A leaf may be republished with identical bytes at a new immutable URL.
        // Membership/hash checks alone cannot detect an old control index still
        // pointing at the previous host while direct runtime routes use the new
        // one. The fitted-body URL contract requires those identities to agree.
        const found = new Set();
        const walk = value => {
          if (typeof value === 'string' && /\.(json|glsl|bin|glb|gltf|png|webp|jpg|jpeg|ktx2)$/i.test(value))
            found.add(new URL(value, joinBase(hosts[shard.id], path)).href);
          else if (value && typeof value === 'object') Object.values(value).forEach(walk);
        };
        walk(JSON.parse(bytes));
        const canonical = plan.nodes[path].dependencies.map(p => joinBase(hosts[plan.owners[p]], p)).sort();
        if (JSON.stringify([...found].sort()) !== JSON.stringify(canonical))
          throw new Error(`Control index and runtime host mapping disagree; restage shard 0: ${path}`);
      }
      sampled.push(path);
    }
    report.push({ shard: shard.name, baseUrl: hosts[shard.id], manifestSha256: pinned,
      declaredFiles: shard.paths.length, sampled });
  }
  return { planSha256: config.planSha256, verifiedAt: new Date().toISOString(), shards: report,
    scope: 'Exact staged manifest and planned membership/hashes, with downloaded representative files. Not an exhaustive byte download or physical-device acceptance.' };
}
