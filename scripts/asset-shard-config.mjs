// Emits build/validation settings after deployment receipts are recorded. No asset
// copying, network access, deployment, or credential/account changes.
import fs from 'node:fs';
import { validateShardPlan, shardHosts, routesForShards } from './lib/asset-shards.mjs';
import { compactReconstructionRoutes } from '../src/lib/asset-routing.mjs';

const [planPath, hostsPath] = process.argv.slice(2);
if (!planPath || !hostsPath) throw new Error('Usage: asset-shard-config.mjs PLAN HOSTS');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
validateShardPlan(plan);
const config = JSON.parse(fs.readFileSync(hostsPath, 'utf8'));
const hosts = shardHosts(plan, config, { requireAll: true });
for (const shard of plan.shards)
  if (!/^[a-f0-9]{64}$/.test(config.shards[shard.name].manifestSha256 ?? ''))
    throw new Error(`Missing staged manifest receipt: ${shard.name}`);
const routes = JSON.stringify(compactReconstructionRoutes(routesForShards(plan, hosts)));
console.log(JSON.stringify({
  build: { VITE_RECONSTRUCTION_BASE: hosts[0], VITE_RECONSTRUCTION_ROUTES: routes },
  validation: { RECONSTRUCTION_BASE: hosts[0], RECONSTRUCTION_ROUTES: routes },
}, null, 2));
