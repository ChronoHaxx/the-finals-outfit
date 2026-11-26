# usage-counter: a shared, cookie-free event collector

One Cloudflare Worker that receives product events from the owner's apps and writes them to Workers Analytics Engine.
The outfit builder is its first app; WuWa VR's site and WuWa Studio are meant to join it. It lives
here until it moves to a repository of its own (`ChronoHaxx/usage-counter`); it imports nothing from this app.

The event list, what each event decides, and how to report the numbers honestly are in
[`docs/analytics-tracking-plan.md`](../../docs/analytics-tracking-plan.md).

## What it keeps, and what it never keeps

| Kept (Analytics Engine, 3 months) | Never kept |
| --- | --- |
| App, event name, form factor, build, the event's id-valued properties | IP addresses, user agents, cookies, headers, request bodies |
| On `app_loaded` only: a 64-bit visitor hash for that UTC day | Any hash that lasts beyond a day, or links two apps |

- **Visitor hash:** `SHA-256(salt | app | IP | user agent)`, first 64 bits. The salt is 32 random bytes per UTC day in
  KV (`SALTS`), expiring one hour after its day ends. A cron at 12:07 UTC writes tomorrow's salt, so every instance
  shares it from midnight. The app is in the hash, so the same person's hashes on two apps are unrelated.
- **Dropped without a trace:** `Sec-GPC: 1`, `DNT: 1`, bot user agents, origins not on an app's list, unknown events,
  extra properties, and any value that fails its pattern (`src/schema.ts`). Free text cannot pass the patterns.
- **No logs:** Workers Logs are off (`observability.enabled: false`), and the code logs nothing about a request.

## Endpoint

`POST /e`, body `text/plain` (a simple request: no CORS preflight; the app sends with `mode: "no-cors"`,
`credentials: "omit"`, `keepalive: true`):

```json
{ "app": "outfit", "schema": 1, "form_factor": "phone", "build": "abc1234",
  "events": [{ "e": "app_loaded" }, { "e": "item_equipped", "p": { "slot": "hair", "item_id": "pompadour" } }] }
```

An app whose spec says `envelope: "minimal"` may leave out `form_factor` and `build`; they are stored empty. At most 20 events and 16 KB
per request. The answer is always an empty body: 204 when accepted or dropped for privacy,
403 for an origin or envelope that is not allowed, 429 past 60 requests a minute from one address.

## Columns

Every app's rows have the same layout, so one query shape fits all:

| Column | Holds |
| --- | --- |
| `index1` | app; for the app's `visitorEvent` row, `<app>:<visitorEvent>` (for example `outfit:app_loaded`) |
| `blob1` | event |
| `blob2` | form factor: `phone`, `tablet`, `desktop` |
| `blob3` | build (7-character commit, or `dev`) |
| `blob4` | visitor hash on the app's `visitorEvent` (`app_loaded`; `page_viewed` on a multi-page site), empty otherwise |
| `blob5` to `blob8` | the event's properties, in the order `src/schema.ts` lists them |
| `double1` | 1 |

Count with `SUM(_sample_interval)`, never `count()`: Analytics Engine samples heavy traffic and records how much.
Read an app with both its index values, `IN ('<app>', '<app>:app_loaded')`. Each row is written once, under one of
them, so nothing is counted twice, and periods before and after the visit index read the same way.

```sql
-- Page loads and daily visitors for one app
SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
       SUM(_sample_interval) AS page_loads, count(DISTINCT blob4) AS visitors
FROM usage_events WHERE index1 IN ('outfit', 'outfit:app_loaded') AND blob1 = 'app_loaded'
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day ORDER BY day
```

`scripts/usage-report.mjs` runs the monthly queries and prints the metrics snapshot.

## Sampling

Analytics Engine samples at write time, separately for each index value, and is quickest to when one request writes
many points to the same one ([sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/),
[FAQ](https://developers.cloudflare.com/analytics/faq/wae-faqs/)). A sampled row stands for `_sample_interval` rows,
so weighted sums stay fair estimates. A distinct count does not: a page load whose row was dropped takes its visitor
hash with it.

At first every row used the app's name as its index, so a page load's burst of exposures could sample away its
`app_loaded` row. On 26 Nov 2026, with a few dozen rows, the outfit builder's only stored `app_loaded` row stood for
4 page loads, and WuWa VR's for up to 2. Since then each app's `visitorEvent` row is written under its own index
(`visitIndex()` in `src/index.ts`), one row per page load, never in a crowd.

- **Before the switch, visitor counts are minimums.** The report refuses any period whose page loads were sampled
  (`summarise()` in `scripts/lib/usage-report.mjs`), so report from the switch onward.
- **Other events can still be sampled.** The report then prints them as weighted estimates and says so.
- **Deployed:** not yet. This line gets the deploy's UTC time and version when the change goes live.

## Adding an app

1. Add it to `APPS` in `src/schema.ts`: its exact origins, its `visitorEvent` (the one event each page load sends
   first; `null` if its privacy promise rules out any visitor hash, so it counts page loads only), `envelope` (`"full"` or `"minimal"`), and its events, each with its properties in column order. Put
   properties every event shares (such as `page` and `lang`) first, so they land in the same columns.
   Use the shared naming scheme: `object_action`, snake_case, no app name in the event.
2. Add a test, redeploy, then ship the app's sender. Its batches must use the same envelope. The report names one
   visitor event, `app_loaded`, for every app; a test fails if an app's `visitorEvent` differs, because the report
   would then miss its page loads.

## Deploy (account-side; the maintainer runs these)

Git Bash, in `workers/usage-counter`:

```bash
npx --yes wrangler@4.131.1 kv namespace create SALTS
```

Put the printed id in `wrangler.jsonc` (the `SALTS` binding's `id`), then:

```bash
npx --yes wrangler@4.131.1 deploy
```

The Analytics Engine dataset `usage_events` is created by the first write. Note the
`https://usage-counter.<subdomain>.workers.dev` URL. Set `EVENTS_URL` in `.github/workflows/deploy.yml` to that URL
plus `/e`, and merge. Until then the app sends nothing.

For queries, create an API token with **Account Analytics: Read** only, and keep it out of the repository.

## Free-plan limits (checked 23 Nov 2026)

100,000 Analytics Engine rows and 100,000 Worker requests a day per account, shared with the account's other Workers;
10,000 queries a day; 3 months' retention; 25 rows per request. Past the request quota Cloudflare answers 429 before
the Worker runs, and the app drops those events silently.
