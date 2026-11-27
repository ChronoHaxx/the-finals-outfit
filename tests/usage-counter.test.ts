import { test } from "node:test";
import assert from "node:assert/strict";
import worker, {
  clearSaltCache, collect, MAX_BODY, prepareSalts, SALT_GRACE_S, utcDay, type DataPoint, type Env,
} from "../workers/usage-counter/src/index";
import { APPS, BATCH_MAX as BATCH_MAX_ROWS, checkEvent, id } from "../workers/usage-counter/src/schema";
import { APP_ID, BATCH_MAX, SCHEMA, type EventProps } from "../src/lib/track";

class MemoryKV {
  values = new Map<string, { value: string; expiration?: number }>();
  async get(key: string) { return this.values.get(key)?.value ?? null; }
  async put(key: string, value: string, options: { expiration?: number } = {}) { this.values.set(key, { value, ...options }); }
}
class MemoryDataset {
  rows: DataPoint[] = [];
  writeDataPoint(point: DataPoint) { this.rows.push(point); }
}
function env(): Env & { EVENTS: MemoryDataset; SALTS: MemoryKV } {
  clearSaltCache();
  return { EVENTS: new MemoryDataset(), SALTS: new MemoryKV() };
}

const ORIGIN = "https://chronohaxx.github.io";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const NOON = Date.parse("2026-11-23T12:00:00Z");

function post(events: unknown[], { origin = ORIGIN as string | null, ip = "203.0.113.7", ua = CHROME, headers = {} as Record<string, string>,
  envelope = {} as Record<string, unknown> } = {}) {
  const body = JSON.stringify({ app: APP_ID, schema: SCHEMA, form_factor: "phone", build: "abc1234", ...envelope, events });
  return new Request("https://usage-counter.example.workers.dev/e", { method: "POST", body,
    headers: { "Content-Type": "text/plain", "User-Agent": ua, "CF-Connecting-IP": ip, ...(origin ? { Origin: origin } : {}), ...headers } });
}

test("a batch becomes one row per event in fixed columns; only app_loaded carries the visitor hash", async () => {
  const e = env();
  const res = await collect(post([{ e: "app_loaded" }, { e: "item_equipped", p: { slot: "upperBody", item_id: "knight-tunic" } },
    { e: "share_link_created", p: { kind: "preview", has_pose: true, has_camera: false, has_lighting: false } }]), e, NOON);
  assert.equal(res.status, 204);
  assert.equal(e.EVENTS.rows.length, 3);
  const [loaded, item, share] = e.EVENTS.rows;
  assert.deepEqual(loaded.indexes, ["outfit:app_loaded"]);
  assert.deepEqual([item.indexes, share.indexes], [["outfit"], ["outfit"]]);
  assert.match(loaded.blobs![3], /^[0-9a-f]{16}$/, "64-bit visitor hash");
  assert.deepEqual(item.blobs, ["item_equipped", "phone", "abc1234", "", "upperBody", "knight-tunic"]);
  assert.deepEqual(share.blobs, ["share_link_created", "phone", "abc1234", "", "preview", "true", "false", "false"]);
});

test("the IP address and user agent are never written, in any column", async () => {
  const e = env();
  await collect(post([{ e: "app_loaded" }, { e: "feature_used", p: { feature: "emotes" } }], { ip: "198.51.100.23" }), e, NOON);
  const written = JSON.stringify(e.EVENTS.rows);
  assert.ok(!written.includes("198.51.100.23") && !written.includes("Chrome/131"));
});

test("the visitor hash is stable within a UTC day, and differs by app, by day and by address", async () => {
  const hashOf = async (e: ReturnType<typeof env>, at: number, opts = {}) => {
    e.EVENTS.rows = [];
    await collect(post([{ e: "app_loaded" }], opts), e, at);
    return e.EVENTS.rows[0].blobs![3];
  };
  const e = env();
  const morning = await hashOf(e, Date.parse("2026-11-23T08:00:00Z"));
  assert.equal(await hashOf(e, Date.parse("2026-11-23T23:59:00Z")), morning);
  assert.notEqual(await hashOf(e, Date.parse("2026-11-24T00:01:00Z")), morning, "a new day is a new salt");
  assert.notEqual(await hashOf(e, Date.parse("2026-11-23T09:00:00Z"), { ip: "203.0.113.8" }), morning);
  // Another app, same person, same day: unrelated hashes, so the apps' data cannot be joined.
  const otherApp = await (async () => {
    const { visitorHash, saltFor } = await import("../workers/usage-counter/src/index");
    return visitorHash(await saltFor(e, "2026-11-23"), "portfolio", "203.0.113.7", CHROME);
  })();
  assert.notEqual(otherApp, morning);
});

test("a salt is random, never the date, and expires an hour after its day ends", async () => {
  const e = env();
  await prepareSalts(e, NOON);
  const today = e.SALTS.values.get("salt:2026-11-23")!, tomorrow = e.SALTS.values.get("salt:2026-11-24")!;
  assert.match(today.value, /^[0-9a-f]{64}$/);
  assert.notEqual(today.value, tomorrow.value);
  assert.equal(today.expiration, Date.parse("2026-11-24T00:00:00Z") / 1000 + SALT_GRACE_S);
  assert.equal(tomorrow.expiration, Date.parse("2026-11-25T00:00:00Z") / 1000 + SALT_GRACE_S);
  // The cron keeps what exists: running twice never swaps a salt mid-day.
  await prepareSalts(e, NOON + 3_600_000);
  assert.equal(e.SALTS.values.get("salt:2026-11-23")!.value, today.value);
  assert.equal(utcDay(Date.parse("2026-11-23T23:59:59Z")), "2026-11-23");
});

test("the cron's salt is the one requests use", async () => {
  const e = env();
  await prepareSalts(e, NOON - 86_400_000); // yesterday's run made today's salt
  const { visitorHash } = await import("../workers/usage-counter/src/index");
  await collect(post([{ e: "app_loaded" }]), e, NOON);
  assert.equal(e.EVENTS.rows[0].blobs![3], await visitorHash(e.SALTS.values.get("salt:2026-11-23")!.value, "outfit", "203.0.113.7", CHROME));
});

test("Global Privacy Control, Do Not Track and bots are dropped without a row", async () => {
  for (const options of [{ headers: { "Sec-GPC": "1" } }, { headers: { DNT: "1" } },
    { ua: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)" }, { ua: "HeadlessChrome/131.0" }, { ua: "" }]) {
    const e = env();
    const res = await collect(post([{ e: "app_loaded" }], options), e, NOON);
    assert.equal(res.status, 204);
    assert.equal(e.EVENTS.rows.length, 0, JSON.stringify(options));
    assert.equal(e.SALTS.values.size, 0, "not even a salt is made for them");
  }
});

test("other origins, unknown apps and malformed envelopes are refused", async () => {
  const cases: Parameters<typeof post>[1][] = [
    { origin: "https://evil.example" }, { origin: null }, { envelope: { app: "nope" } }, { envelope: { schema: 2 } },
    { envelope: { form_factor: "watch" } }, { envelope: { build: "not a build" } },
  ];
  for (const options of cases) {
    const e = env();
    assert.equal((await collect(post([{ e: "app_loaded" }], options), e, NOON)).status, 403, JSON.stringify(options));
    assert.equal(e.EVENTS.rows.length, 0);
  }
  const e = env();
  assert.equal((await collect(post(Array(BATCH_MAX_ROWS + 1).fill({ e: "tour_offered" })), e, NOON)).status, 403);
  const big = new Request("https://x.example/e", { method: "POST", body: "x".repeat(MAX_BODY + 1),
    headers: { Origin: ORIGIN, "User-Agent": CHROME } });
  assert.equal((await collect(big, e, NOON)).status, 413);
  assert.equal((await worker.fetch(new Request("https://x.example/other"), e)).status, 404);
  assert.equal((await worker.fetch(new Request("https://x.example/e"), e)).status, 405);
});

test("free text cannot get through: an event with a bad value or an extra property is dropped on its own", async () => {
  const e = env();
  await collect(post([
    { e: "item_equipped", p: { slot: "upperBody", item_id: "my name is Sam" } },
    { e: "item_equipped", p: { slot: "upperBody", item_id: "https://example.com/x" } },
    { e: "item_equipped", p: { slot: "upperBody", item_id: "knight-tunic", note: "hi" } },
    { e: "feature_used", p: { feature: "x".repeat(49) } },
    { e: "error_occurred", p: { kind: "TypeError: cannot read 'o' of undefined" } },
    { e: "made_up_event" },
    { e: "feature_used", p: { feature: "emotes" } },
  ]), e, NOON);
  assert.deepEqual(e.EVENTS.rows.map(row => row.blobs![0]), ["feature_used"]);
});

test("a rate-limited client writes nothing", async () => {
  const e = { ...env(), IP_LIMIT: { limit: async () => ({ success: false }) } };
  assert.equal((await collect(post([{ e: "app_loaded" }]), e, NOON)).status, 429);
  assert.equal(e.EVENTS.rows.length, 0);
});

test("the app's batches fit the collector, and every event the app can send is in the collector's schema", () => {
  assert.ok(BATCH_MAX <= BATCH_MAX_ROWS);
  // One valid example per event the app's types allow: if either side changes alone, this fails.
  const examples: { [E in keyof EventProps]: EventProps[E] } = {
    app_loaded: {}, share_link_opened: { has_pose: false, has_camera: true, has_lighting: false },
    share_link_created: { kind: "plain", has_pose: false, has_camera: false, has_lighting: true },
    item_equipped: { slot: "hair", item_id: "pompadour" }, in_game_outfit_equipped: { outfit_id: "paperhead-01" },
    emote_played: { emote_id: "cn-wave", mode: "chinals" }, lighting_preset_changed: { kind: "scene", preset: "s12-menu" },
    camera_view_saved: {}, screenshot_exported: { scale: 2, transparent: true },
    video_exported: { format: "png_frames", source: "take" }, tour_offered: {},
    tour_started: { from: "replay", entry: "guide" }, tour_completed: {}, tour_skipped: { stop: "lighting" },
    hint_shown: { hint: "pause-share" }, hint_used: { hint: "emote-keys" },
    feature_exposed: { feature: "video-mov", via: "guided" }, feature_used: { feature: "hide-ui" },
    error_occurred: { kind: "uncaught" },
  };
  assert.deepEqual(Object.keys(examples).sort(), Object.keys(APPS.outfit.events).sort());
  for (const [e, p] of Object.entries(examples))
    assert.ok(checkEvent("outfit", Object.keys(p).length ? { e, p } : { e }), e);
});

test("a minimal-envelope app may leave out form factor and build, and names its own visitor event", async () => {
  const e = env();
  const apps = APPS as Record<string, (typeof APPS)[string]>;
  apps["test-site"] = { origins: [ORIGIN], visitorEvent: "page_viewed", envelope: "minimal",
    events: { page_viewed: [["lang", id]], guide_section_reached: [["section", id], ["lang", id]] } };
  try {
    const body = JSON.stringify({ app: "test-site", schema: 1, events: [
      { e: "page_viewed", p: { lang: "en" } }, { e: "guide_section_reached", p: { section: "install", lang: "en" } }] });
    const res = await collect(new Request("https://x.example/e", { method: "POST", body,
      headers: { Origin: ORIGIN, "User-Agent": CHROME, "CF-Connecting-IP": "203.0.113.7" } }), e, NOON);
    assert.equal(res.status, 204);
    assert.deepEqual(e.EVENTS.rows.map(r => r.indexes![0]), ["test-site:page_viewed", "test-site"]);
    assert.match(e.EVENTS.rows[0].blobs![3], /^[0-9a-f]{16}$/);
    assert.deepEqual(e.EVENTS.rows[1].blobs, ["guide_section_reached", "", "", "", "install", "en"]);
    // The outfit builder's full envelope stays required for it.
    assert.equal((await collect(post([{ e: "app_loaded" }], { envelope: { form_factor: undefined } }), e, NOON)).status, 403);
  } finally { delete apps["test-site"]; }
});

test("an app with no visitor event never gets a hash, and no salt is even made for it", async () => {
  const e = env();
  const apps = APPS as Record<string, (typeof APPS)[string]>;
  apps["no-hash"] = { origins: [ORIGIN], visitorEvent: null, envelope: "minimal", events: { app_loaded: [] } };
  try {
    const body = JSON.stringify({ app: "no-hash", schema: 1, events: [{ e: "app_loaded" }] });
    await collect(new Request("https://x.example/e", { method: "POST", body,
      headers: { Origin: ORIGIN, "User-Agent": CHROME, "CF-Connecting-IP": "203.0.113.7" } }), e, NOON);
    assert.equal(e.EVENTS.rows[0].blobs![3], "");
    assert.deepEqual(e.EVENTS.rows[0].indexes, ["no-hash"], "no visitor event, so no visit index either");
    assert.equal(e.SALTS.values.size, 0);
  } finally { delete apps["no-hash"]; }
});

test("each page load's app_loaded gets an index of its own, so the burst of exposures beside it cannot sample it away", async () => {
  // A real page load's first request: app_loaded plus a run of exposures, all written in the same instant.
  const burst = [{ e: "app_loaded" }, ...["emotes", "camera", "lighting", "video-mov", "hide-ui", "share"].map(feature =>
    ({ e: "feature_exposed", p: { feature, via: "guided" } }))];
  const e = env();
  for (const ip of ["203.0.113.7", "203.0.113.8", "203.0.113.9"]) await collect(post(burst, { ip }), e, NOON);
  const visits = e.EVENTS.rows.filter(r => r.indexes![0] === "outfit:app_loaded");
  assert.equal(visits.length, 3, "one visit row per page load");
  assert.ok(visits.every(r => r.blobs![0] === "app_loaded" && /^[0-9a-f]{16}$/.test(r.blobs![3])), "every visit row carries its hash");
  assert.equal(new Set(visits.map(r => r.blobs![3])).size, 3);
  const rest = e.EVENTS.rows.filter(r => r.indexes![0] !== "outfit:app_loaded");
  assert.equal(rest.length, 18);
  assert.ok(rest.every(r => r.indexes![0] === "outfit" && r.blobs![0] === "feature_exposed" && r.blobs![3] === ""));
});

test("the report reads page loads from every app's visit index, and the old app index too", async () => {
  const { visitIndex } = await import("../workers/usage-counter/src/index");
  const { VISIT_EVENT, appIndexes } = await import("../scripts/lib/usage-report.mjs");
  for (const [app, config] of Object.entries(APPS)) {
    // The report names one visitor event for every app; an app with another would have its page loads missed.
    assert.equal(config.visitorEvent, VISIT_EVENT, app);
    assert.deepEqual(appIndexes(app), [app, visitIndex(app, VISIT_EVENT)], app);
  }
});

test("WuWa VR's events are accepted in its column layout, and its hash differs from the outfit builder's", async () => {
  const e = env();
  const body = (events: unknown[]) => JSON.stringify({ app: "wuwa-vr", schema: 1, form_factor: "tablet", build: "e295ae9", events });
  const send = (events: unknown[], origin = ORIGIN) => collect(new Request("https://x.example/e", { method: "POST", body: body(events),
    headers: { Origin: origin, "User-Agent": CHROME, "CF-Connecting-IP": "203.0.113.7" } }), e, NOON);
  await send([
    { e: "app_loaded", p: { page: "l.ja-guide", lang: "ja" } },
    { e: "download_clicked", p: { page: "index", lang: "zh-Hans", asset: "installer", placement: "hero" } },
    { e: "video_played", p: { page: "index", lang: "pt-BR", video: "-AbC_12xYz9", placement: "grid" } },
    { e: "video_played", p: { page: "index", lang: "en", video: "not a video id", placement: "grid" } },
    { e: "language_chosen", p: { page: "index", lang: "en", to: "klingon", via: "menu" } },
  ]);
  assert.deepEqual(e.EVENTS.rows.map(row => row.blobs![0]), ["app_loaded", "download_clicked", "video_played"]);
  assert.deepEqual(e.EVENTS.rows[1].blobs, ["download_clicked", "tablet", "e295ae9", "", "index", "zh-Hans", "installer", "hero"]);
  const wuwaHash = e.EVENTS.rows[0].blobs![3];
  assert.match(wuwaHash, /^[0-9a-f]{16}$/);
  await collect(post([{ e: "app_loaded" }]), e, NOON);
  assert.notEqual(e.EVENTS.rows.at(-1)!.blobs![3], wuwaHash, "same person, same day, different app: unrelated hashes");
  // An outfit-builder event is not a WuWa VR event, and a foreign origin may not send for it.
  e.EVENTS.rows = [];
  await send([{ e: "emote_played", p: { emote_id: "wave", mode: "standard" } }]);
  assert.equal(e.EVENTS.rows.length, 0);
  assert.equal((await send([{ e: "app_loaded", p: { page: "index", lang: "en" } }], "https://evil.example")).status, 403);
});

test("WuWa Studio's events are accepted from its own origin only, with the Resonator in the first property column", async () => {
  const e = env();
  const STUDIO = "https://wuwa-studio.pages.dev";
  const body = (events: unknown[]) => JSON.stringify({ app: "wuwa-studio", schema: 1, form_factor: "desktop", build: "b36e7f2", events });
  const send = (events: unknown[], origin = STUDIO) => collect(new Request("https://x.example/e", { method: "POST", body: body(events),
    headers: { Origin: origin, "User-Agent": CHROME, "CF-Connecting-IP": "203.0.113.7" } }), e, NOON);
  await send([
    { e: "app_loaded" },
    { e: "character_selected", p: { character: "cartethyia", via: "link", built: true } },
    { e: "outfit_equipped", p: { character: "changli", outfit: "changli-laurel-nymph" } },
    { e: "form_switched", p: { character: "cartethyia", form: "cartethyia-fleurdelys" } },
    { e: "animation_played", p: { character: "changli", pose: "pose_1", via: "menu" } },
    { e: "download_mode_chosen", p: { mode: "ask", via: "first_visit" } },
    { e: "feature_exposed", p: { feature: "photo_mode", via: "screen" } },
    { e: "feature_used", p: { feature: "list_search" } },
    { e: "error_occurred", p: { kind: "caught", what: "clip" } },
    // Dropped, each on its own: free text, a missing property, a value outside a list.
    { e: "feature_used", p: { feature: "Changli search" } },
    { e: "character_selected", p: { character: "changli", via: "list" } },
    { e: "studio_opened", p: { via: "keyboard shortcut" } },
  ]);
  assert.deepEqual(e.EVENTS.rows.map(row => row.blobs![0]), ["app_loaded", "character_selected", "outfit_equipped", "form_switched",
    "animation_played", "download_mode_chosen", "feature_exposed", "feature_used", "error_occurred"]);
  assert.match(e.EVENTS.rows[0].blobs![3], /^[0-9a-f]{16}$/, "app_loaded carries the day's visitor hash");
  assert.deepEqual(e.EVENTS.rows[1].blobs, ["character_selected", "desktop", "b36e7f2", "", "cartethyia", "link", "true"]);
  assert.deepEqual(e.EVENTS.rows[2].blobs, ["outfit_equipped", "desktop", "b36e7f2", "", "changli", "changli-laurel-nymph"]);
  // The outfit builder's origin may not send for it, and a preview deployment's address is not its origin.
  e.EVENTS.rows = [];
  assert.equal((await send([{ e: "app_loaded" }], ORIGIN)).status, 403);
  assert.equal((await send([{ e: "app_loaded" }], "https://6bd17241.wuwa-studio.pages.dev")).status, 403);
  assert.equal(e.EVENTS.rows.length, 0);
});
