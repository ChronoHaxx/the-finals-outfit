import fs from 'node:fs';
import { verifyShardRelease } from './lib/verify-shards.mjs';
const [planPath, hostsPath, reportPath] = process.argv.slice(2);
if (!planPath || !hostsPath) throw new Error('Usage: validate-asset-shards.mjs PLAN HOSTS [REPORT.json]');
if (reportPath && fs.existsSync(reportPath)) throw new Error('Preserve the previous report; choose a new output path');
const report = await verifyShardRelease(JSON.parse(fs.readFileSync(planPath, 'utf8')), JSON.parse(fs.readFileSync(hostsPath, 'utf8')));
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
