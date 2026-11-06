// Live site health check (scripts/lib/site-health.mjs). Read-only: GET/HEAD requests to the public site and its
// asset hosts.
//   npm run check:site              retries over about 10 minutes before failing (the scheduled workflow)
//   npm run check:site -- --once    a single attempt
// PRODUCTION_URL overrides the site; HEALTH_REPORT=<file> also writes the JSON report.
import { appendFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { checkSiteHealth, healthSummary } from './lib/site-health.mjs';

// A check can land while main deploys (1-6 minutes), and the page CDN caches for 10 minutes and ignores query
// strings, so cache-busting doesn't help. Retries ride out that window, and network blips, without a false alarm.
const delays = process.argv.includes('--once') ? [] : [60, 180, 360];
let failure;
for (let attempt = 0; attempt <= delays.length; attempt++) {
  try {
    const report = await checkSiteHealth({ site: process.env.PRODUCTION_URL || undefined });
    console.log(healthSummary(report));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, healthSummary(report));
    if (process.env.HEALTH_REPORT) writeFileSync(process.env.HEALTH_REPORT, JSON.stringify(report, null, 2));
    failure = undefined;
    break;
  } catch (error) {
    failure = error;
    console.error(`Attempt ${attempt + 1}/${delays.length + 1}: ${error.message}`);
    if (attempt < delays.length) await setTimeout(delays[attempt] * 1000);
  }
}
if (failure) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Site health: failed\n\n${failure.message}\n\nThe failed step's log has every attempt.\n`);
  process.exitCode = 1;
}
