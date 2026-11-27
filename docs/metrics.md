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
own, on 26 Nov 2026 at 23:56:47 UTC (`workers/usage-counter/README.md`, "Sampling"), their rows could be sampled, so
visitor counts before then are minimums, and the script refuses any period whose page loads were sampled (26 Nov was,
for both apps). Start the first snapshot on 27 Nov 2026 or later.

Agent test rows are in the dataset and cannot be deleted, so leave those days out or subtract them. All are desktop:

- 23 Nov: one `outfit` `app_loaded` (build `dev`).
- 26 Nov 16:43–16:44 UTC: five, the post-merge live check. `outfit`: `app_loaded` and `tour_offered`. `wuwa-vr`: two
  `app_loaded` and one `guide_section_reached`.
- 26 Nov 23:57–23:58 UTC: five, the check after the visit-index deploy. The same events, with `app_loaded` now under
  `outfit:app_loaded` and `wuwa-vr:app_loaded`.

Figures here are copied from the report's output, never estimated.
