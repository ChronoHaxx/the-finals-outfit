// Emote sound checks in a real browser (12 Nov 2026). Drives the viewer with real clicks (so the browser's autoplay
// gate is passed the way a visitor passes it), samples the animation clock against the AudioContext clock every frame,
// and reports, per voice the player started, the animation time at which its audio starts versus the cue's time.
// Also: no AudioContext before a gesture, pause/scrub silence, resume mid-sound, loop wraps without double starts,
// mute remembered across a reload, console errors.
//
//   node _docs/emote-sfx-2026-11-12/check-sounds.mjs [--base=http://127.0.0.1:5192] [--browser=chrome|firefox] [--headed]
// (Git Bash or PowerShell, worktree root; serve-5192.mjs running). Writes check-<browser>.json beside this file.
import { chromium, firefox } from "playwright-core";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:5192";
const which = arg("browser") ?? "chrome";
const headless = !process.argv.includes("--headed");
const DEFAULT = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots: DEFAULT })).toString("base64url");

const browser = which === "firefox"
  ? await firefox.launch({ headless, executablePath: process.env.FIREFOX_PATH, firefoxUserPrefs: { "media.autoplay.blocking_policy": 0 } })
  : await chromium.launch({ channel: "chrome", headless });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
// A visitor, not a harness: navigator.webdriver false (else AUTOMATED turns sound off, as it must for captures).
await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (m.type() === "error" || (m.type() === "warning" && /AudioContext|sound/i.test(m.text()))) errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });

const report = { browser: which, base: BASE, checks: [], emotes: {} };
const check = (name, pass, detail) => { report.checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`); };

// 0. A link that opens on an emote plays it before the visitor has clicked anything: silent until the first click, which
// then joins the sound mid-line. (The intro dialog is up meanwhile; its button is that first click.) Playwright's
// evaluate and waitForFunction run with a user gesture, so nothing is evaluated until one read after the network shows the
// emote's clip and sounds.json have arrived.
const clipLoaded = page.waitForResponse(r => r.url().includes("HM_FrontEnd_Emotes_A_AcePilot_00.json"), { timeout: 240000 }).catch(() => null);
const soundsLoaded = page.waitForResponse(r => r.url().endsWith("sounds-1/sounds.json"), { timeout: 240000 }).catch(() => null);
await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}&emote=ace-pilot&t=1`, { waitUntil: "load", timeout: 240000 });
const sounds = "window.__rigAnim.animator.sounds";
const linked = !!(await clipLoaded) && !!(await soundsLoaded);
if (linked) {
  await page.waitForTimeout(3000);
  const before = await page.evaluate(`({ current: window.__rigAnim?.state().current, context: ${sounds}.context?.state ?? null,
    starts: ${sounds}.log.filter(e => e.event === "start" || e.event === "schedule").length })`);
  check("link before any gesture: emote playing, audio locked, nothing started",
    before.current === "ace-pilot" && before.context !== "running" && before.starts === 0, before);
}
await page.getByRole("button", { name: /Enter builder|View shared outfit/ }).first().click({ timeout: 60000 }).catch(() => {});
if (linked) {
  await page.waitForTimeout(600);
  const joined = await page.evaluate(`${sounds}.log.find(e => e.event === "start")`);
  check("first click: the playing emote's line joins mid-sound", !!joined && joined.offset > 0.5, joined);
}
await page.waitForFunction(() => !!window.__rigAnim && window.__rigIdle === true, null, { timeout: 240000 });

// Install the frame sampler: every update the animator makes, the clip time it passes and the audio clock.
await page.evaluate(() => {
  const s = window.__rigAnim.animator.sounds;
  window.__soundSamples = [];
  const update = s.update.bind(s);
  s.update = (clock, moving) => {
    update(clock, moving);
    if (clock && s.context) window.__soundSamples.push([clock.time, s.context.currentTime, moving ? 1 : 0, s.pass, window.__rigAnim.state().current]);
    if (window.__soundSamples.length > 20000) window.__soundSamples.splice(0, 10000);
  };
});

// The picker opens with a click; the first emote click is the gesture that unlocks audio.
const trigger = page.getByRole("button", { name: /Play an emote|Emotes/ }).first();
await trigger.click();
const dialog = page.getByRole("dialog", { name: "Emotes" });
await dialog.waitFor();
await page.waitForFunction(`${sounds}.available`, null, { timeout: 30000 });

async function playEmote(label, id) {
  if (!(await dialog.isVisible().catch(() => false))) { await trigger.click(); await dialog.waitFor(); }
  await dialog.getByRole("searchbox").fill(label);
  await dialog.getByRole("button", { name: new RegExp(label.replace(/[’']/g, ".")) }).first().click();
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

async function measure(label, id, seconds, { loop = false } = {}) {
  const loopButton = page.getByRole("button", { name: "Loop" });
  const n0 = await logLength();
  await samples();
  await playEmote(label, id);
  if (loop !== (await loopButton.getAttribute("aria-pressed").catch(() => "false") === "true")) await loopButton.click();
  const { source, duration, cues } = await cuesOf(id);
  await page.waitForTimeout(seconds * 1000);
  const rows = await samples(), log = await logSince(n0);
  const starts = log.filter(e => e.event === "start" || e.event === "schedule");
  const timing = starts.map(e => {
    const [cue, pass] = e.key.split(":").map(Number), c = cues[cue];
    const at = clipTimeAt(rows, e.at - e.offset / 1, duration, id); // the clip time where this voice's offset 0 would sit
    return { key: e.key, wave: e.wave, cue: c?.start, offset: +e.offset.toFixed(4), scheduled: e.event === "schedule",
      errorMs: at && c ? +(((at.time - pass * duration) - c.start) * 1000).toFixed(1) : null, clockRate: at && +at.slope.toFixed(4) };
  });
  const perKey = {};
  for (const e of starts) perKey[e.key] = (perKey[e.key] ?? 0) + 1;
  report.emotes[id] = { source, duration, cues: cues.length, timing, events: log.reduce((m, e) => ({ ...m, [e.event]: (m[e.event] ?? 0) + 1 }), {}),
    restarts: log.filter(e => e.event === "restart").length, adopts: log.filter(e => e.event === "adopt").length };
  return { timing, perKey, log, duration, cues };
}

// 1. Single window (Valkyria's Embrace): starts once, at its cue time.
let r = await measure("Valkyria", "ace-pilot", 2);
check("ace-pilot: one voice, scheduled, within 10 ms of its cue", r.timing.length === 1 && r.timing[0].scheduled && Math.abs(r.timing[0].errorMs) <= 10, r.timing);
const latency = await page.evaluate(`({ state: ${sounds}.context.state, sampleRate: ${sounds}.context.sampleRate, base: ${sounds}.context.baseLatency, output: ${sounds}.context.outputLatency })`);
report.audio = latency;

// 2. Eight cues incl. a 5-way random one (BlackSmith), the whole clip.
r = await measure("BlackSmith", "black-smith", 10.6);
const errs = r.timing.map(t => t.errorMs).filter(e => e !== null);
// Within one clip frame (33 ms at 30 fps): an emote's first frames can hitch (its props load), and the frame step cap then
// drops animation time while the audio clock runs on (measured: -30 ms once, -4 ms on another run, for the 0.14 s cue).
check("black-smith: each cue once (3 voice-tag notifies have no sound), all within one clip frame", r.timing.length === r.cues.length && Object.values(r.perKey).every(n => n === 1) && errs.every(e => Math.abs(e) <= 34),
  { started: r.timing.length, cues: r.cues.length, errorsMs: errs });

// 3. Instant cues ring out; with Loop on, the last one (6.87 s of 7.33 s) crosses the wrap; each pass starts each cue once.
r = await measure("Time to Get Serious", "finger-crack", 7.333 * 2 + 2.2, { loop: true });
// 16.9 s of wall time = two passes and ~2 s of the third: 3 + 3 + 2 cue starts (0.48 s and 1.54 s of the third pass).
check("finger-crack looped: 8 starts over 2+ passes, each once, within 10 ms, no restarts", Object.values(r.perKey).every(n => n === 1) && r.timing.length === 8
  && report.emotes["finger-crack"].restarts === 0 && r.timing.every(t => t.errorMs !== null && Math.abs(t.errorMs) <= 10),
  { keys: Object.keys(r.perKey), errorsMs: r.timing.map(t => t.errorMs) });
check("finger-crack: once cues are never stopped by the wraps", !r.log.some(e => e.event === "stop"), r.log.filter(e => e.event === "stop"));

// 4. Pause, scrub, resume mid-sound (Valkyria again: one 6.4 s line).
await playEmote("Valkyria", "ace-pilot");
await page.getByRole("button", { name: "Loop" }).click(); // back to play-once
await page.waitForTimeout(2000);
let n0 = await logLength();
const bar = page.getByRole("group", { name: /timeline/ });
await bar.getByRole("button", { name: "Pause" }).click();
await page.waitForTimeout(300);
let voices = await page.evaluate(`${sounds}.voices.size`);
let log = await logSince(n0);
check("pause: voice stopped at once, none live", voices === 0 && log.some(e => e.event === "stop"), { voices, log: log.map(e => e.event) });
const slider = page.getByRole("slider", { name: /frame/ });
const box = await slider.boundingBox();
n0 = await logLength();
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
await page.mouse.down();
for (let i = 0; i <= 10; i++) { await page.mouse.move(box.x + box.width * (0.3 + i * 0.03), box.y + box.height / 2); await page.waitForTimeout(40); }
await page.mouse.up();
await page.waitForTimeout(300);
log = await logSince(n0);
check("scrub: silent (no voice starts while dragging or held)", !log.some(e => e.event === "start" || e.event === "schedule"), log.map(e => e.event));
const held = await page.evaluate(() => window.__rigAnim.animator.timeline().time);
n0 = await logLength();
await samples();
await page.getByRole("group", { name: /timeline/ }).getByRole("button", { name: "Play" }).click();
await page.waitForTimeout(800);
log = await logSince(n0);
const resumed = log.find(e => e.event === "start");
check("resume: the line restarts mid-sound at the held time's offset (within 50 ms), once",
  !!resumed && log.filter(e => e.event === "start").length === 1 && Math.abs(resumed.offset - (resumed.clipTime - 0.2484)) < 0.05 && Math.abs(resumed.clipTime - held) < 0.1,
  { held, start: resumed });

// 5. A covering musical window looped (CPop 04): one voice across wraps.
r = await measure("CPop 04", "c-pop-04", 7 * 2 + 1, { loop: true });
check("c-pop-04 looped: one music voice carried across two wraps", report.emotes["c-pop-04"].adopts === 2 && r.timing.length === 1, report.emotes["c-pop-04"]);

// 6. An instrument (Jester Lute, 18.9 s) looped across one wrap, from a seek near its end.
await playEmote("Jester Lute", "jester-lute");
if (await page.getByRole("button", { name: "Loop" }).getAttribute("aria-pressed") !== "true") await page.getByRole("button", { name: "Loop" }).click();
await page.evaluate(() => window.__rigAnim.animator.seek(17.9, { inspect: true }));
n0 = await logLength();
await samples();
await page.getByRole("group", { name: /timeline/ }).getByRole("button", { name: "Play" }).click();
await page.waitForTimeout(2200);
log = await logSince(n0);
const rows = await samples();
const lute = log.filter(e => e.event === "schedule" || e.event === "start");
const luteAt = lute[0] && clipTimeAt(rows, lute[0].at, 18.867, "jester-lute");
check("jester-lute: the next pass's track is scheduled at 0.333 s of the new pass, from the top",
  lute.length === 1 && lute[0].event === "schedule" && lute[0].offset === 0 && !!luteAt && Math.abs((luteAt.time % 18.867) - 0.3333) < 0.01,
  { lute, at: luteAt });
await page.getByRole("button", { name: "Loop" }).click();
await page.getByRole("button", { name: "Close the emote" }).click();
await page.waitForTimeout(300);
check("close: nothing left playing", await page.evaluate(`${sounds}.voices.size === 0`));

// 7. Decoded length vs source (does this browser trim the AAC priming?).
report.decode = await page.evaluate(async () => {
  const s = window.__rigAnim.animator.sounds, out = [];
  for (const wave of ["Emotes_FrontEnd_AcePilot", "Emotes_FrontEnd_CPop_Mix1", "Emote_FrontEnd_Jester_Lute"]) {
    const info = s.resolved.files[wave];
    const bytes = await (await fetch(new URL(info.file, new URL(s.url, location.href)))).arrayBuffer();
    const buffer = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(bytes);
    out.push({ wave, source: info.duration, decoded: +buffer.duration.toFixed(5), extraMs: +((buffer.duration - info.duration) * 1000).toFixed(2) });
  }
  return out;
});
check("decoded AAC length matches the source within 2 ms (priming trimmed)", report.decode.every(d => Math.abs(d.extraMs) <= 2), report.decode);

// 8. Mute is remembered across a reload; muted, no wave is fetched.
await playEmote("Valkyria", "ace-pilot");
await page.getByRole("button", { name: "Sound" }).click();
const saved = await page.evaluate(() => localStorage.getItem("finals-outfit.emote-sound"));
check("mute click saves {muted:true}", JSON.parse(saved ?? "{}").muted === true, saved);
await page.reload({ waitUntil: "load" });
await page.getByRole("button", { name: /Enter builder|View shared outfit/ }).first().click({ timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => !!window.__rigAnim && window.__rigIdle === true, null, { timeout: 240000 });
const fetchedWaves = [];
page.on("request", q => { if (q.url().endsWith(".m4a")) fetchedWaves.push(q.url()); });
await trigger.click();
await dialog.waitFor();
await playEmote("BlackSmith", "black-smith");
await page.waitForTimeout(1500);
check("after reload: still muted, no audio downloaded, no voices", await page.evaluate(`${sounds}.settings.muted && ${sounds}.voices.size === 0`) && fetchedWaves.length === 0, { fetchedWaves: fetchedWaves.length });
await page.keyboard.press("Escape").catch(() => {});
const timelineSound = page.getByRole("button", { name: "Sound" });
await timelineSound.click(); // unmute: joins mid-sound
await page.waitForTimeout(1200);
check("unmute mid-emote: audio joins (a voice starts)", await page.evaluate(`${sounds}.log.some(e => e.event === "start")`));
await timelineSound.click(); // leave the visitor's setting muted? no: restore the default for the next run
await page.evaluate(() => localStorage.removeItem("finals-outfit.emote-sound"));

check("no console errors or audio warnings", errors.length === 0, errors);
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), `check-${which}.json`), JSON.stringify(report, null, 1));
await browser.close();
process.exitCode = report.checks.every(c => c.pass) ? 0 : 1;
