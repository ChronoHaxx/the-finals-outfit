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
below, newest first, unedited. The script refuses a period whose page loads were sampled rather than print visitor
counts that are only minimums. Where other events were sampled, the snapshot says those figures are weighted estimates.

## Metrics snapshot

No snapshot yet. Events started on 26 Nov 2026 at 16:37 UTC. Until the collector gave page loads an index of their
own (date in `workers/usage-counter/README.md`, "Sampling"), their rows could be sampled, so visitor counts before
then are minimums, and the script refuses any period whose page loads were sampled (26 Nov was, for both apps). Start
the first snapshot on or after that date. Agent test
rows are in the dataset from 23 Nov (one) and 26 Nov 16:43–16:44 UTC (five); they cannot be deleted, so leave those
days out or subtract them. Figures here are copied from the report's output, never estimated.
