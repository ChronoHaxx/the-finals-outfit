import { appendFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { checkSiteHealth, healthSummary } from './lib/site-health.mjs';

let failure;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const report = await checkSiteHealth({
      site: process.env.PRODUCTION_URL || undefined,
      assetsBase: process.env.ASSETS_BASE || undefined,
    });
    console.log(healthSummary(report));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, healthSummary(report));
    if (process.env.HEALTH_REPORT) writeFileSync(process.env.HEALTH_REPORT, JSON.stringify(report, null, 2));
    failure = undefined;
    break;
  } catch (error) {
    failure = error;
    console.error(`Attempt ${attempt}/3: ${error.message}`);
    if (attempt < 3) await setTimeout(5000);
  }
}
if (failure) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Site health: failed\n\n${failure.message}\n\nOpen the failed step for details.\n`);
  process.exitCode = 1;
}
