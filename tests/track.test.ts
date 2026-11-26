import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyticsAllowed, analyticsOptedOut, OPT_OUT_KEY, setAnalyticsOptOut, type AnalyticsContext,
} from "../src/lib/analytics";
import {
  APP_ID, BATCH_MAX, ERROR_LIMIT, FLUSH_MS, SCHEMA, flush, formFactor, onOptOutChanged, resetTrackingForTests, track,
  trackError, trackOnce,
} from "../src/lib/track";

const production: AnalyticsContext = {
  hostname: "chronohaxx.github.io", pathname: "/the-finals-outfit/", baseUrl: "/the-finals-outfit/",
};

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

/** A page with a recording transport and a manual clock. `context` is read through the real gate. */
function page(context: Partial<AnalyticsContext> = {}, url = "https://events.example/e") {
  const sent: { url: string; body: { app: string; schema: number; events: { e: string; p?: Record<string, unknown> }[] } }[] = [];
  const timers: (() => void)[] = [];
  resetTrackingForTests({
    url,
    send: (to, body) => { sent.push({ url: to, body: JSON.parse(body) }); },
    allowed: () => analyticsAllowed({ ...production, ...context }),
    setTimer: fn => { timers.push(fn); return timers.length as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => { timers.length = 0; },
  });
  return { sent, events: () => sent.flatMap(batch => batch.body.events), fireTimer: () => timers.splice(0).forEach(fn => fn()) };
}

test("events wait in memory and leave together, with the app and schema on the envelope", () => {
  const { sent, fireTimer } = page();
  track("app_loaded");
  track("item_equipped", { slot: "hair", item_id: "pompadour" });
  assert.equal(sent.length, 0, "nothing leaves until the batch is due");
  fireTimer();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://events.example/e");
  assert.deepEqual(sent[0].body, { app: APP_ID, schema: SCHEMA, form_factor: "desktop", build: "dev", events: [
    { e: "app_loaded" },
    { e: "item_equipped", p: { slot: "hair", item_id: "pompadour" } },
  ] });
  assert.ok(FLUSH_MS <= 30_000);
});

test("a full batch leaves at once, and no request carries more than BATCH_MAX events", () => {
  const { sent } = page();
  for (let i = 0; i < BATCH_MAX * 2 + 3; i++) track("feature_used", { feature: `f${i}` });
  assert.equal(sent.length, 2, "two full batches went immediately");
  flush();
  assert.deepEqual(sent.map(batch => batch.body.events.length), [BATCH_MAX, BATCH_MAX, 3]);
  assert.ok(BATCH_MAX <= 25, "Analytics Engine writes at most 25 points per Worker request");
});

test("events without properties send none, and undefined properties are left out", () => {
  const { events } = page();
  track("tour_completed");
  track("tour_skipped", { stop: undefined as unknown as string });
  flush();
  assert.deepEqual(events(), [{ e: "tour_completed" }, { e: "tour_skipped" }]);
});

test("trackOnce sends a key once per page load; a reload (a new page) starts again", () => {
  let current = page();
  trackOnce("used:emotes", "feature_used", { feature: "emotes" });
  trackOnce("used:emotes", "feature_used", { feature: "emotes" });
  trackOnce("used:camera", "feature_used", { feature: "camera" });
  flush();
  assert.deepEqual(current.events().map(event => event.p?.feature), ["emotes", "camera"]);
  current = page();
  trackOnce("used:emotes", "feature_used", { feature: "emotes" });
  flush();
  assert.equal(current.events().length, 1);
});

test("errors are counted without any detail, at most ERROR_LIMIT per page load", () => {
  const { events } = page();
  for (let i = 0; i < ERROR_LIMIT + 4; i++) trackError(i % 2 ? "caught" : "uncaught");
  flush();
  assert.equal(events().length, ERROR_LIMIT);
  // Only the kind, from a fixed pair: never a message, stack or URL.
  assert.ok(events().every(event => event.e === "error_occurred" && Object.keys(event.p ?? {}).join() === "kind"
    && ["caught", "uncaught"].includes(String(event.p?.kind))));
});

test("nothing is sent when the visitor opted out, or sends Global Privacy Control or Do Not Track", () => {
  for (const context of [{ optedOut: true }, { globalPrivacyControl: true }, { doNotTrack: "1" }, { webdriver: true }]) {
    const { sent } = page(context);
    track("app_loaded");
    trackOnce("x", "feature_used", { feature: "items" });
    trackError();
    flush();
    assert.equal(sent.length, 0, JSON.stringify(context));
  }
});

test("nothing is sent off production or when no collector is configured", () => {
  for (const [context, url] of [[{ hostname: "localhost" }, "https://events.example/e"], [{}, ""]] as const) {
    const { sent } = page(context, url);
    track("tour_offered");
    flush();
    assert.equal(sent.length, 0);
  }
});

test("opting out mid-page drops what is waiting and stops what follows", () => {
  const store = new MemoryStorage();
  const sent: string[] = [];
  resetTrackingForTests({
    send: (_url, body) => { sent.push(body); },
    allowed: () => analyticsAllowed({ ...production, optedOut: analyticsOptedOut(store) }),
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>, clearTimer: () => {},
  });
  track("item_equipped", { slot: "hair", item_id: "pompadour" });
  assert.equal(setAnalyticsOptOut(true, store), true);
  assert.equal(store.getItem(OPT_OUT_KEY), "off");
  onOptOutChanged();
  track("emote_played", { emote_id: "wave", mode: "standard" });
  flush();
  assert.deepEqual(sent, []);
  // Opting back in removes the setting entirely: the browser then holds nothing for analytics at all.
  setAnalyticsOptOut(false, store);
  assert.equal(store.values.size, 0);
  onOptOutChanged();
  track("tour_offered");
  flush();
  assert.equal(sent.length, 1);
});

test("a transport that throws never reaches the app", () => {
  resetTrackingForTests({ send: () => { throw new Error("offline"); }, allowed: () => true });
  track("tour_offered");
  assert.doesNotThrow(() => flush());
});

test("storage that throws reads as not opted out, and refuses the write", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); } };
  assert.equal(analyticsOptedOut(broken), false);
  assert.equal(setAnalyticsOptOut(true, broken), false);
});

test("the envelope's form factor is the layout the page opened in, read once", () => {
  let width = 375;
  const sent: string[] = [];
  resetTrackingForTests({ send: (_url, body) => { sent.push(body); }, allowed: () => true,
    formFactor: () => formFactor(width), setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>, clearTimer: () => {} });
  track("app_loaded");
  width = 1440; // rotated, or the window was resized
  flush();
  track("feature_used", { feature: "camera" });
  flush();
  assert.deepEqual(sent.map(body => JSON.parse(body).form_factor), ["phone", "phone"]);
});

test("form factor follows the layout's widths", () => {
  assert.equal(formFactor(375), "phone");
  assert.equal(formFactor(800), "tablet");
  assert.equal(formFactor(1440), "desktop");
});
