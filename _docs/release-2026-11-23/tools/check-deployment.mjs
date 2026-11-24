// (12 Nov 2026 release.) One deployment's hosted manifest, headers and 404 behaviour, as on 11 Nov.
//   node check-deployment.mjs BASE EXPECTED_MANIFEST_SHA256
import { createHash } from 'node:crypto';
const [base, expected] = process.argv.slice(2);
const r = await fetch(new URL('manifest.json', base));
const bytes = Buffer.from(await r.arrayBuffer()), sha = createHash('sha256').update(bytes).digest('hex');
const m = JSON.parse(bytes);
const miss = await fetch(new URL('models/__definitely-missing__.json', base));
const out = { base, status: r.status, manifestSha256: sha, expected, manifestMatches: sha === expected,
  cors: r.headers.get('access-control-allow-origin'), cacheControl: r.headers.get('cache-control'), missingStatus: miss.status,
  manifest: { version: m.version, shard: m.shard, count: m.count } };
out.ok = out.status === 200 && out.manifestMatches && out.cors === '*' && /immutable/.test(out.cacheControl ?? '') && out.missingStatus === 404;
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
