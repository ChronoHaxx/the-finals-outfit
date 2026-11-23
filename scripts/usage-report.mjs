// Prints the monthly metrics snapshot for docs/metrics.md from the usage-counter dataset.
//
//   CF_ACCOUNT_ID=... CF_ANALYTICS_TOKEN=... node --import tsx scripts/usage-report.mjs [app] [from] [to]
//
// Defaults: app "outfit", the previous calendar month. The token needs Account Analytics: Read only; keep it in your
// shell, never in the repository. Paste the output under "Metrics snapshot" in docs/metrics.md as it is: the figures
// are the query results, and the wording is the honest one (docs/analytics-tracking-plan.md).

import { FEATURES, GUIDE_FEATURE } from '../src/data/feature-guide.ts';
import { reportQueries, snapshotMarkdown, summarise } from './lib/usage-report.mjs';

const { CF_ACCOUNT_ID: account, CF_ANALYTICS_TOKEN: token } = process.env;
if (!account || !token) {
  console.error('Set CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN (an API token with Account Analytics: Read).');
  process.exit(2);
}

const now = new Date();
const monthStart = (y, m) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
const [app = 'outfit', from = monthStart(now.getUTCFullYear(), now.getUTCMonth() - 1),
  to = monthStart(now.getUTCFullYear(), now.getUTCMonth())] = process.argv.slice(2);

async function query(sql) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: sql });
  if (!response.ok) throw new Error(`Analytics Engine answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json()).data ?? [];
}

const queries = reportQueries(app, from, to);
const rows = Object.fromEntries(await Promise.all(Object.entries(queries).map(async ([name, sql]) => [name, await query(sql)])));
const features = [...FEATURES, GUIDE_FEATURE].map(feature => feature.id);
console.log(snapshotMarkdown(app, from, to, summarise(rows, app === 'outfit' ? features : [])));
