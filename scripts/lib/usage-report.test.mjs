import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportQueries, snapshotMarkdown, summarise } from './usage-report.mjs';

const rows = {
  sampling: [{ sample: 1 }],
  daily: [
    { day: '2026-12-01 00:00:00', page_loads: '40', visitors: '30' },
    { day: '2026-12-02 00:00:00', page_loads: '60', visitors: '50' },
  ],
  events: [
    { event: 'feature_exposed', first: 'emotes', n: '90' }, { event: 'feature_used', first: 'emotes', n: '45' },
    { event: 'feature_exposed', first: 'camera', n: '100' }, { event: 'feature_used', first: 'camera', n: '5' },
    { event: 'share_link_created', first: 'plain', n: '3' }, { event: 'share_link_created', first: 'preview', n: '7' },
    { event: 'share_link_opened', first: 'true', n: '4' }, { event: 'share_link_opened', first: 'false', n: '8' },
    { event: 'error_occurred', first: 'caught', n: '2' },
  ],
  formFactors: [{ form_factor: 'phone', n: '55' }, { form_factor: 'desktop', n: '45' }],
  items: [{ slot: 'hair', item: 'pompadour', n: '12' }],
};

test('figures come straight from the rows: page loads, visitor-days, average and peak daily visitors', () => {
  const s = summarise(rows, ['emotes', 'camera', 'video-mov']);
  assert.equal(s.pageLoads, 100);
  assert.equal(s.visitorDays, 80);
  assert.equal(s.averageDailyVisitors, 40);
  assert.equal(s.peakDailyVisitors, 50);
  assert.equal(s.sharesCreated, 10);
  assert.equal(s.sharesCreatedWithPreview, 7);
  assert.equal(s.shareOpens, 12);
  assert.equal(s.errors, 2);
});

test('features rank by use per page load, and a feature nobody used still appears among the least used', () => {
  const s = summarise(rows, ['emotes', 'camera', 'video-mov']);
  assert.deepEqual(s.top.map(f => f.feature), ['emotes', 'camera', 'video-mov']);
  assert.equal(s.bottom[0].feature, 'video-mov');
  assert.deepEqual(s.bottom[0], { feature: 'video-mov', exposed: 0, used: 0, exposureRate: 0, useRate: 0, usedPerLoad: 0 });
  const camera = s.features.find(f => f.feature === 'camera');
  // Seen on every page load, used on 5 in 100: exposure is opportunity; the use rate is what matters.
  assert.equal(camera.exposureRate, 100);
  assert.equal(camera.useRate, 5);
});

test('a sampled period is refused rather than reported', () => {
  assert.throws(() => summarise({ ...rows, sampling: [{ sample: 10 }] }, []), /sampled/);
});

test('the snapshot never calls visitor-days unique visitors, and says there is no monthly unique figure', () => {
  const md = snapshotMarkdown('outfit', '2026-12-01', '2027-01-01', summarise(rows, ['emotes', 'camera']));
  assert.match(md, /Visitor-days \(not unique visitors\) \| 80/);
  assert.match(md, /no\s+weekly or monthly unique-visitor figure/);
  assert.doesNotMatch(md, /monthly (active )?users|unique users|sessions/i);
});

test('queries accept only a plain app id and real dates, so nothing can be injected into the SQL', () => {
  const q = reportQueries('outfit', '2026-12-01', '2027-01-01');
  assert.match(q.daily, /index1 = 'outfit'/);
  assert.match(q.daily, /count\(DISTINCT blob4\)/);
  assert.ok(Object.values(q).every(sql => sql.includes('_sample_interval') || sql.includes('max(')));
  for (const [app, from, to] of [["outfit' OR 1=1 --", '2026-12-01', '2027-01-01'], ['outfit', '2026-12-1', '2027-01-01'],
    ['outfit', '2027-01-01', '2026-12-01']])
    assert.throws(() => reportQueries(app, from, to));
});
