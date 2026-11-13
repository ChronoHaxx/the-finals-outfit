// Chinals emote sound checks in a real browser (13 Nov 2026), adapted from _docs/emote-sfx-2026-11-12/check-sounds.mjs.
// Real clicks (the autoplay gate is passed as a visitor passes it); the animation clock is sampled against the
// AudioContext clock every frame, and each voice's start is placed on the clip timeline. Covers each kind of Chinals
// sound (MetaSound with and without a sync group, SoundCue, SoundWave, a two-layer mixer cue), a silent emote, the
// first-click unlock, and switching Global <-> Chinals without leaving audio devices behind (RigAnimator.dispose).
//
//   node _docs/chinals-sounds-2026-11-12/check-chinals-sounds.mjs [--base=http://127.0.0.1:5190] [--headed]
// (Git Bash or PowerShell, worktree root; serve-preview.mjs running with --chinals). Writes check-chrome.json beside
// this file, and a screenshot to --shot=<png> when given.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:5190";
const shot = arg("shot");
const DEFAULT = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots: DEFAULT })).toString("base64url");

const browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed") });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await context.addInitScript(() => {
  // A visitor, not a harness: navigator.webdriver false (else AUTOMATED turns sound off, as it must for captures).
  Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
  // Count the audio devices the page makes and closes: a mode switch must not leave one behind.
  const Native = window.AudioContext;
  const count = { made: 0, closed: 0 };
  window.__audioContexts = count;
  window.AudioContext = class extends Native {
    constructor(...args) { super(...args); count.made++; }
    close() { count.closed++; return super.close(); }
  };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (m.type() === "error" || (m.type() === "warning" && /AudioContext|sound/i.test(m.text()))) errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });

const report = { browser: "chrome", base: BASE, checks: [], emotes: {} };
const check = (name, pass, detail) => { report.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`); };
const sounds = "window.__rigAnim.animator.sounds";

// 0. Chinals mode from its address. The intro dialog's button is the first gesture.
const soundsLoaded = page.waitForResponse(r => r.url().endsWith("/chinals-animations/sounds-1/sounds.json"), { timeout: 240000 }).catch(() => null);
await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}#/chinals`, { waitUntil: "load", timeout: 240000 });
await page.getByRole("button", { name: /Enter builder|View shared outfit/ }).first().click({ timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => window.__rigAnim?.animator?.manifest?.edition === "chinals" && window.__rigIdle === true, null, { timeout: 240000 });
// The emote picker loads the props and sounds manifests when it opens (EmotePicker: animator.loadProps()).
const trigger = page.getByRole("button", { name: /Play an emote|Emotes/ }).first();
const dialog = page.getByRole("dialog", { name: "Emotes" });
await trigger.click();
await dialog.waitFor();
await page.waitForFunction(`${sounds}.available`, null, { timeout: 30000 }).catch(() => {});
check("Chinals mode loads the Chinals set's sounds.json from its own host", !!(await soundsLoaded)
  && await page.evaluate(`${sounds}.url.endsWith("/chinals-animations/sounds-1/sounds.json") && ${sounds}.available`),
  await page.evaluate(`${sounds}.url`));

// The frame sampler: every update the animator makes, the clip time it passes and the audio clock.
const installSampler = () => page.evaluate(() => {
  const s = window.__rigAnim.animator.sounds;
  if (s.__sampled) return;
  s.__sampled = true;
  window.__soundSamples = [];
  const update = s.update.bind(s);
  s.update = (clock, moving) => {
    update(clock, moving);
    if (clock && s.context) window.__soundSamples.push([clock.time, s.context.currentTime, moving ? 1 : 0, s.pass, window.__rigAnim.state().current]);
    if (window.__soundSamples.length > 20000) window.__soundSamples.splice(0, 10000);
  };
});
await installSampler();

async function playEmote(search, id) {
  if (!(await dialog.isVisible().catch(() => false))) { await trigger.click(); await dialog.waitFor(); }
  await dialog.getByRole("searchbox").fill(search);
  const label = await page.evaluate(i => window.__rigAnim.animator.info(i).label, id);
  await dialog.getByRole("button", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[’']/g, ".")) }).first().click();
  await page.waitForFunction(i => window.__rigAnim.state().current === i, id, { timeout: 60000 });
}
const cuesOf = id => page.evaluate(([i]) => {
  const a = window.__rigAnim.animator, info = a.info(i);
  return { source: info.source, duration: a.timeline()?.duration ?? info.duration, cues: a.sounds.resolved?.emotes[info.source] ?? [] };
}, [id]);
const logSince = n => page.evaluate(([k]) => window.__rigAnim.animator.sounds.log.slice(k), [n]);
const logLength = () => page.evaluate(`${sounds}.log.length`);
const samples = () => page.evaluate(() => window.__soundSamples.splice(0));

/** The clip time (unwrapped by pass) at which audio clock `at` falls, from the frame samples around it (least squares). */
function clipTimeAt(rows, at, duration, clip) {
  const pts = rows.filter(r => r[2] && (!clip || r[4] === clip)).map(r => [r[3] * duration + r[0], r[1]]).filter(([, c]) => Math.abs(c - at) < 0.5);
  if (pts.length < 4) return null;
  const n = pts.length, mx = pts.reduce((s, p) => s + p[1], 0) / n, my = pts.reduce((s, p) => s + p[0], 0) / n;
  const slope = pts.reduce((s, p) => s + (p[1] - mx) * (p[0] - my), 0) / pts.reduce((s, p) => s + (p[1] - mx) ** 2, 0);
  return { time: my + slope * (at - mx), slope, frames: n };
}

async function measure(search, id, seconds) {
  const n0 = await logLength();
  await samples();
  await playEmote(search, id);
  const { source, duration, cues } = await cuesOf(id);
  await page.waitForTimeout(seconds * 1000);
  const rows = await samples(), log = await logSince(n0);
  const own = new Set(cues.flatMap(c => c.variants.map(v => v.wave))); // the previous emote's voices also log here
  const mine = log.filter(e => own.has(e.wave));
  const starts = mine.filter(e => e.event === "start" || e.event === "schedule");
  const firsts = new Set();
  const timing = starts.map(e => {
    const [cue, pass] = e.key.split(":").map(Number), c = cues[cue];
    const at = clipTimeAt(rows, e.at - e.offset, duration, id); // the clip time where this voice's offset 0 would sit
    const first = !firsts.has(e.key);
    firsts.add(e.key);
    return { key: e.key, wave: e.wave, cue: c?.start, at: +e.at.toFixed(4), offset: +e.offset.toFixed(4), scheduled: e.event === "schedule",
      first, errorMs: first && at && c ? +(((at.time - pass * duration) - c.start) * 1000).toFixed(1) : null };
  });
  // The animation clock against the audio clock while this emote played: its rate, and the longest frame.
  const own_rows = rows.filter(r => r[2] && r[4] === id);
  const rate = own_rows.length > 2 ? (own_rows.at(-1)[0] - own_rows[0][0] + (own_rows.at(-1)[3] - own_rows[0][3]) * duration) / (own_rows.at(-1)[1] - own_rows[0][1]) : null;
  const longestFrame = own_rows.slice(1).reduce((m, r, i) => Math.max(m, r[1] - own_rows[i][1]), 0);
  report.emotes[id] = { source, duration, cues: cues.length, timing, events: mine.reduce((m, e) => ({ ...m, [e.event]: (m[e.event] ?? 0) + 1 }), {}),
    stops: mine.filter(e => e.event === "stop").map(e => ({ key: e.key, clipTime: e.clipTime && +e.clipTime.toFixed(3) })),
    animationRate: rate && +rate.toFixed(3), longestFrameMs: +(longestFrame * 1000).toFixed(0) };
  return { timing: timing.filter(t => t.first), restarts: timing.filter(t => !t.first), log: mine, duration, cues };
}
// Within one clip frame (33 ms at 30 fps): an emote's first frames can hitch while its props load, and the frame step
// cap then drops animation time while the audio clock runs on (PR #47's measurement, the same player).
const FRAME_MS = 34;

// 1. A MetaSound without a sync group (Ovation): one looping-template voice, at its cue.
let r = await measure("Ovation", "cn-emote-applaud", 2);
check("Ovation (MetaSound, no sync group): one voice, within one clip frame of its cue", r.timing.length === 1 && Math.abs(r.timing[0].errorMs ?? 99) <= FRAME_MS, r.timing);
if (shot) await page.screenshot({ path: shot });

// 2. The mixer cue (Drink Up, Brother!): two layers start together at 0 s.
r = await measure("Drink Up", "cn-emote-takeaway", 2);
const [a, b] = r.timing;
check("Drink Up, Brother! (mixer cue): both layers start, together, at the clip start", r.timing.length === 2 && a.key !== b.key
  && Math.abs(a.at - a.offset - (b.at - b.offset)) < 0.002 && r.timing.every(t => Math.abs(t.errorMs ?? 99) <= FRAME_MS), r.timing);

// 3. A SoundCue (Keepy-Uppy) and a SoundWave (Forced Ignition).
r = await measure("Keepy-Uppy", "cn-emote-worldcup-juggle", 1.2);
check("Keepy-Uppy (SoundCue): one voice within one clip frame", r.timing.length === 1 && Math.abs(r.timing[0].errorMs ?? 99) <= FRAME_MS, r.timing);
r = await measure("Forced Ignition", "cn-emote-checkered-dissun", 1.2);
check("Forced Ignition (SoundWave): one voice within one clip frame", r.timing.length === 1 && Math.abs(r.timing[0].errorMs ?? 99) <= FRAME_MS, r.timing);

// 4. The synced musical MetaSound (Floating Greeting), played through: its window ends before the clip, with a stop.
r = await measure("Floating Greeting", "cn-emote-midautumnfestival-01", 10.8);
const mid = report.emotes["cn-emote-midautumnfestival-01"];
check("Floating Greeting (synced MetaSound): one voice at its cue, stopped near its window end (10.21 s)",
  r.timing.length === 1 && Math.abs(r.timing[0].errorMs ?? 99) <= FRAME_MS && !!mid.stops.at(-1) && Math.abs(mid.stops.at(-1).clipTime - (0.1445 + 10.0676)) < 0.1, mid);
// PR #47's drift rule restarts a long voice the animation has fallen > 0.25 s behind (frames over RigAnimator's 0.1 s
// cap). That is by design; a restart with the animation keeping time would be a bug.
check("Floating Greeting: restarted only if the animation fell behind real time", r.restarts.length === 0 || (mid.animationRate ?? 1) < 0.97,
  { restarts: r.restarts.length, animationRate: mid.animationRate, longestFrameMs: mid.longestFrameMs });

// 5. A silent emote (Gacha_01): no sound control, nothing plays.
await playEmote("Gacha", "cn-emote-gacha-01");
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(800);
check("Gacha_01 (no sound in the game): no Sound button, no voice",
  await page.getByRole("button", { name: "Sound" }).count() === 0 && await page.evaluate(`!${sounds}.hasSound("HM_Frontend_Emotes_A_Gachapon_00") && ${sounds}.voices.size === 0`));

// 6. Decoded length vs source for Chinals waves (the AAC priming is trimmed).
report.decode = await page.evaluate(async () => {
  const s = window.__rigAnim.animator.sounds, out = [];
  for (const wave of ["Emotes_Frontend_A_Applaud_00", "FX_HM_Frontend_Emotes_A_TakeAway_Foley", "Emotes_FrontEnd_MidAutumn"]) {
    const info = s.resolved.files[wave];
    const bytes = await (await fetch(new URL(info.file, new URL(s.url, location.href)))).arrayBuffer();
    const buffer = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(bytes);
    out.push({ wave, source: info.duration, decoded: +buffer.duration.toFixed(5), extraMs: +((buffer.duration - info.duration) * 1000).toFixed(2) });
  }
  return out;
});
check("decoded AAC length matches the source within 2 ms", report.decode.every(d => Math.abs(d.extraMs) <= 2), report.decode);

// 7. Switching Global <-> Chinals three times, playing an emote with sound in each: each mode uses its own sounds, and
// at most one audio device is open at the end (a discarded animator's sounds must not make a new one on the next click).
const versions = page.getByRole("group", { name: "Game version" });
const switches = [];
for (let i = 0; i < 3; i++) {
  await page.keyboard.press("Escape").catch(() => {});
  await versions.getByRole("button", { name: "Global" }).click();
  await page.waitForFunction(() => window.__rigAnim?.animator?.manifest && window.__rigAnim.animator.manifest.edition !== "chinals" && window.__rigIdle === true, null, { timeout: 120000 });
  await installSampler();
  let n0 = await logLength();
  await playEmote("Valkyria", "ace-pilot");
  await page.waitForTimeout(1200);
  const globalStarted = (await logSince(n0)).some(e => e.event === "start" || e.event === "schedule");
  const globalUrl = await page.evaluate(`${sounds}.url`);
  await page.keyboard.press("Escape").catch(() => {});
  await versions.getByRole("button", { name: /Chinals/ }).click();
  await page.waitForFunction(() => window.__rigAnim?.animator?.manifest?.edition === "chinals" && window.__rigIdle === true, null, { timeout: 120000 });
  await installSampler();
  n0 = await logLength();
  await playEmote("Ovation", "cn-emote-applaud");
  await page.waitForTimeout(1200);
  const chinalsStarted = (await logSince(n0)).some(e => e.event === "start" || e.event === "schedule");
  await page.mouse.click(5, 940); // one more plain click: the old objects' listeners would make their contexts here
  await page.waitForTimeout(400);
  switches.push({ globalUrl: globalUrl.replace(BASE, ""), globalStarted, chinalsStarted, contexts: await page.evaluate(() => ({ ...window.__audioContexts })) });
}
const last = switches.at(-1).contexts;
check("mode switches: each mode plays its own sounds", switches.every(s => s.globalStarted && s.chinalsStarted && s.globalUrl.startsWith("/animations/")), switches);
check("mode switches: at most one audio device open (made - closed <= 1)", last.made - last.closed <= 1, switches.map(s => s.contexts));

check("no console errors or audio warnings", errors.length === 0, errors);
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "check-chrome.json"), JSON.stringify(report, null, 1));
await browser.close();
process.exitCode = report.checks.every(c => c.pass) ? 0 : 1;
