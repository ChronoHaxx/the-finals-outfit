// The monthly metrics snapshot (docs/analytics-tracking-plan.md, "Retention and the metrics snapshot"): the queries
// against the usage-counter dataset, and the figures made from their rows. Pure, so the arithmetic and the wording
// are tested; scripts/usage-report.mjs does the fetching.
//
// The wording is part of the contract. Daily visitors come from a daily-salted hash, so there is no weekly or monthly
// unique-visitor figure, and a sum of daily visitors is "visitor-days". A page load is not a session. Nothing here
// rounds a figure into something it is not.

export const DATASET = 'usage_events';
/** Every app's visitor event: the one row per page load that carries the visitor hash. */
export const VISIT_EVENT = 'app_loaded';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const APP = /^[a-z0-9-]{1,32}$/;

/** The index values an app's rows live under: its name, and its visit index (the collector's visitIndex()). Page loads
 *  moved to the visit index when it was added; reading both keeps every period right, before, across and after that,
 *  and nothing is counted twice because each row is written once, under one of them. */
export const appIndexes = app => [app, `${app}:${VISIT_EVENT}`];

/** The report's queries for [from, to) in UTC, `from` and `to` as YYYY-MM-DD. */
export function reportQueries(app, from, to) {
  if (!APP.test(app) || !DAY.test(from) || !DAY.test(to) || from >= to) throw new Error(`bad report period or app: ${app} ${from}..${to}`);
  const where = `index1 IN (${appIndexes(app).map(index => `'${index}'`).join(', ')}) `
    + `AND timestamp >= toDateTime('${from} 00:00:00') AND timestamp < toDateTime('${to} 00:00:00')`;
  const count = 'SUM(_sample_interval)';
  return {
    // Sampling is checked apart for page loads (visitor counts depend on every row) and for everything else (weighted
    // sums stay fair estimates).
    visitSampling: `SELECT max(_sample_interval) AS sample FROM ${DATASET} WHERE ${where} AND blob1 = '${VISIT_EVENT}' FORMAT JSON`,
    eventSampling: `SELECT max(_sample_interval) AS sample FROM ${DATASET} WHERE ${where} AND blob1 != '${VISIT_EVENT}' FORMAT JSON`,
    daily: `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ${count} AS page_loads, count(DISTINCT blob4) AS visitors `
      + `FROM ${DATASET} WHERE ${where} AND blob1 = '${VISIT_EVENT}' GROUP BY day ORDER BY day FORMAT JSON`,
    events: `SELECT blob1 AS event, blob5 AS first, ${count} AS n FROM ${DATASET} WHERE ${where} GROUP BY event, first FORMAT JSON`,
    formFactors: `SELECT blob2 AS form_factor, ${count} AS n FROM ${DATASET} WHERE ${where} AND blob1 = '${VISIT_EVENT}' `
      + `GROUP BY form_factor FORMAT JSON`,
    items: `SELECT blob5 AS slot, blob6 AS item, ${count} AS n FROM ${DATASET} WHERE ${where} AND blob1 = 'item_equipped' `
      + `GROUP BY slot, item ORDER BY n DESC LIMIT 10 FORMAT JSON`,
  };
}

const num = value => Number(value) || 0;
const pct = (part, whole) => whole ? Math.round((part / whole) * 1000) / 10 : 0;

/**
 * The figures, from each query's rows (`data` of a FORMAT JSON answer). `features` is every feature id the app has,
 * so a feature nobody used still appears, at 0, among the least used. Throws when the period's page loads were
 * sampled: then distinct visitor counts are only minimums, and a CV must not carry them. Other events may be sampled;
 * their weighted sums are reported as estimates, and the snapshot says so.
 */
export function summarise({ visitSampling, eventSampling, daily, events, formFactors, items }, features) {
  const visitSample = num(visitSampling[0]?.sample);
  if (visitSample > 1) throw new Error(`Analytics Engine sampled this period's page loads (1 row in ${visitSample}), so visitor `
    + 'counts would be minimums. Page loads were sampled with the rest before they had an index of their own '
    + '(workers/usage-counter/README.md, "Sampling", has the date). Report a period that starts after it.');
  const eventSample = Math.max(1, num(eventSampling[0]?.sample));
  const days = daily.map(row => ({ day: String(row.day).slice(0, 10), pageLoads: num(row.page_loads), visitors: num(row.visitors) }));
  const pageLoads = days.reduce((sum, d) => sum + d.pageLoads, 0);
  const visitorDays = days.reduce((sum, d) => sum + d.visitors, 0);
  const by = (event, first) => num(events.find(row => row.event === event && (first === undefined || row.first === first))?.n);
  const total = event => events.filter(row => row.event === event).reduce((sum, row) => sum + num(row.n), 0);

  const featureRows = features.map(feature => {
    const exposed = by('feature_exposed', feature), used = by('feature_used', feature);
    return { feature, exposed, used, exposureRate: pct(exposed, pageLoads), useRate: pct(used, exposed), usedPerLoad: pct(used, pageLoads) };
  });
  const ranked = [...featureRows].sort((a, b) => b.usedPerLoad - a.usedPerLoad || a.feature.localeCompare(b.feature));

  return {
    eventSample,
    days: days.length,
    pageLoads,
    visitorDays,
    averageDailyVisitors: days.length ? Math.round(visitorDays / days.length) : 0,
    peakDailyVisitors: Math.max(0, ...days.map(d => d.visitors)),
    formFactors: Object.fromEntries(formFactors.map(row => [row.form_factor, num(row.n)])),
    features: featureRows,
    top: ranked.slice(0, 5),
    bottom: ranked.slice(-5).reverse(),
    sharesCreated: total('share_link_created'),
    sharesCreatedWithPreview: by('share_link_created', 'preview'),
    shareOpens: total('share_link_opened'),
    items: items.map(row => ({ slot: row.slot, item: row.item, n: num(row.n) })),
    errors: total('error_occurred'),
  };
}

/** The snapshot section for docs/metrics.md, worded as the plan requires. */
export function snapshotMarkdown(app, from, to, s) {
  const row = f => `| \`${f.feature}\` | ${f.usedPerLoad}% | ${f.exposureRate}% | ${f.useRate}% |`;
  return [
    `### ${app}: ${from} to ${to} (UTC, end exclusive)`,
    '',
    `Source: the usage-counter dataset (\`${DATASET}\`), queried with \`scripts/usage-report.mjs\`. ` + (s.eventSample > 1
      ? `Page loads and visitors are unsampled. Analytics Engine sampled other events (up to 1 row in ${s.eventSample}), `
        + 'so feature, share, item and error counts are weighted estimates.'
      : 'Unsampled.'),
    '',
    '| Measure | Value |',
    '| --- | --- |',
    `| Page loads | ${s.pageLoads} |`,
    `| Daily visitors, average (approximate) | ${s.averageDailyVisitors} |`,
    `| Daily visitors, peak (approximate) | ${s.peakDailyVisitors} |`,
    `| Visitor-days (not unique visitors) | ${s.visitorDays} |`,
    `| Days with data | ${s.days} |`,
    `| Page loads by form factor | ${Object.entries(s.formFactors).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} |`,
    `| Share links copied | ${s.sharesCreated} (${s.sharesCreatedWithPreview} with a preview image) |`,
    `| Page loads from a share link | ${s.shareOpens} |`,
    `| Errors counted | ${s.errors} |`,
    '',
    'Daily visitors exclude visitors with GPC, DNT, the opt-out or a blocker, and count a shared IP address once. There is no',
    'weekly or monthly unique-visitor figure by design.',
    '',
    '**Most used features** (used in % of page loads; exposed in % of page loads; used when exposed):',
    '',
    '| Feature | Used | Exposed | Use rate |', '| --- | --- | --- | --- |', ...s.top.map(row),
    '',
    '**Least used features:**',
    '',
    '| Feature | Used | Exposed | Use rate |', '| --- | --- | --- | --- |', ...s.bottom.map(row),
    '',
    '**Most picked items** (a pick is a try-on, not a final outfit):',
    '',
    '| Slot | Item | Picks |', '| --- | --- | --- |', ...s.items.map(i => `| ${i.slot} | \`${i.item}\` | ${i.n} |`),
    '',
  ].join('\n');
}
