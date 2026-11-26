# Metrics

Usage figures for THE FINALS outfit builder, from the `usage-counter` collector (the source of record; see
[`analytics-tracking-plan.md`](analytics-tracking-plan.md) for what each figure means and how to word it). Cloudflare
Web Analytics page views will not match these, and are not quoted here.

## How to update

On the first of each month, before Analytics Engine's 3-month retention drops the oldest month:

```bash
CF_ACCOUNT_ID=... CF_ANALYTICS_TOKEN=... node --import tsx scripts/usage-report.mjs
```

The token needs **Account Analytics: Read** only and stays in your shell. Paste the output under "Metrics snapshot"
below, newest first, unedited. The script refuses a sampled period rather than print unreliable visitor counts.

## Metrics snapshot

No data yet. Events start once the collector is deployed and `EVENTS_URL` is set in
`.github/workflows/deploy.yml`. Figures here are copied from the report's output, never estimated.
