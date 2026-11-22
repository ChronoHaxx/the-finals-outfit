// The functional checklist's steps 1-6 (functional-checklist.md), driven by the agent on the owner's waiver as relayed
// by the coordinator (22 Nov). Visitor path: navigator.webdriver masked, so the idle autoplays, sound plays and the
// welcome dialog opens as for a person. Clicks the controls the checklist names, zooms on the face as a person would
// (right-drag to pan the face to the middle, then the mouse wheel), and measures the face's bones: each driven FACIAL_*
// bone's angle from its rest pose (0 when the face is off), the jaw and the upper eyelids by name.
//
//   node _docs/chinals-faces-2026-11-21/user-steps.mjs   (worktree root; the production build served on port 4357:
//   npx vite preview --outDir scripts/generated/chinals-faces-2026-11-21/prod/dist --base /the-finals-outfit/ --port 4357)
//     APP_URL=<url>   default http://127.0.0.1:4357/the-finals-outfit/
import fs from "node:fs";
import path from "node:path";
const { chromium } = await import("playwright-core");
const APP = process.env.APP_URL ?? "http://127.0.0.1:4357/the-finals-outfit/";
const CHINALS = "7c9add72", GLOBAL = "fd946744";
const shots = path.resolve("scripts/generated/chinals-faces-2026-11-21/user-steps");
fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
// TRACE=1: PR #69's clip-switch trace (_docs/emote-early-stop-2026-11-21/back-to-back-trace.mjs instrument()): every
// play / stop / leaveEmote / playUnder / reset / returnFromEmote / setPaused / seek call, each change of the clip in
// front and the mixer's "finished" events, with call stacks. Kept in step 3's record when the emote stops early.
if (process.env.TRACE) await page.addInitScript(() => {
  const log = (window.__trace = []);
  const at = () => (performance.now() / 1000).toFixed(2);
  const stack = () => new Error().stack.split("\n").slice(3, 9).map(s => s.trim().replace(/^at /, "")
    .replace(/https?:\/\/[^ )]*\/assets\//g, "")).join(" < ");
  const describe = a => { const t = a.timeline(); return `front=${a.state.current} idle=${a.state.idle} loading=${a.state.loading}${t ? ` ${t.time.toFixed(2)}/${t.duration.toFixed(2)}` : ""}`; };
  setInterval(() => {
    const a = window.__rigAnim?.animator;
    if (!a) return;
    if (!a.__traced) {
      a.__traced = true;
      for (const name of ["play", "stop", "leaveEmote", "openPose", "playUnder", "reset", "returnFromEmote", "setPaused", "seek"]) {
        const original = a[name];
        if (typeof original !== "function") continue;
        a[name] = function (...args) {
          log.push(`${at()} ${name}(${args.filter(x => typeof x !== "object").join(", ")}) ${describe(a)} | ${stack()}`);
          return original.apply(this, args);
        };
      }
      const publish = a.publish;
      a.publish = function (patch) {
        const before = this.state.current;
        const result = publish.call(this, patch);
        if (this.state.current !== before) log.push(`${at()} front ${before} -> ${this.state.current} | ${stack()}`);
        return result;
      };
    }
    if (a.mixer && a.mixer !== a.__tracedMixer) {
      a.__tracedMixer = a.mixer;
      a.mixer.addEventListener("finished", e => log.push(`${at()} mixer finished ${e.action.getClip().name} t=${e.action.time.toFixed(2)}/${e.action.getClip().duration.toFixed(2)} emote=${e.action === a.emoteAction} ${describe(a)}`));
    }
  }, 20);
});
const errors = [], bad = [], hosted = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("requestfailed", r => bad.push(`failed ${r.url()}`));
page.on("response", r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  const m = r.url().match(/^https:\/\/([0-9a-f]{8})\.[^/]+\/(.*)$/);
  if (m && (m[1] === CHINALS || m[1] === GLOBAL)) hosted.push(`${m[1]} ${r.status()} ${m[2]}`); });
const out = { app: APP, at: new Date().toISOString(), steps: {} };
const shot = name => page.screenshot({ path: path.join(shots, `${name}.png`) });
const opener = page.locator('button[title="Play an emote"]');
const state = () => page.evaluate(() => { const a = window.__rigAnim.animator, t = a.timeline();
  return { current: a.state.current, paused: a.state.paused, time: t ? +t.time.toFixed(2) : null,
    duration: t ? +t.duration.toFixed(2) : null, soundUnlocked: a.sounds.unlocked, soundAvailable: a.sounds.available }; });
/** The worn head's driven face bones: the largest angle from rest, and the jaw's and upper eyelids'. Degrees. */
const face = () => page.evaluate(() => {
  const f = window.__rigAnim.animator.face, h = f.head;
  if (!h) return null;
  const angle = (q, r) => { // 4·atan2(|a−b|, |a+b|) after sign alignment: well conditioned near 0
    const s = q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w < 0 ? -1 : 1;
    const d = Math.hypot(q.x - s * r.x, q.y - s * r.y, q.z - s * r.z, q.w - s * r.w);
    const p = Math.hypot(q.x + s * r.x, q.y + s * r.y, q.z + s * r.z, q.w + s * r.w);
    return 4 * Math.atan2(d, p) * 180 / Math.PI;
  };
  let max = 0, maxBone = null; const named = {};
  for (const d of h.bones) {
    const a = angle(d.bone.quaternion, d.restQuaternion);
    if (a > max) { max = a; maxBone = d.bone.name; }
    if (/^FACIAL_C_Jaw$|^FACIAL_[LR]_EyelidUpperA$/.test(d.bone.name)) named[d.bone.name] = +a.toFixed(2);
  }
  return { head: h.key, bones: h.bones.length, enabled: f.enabled ?? null, maxDeg: +max.toFixed(2), maxBone, ...named };
});
async function settle(ms = 2500) { await page.waitForTimeout(ms); }
/** Pan the face to the middle of the view (right-drag), then zoom with the wheel, as a person would. */
async function zoomOnFace(from) {
  const box = await page.locator("canvas").first().boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(cx, cy, { steps: 12 });
  await page.mouse.up({ button: "right" });
  for (let i = 0; i < Number(process.env.ZOOM_TICKS ?? 24); i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
  await settle(1500);
}
/** Sample until the clip in front is no longer `id` (or `limit` s); screenshot at `shotAt` s into the clip. */
async function follow(id, name, shotAt, limit = 30) {
  let reached = 0, duration = null, sound = false, ended = null, shotDone = false, peak = null, shotInfo = null; const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < limit) {
    const s = await state();
    if (s.current === id) {
      reached = Math.max(reached, s.time ?? 0); duration = s.duration; sound ||= s.soundUnlocked;
      const f = await face(); if (f && (!peak || f.maxDeg > peak.maxDeg)) peak = { ...f, time: s.time };
      if (!shotDone && (s.time ?? 0) >= shotAt) {
        const before = Date.now(); await shot(name); shotDone = true;
        const after = await state(); shotInfo = { at: s.time, ms: Date.now() - before, after: `${after.current} ${after.time}` };
      }
    } else if (reached > 0) { ended = s.current; break; }
    await page.waitForTimeout(150);
  }
  return { id, reached, duration, playedToEnd: duration !== null && reached >= duration - 0.4, thenPlaying: ended, audioRunning: sound, facePeak: peak, shot: shotInfo };
}
async function openPicker() {
  await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
  if (!(await page.getByRole("dialog", { name: "Emotes" }).isVisible().catch(() => false))) await opener.click();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await dialog.waitFor();
  return dialog;
}
async function equip(category, name) {
  await page.keyboard.press("Escape");
  await page.locator("button", { hasText: new RegExp(`^\\s*${category}\\s*\\d*\\s*$`, "i") }).first().click();
  await page.getByPlaceholder(new RegExp(`Search ${category}`, "i")).fill(name);
  await page.waitForTimeout(800);
  await page.locator("button", { hasText: new RegExp(name, "i") }).first().click();
  await page.waitForFunction(n => document.body.innerText.toLowerCase().includes(n.toLowerCase()), name, { timeout: 30000 });
  await settle(8000); // the mesh, its wrap cage and its face mask
}

// 1. Start: the Chinals banner, the Chinals idle, and the face moving (blinks: the upper eyelids leave rest).
await page.goto(`${APP}#/chinals`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
const welcome = await page.getByRole("dialog").first().isVisible().catch(() => false);
await page.keyboard.press("Escape");
await page.waitForFunction(() => /idle/.test(window.__rigAnim.animator.state.current ?? ""), null, { timeout: 60000 }).catch(() => {});
await settle(5000);
await shot("step1-start");
const banner = await page.locator("details").filter({ hasText: "Chinals mode" }).first().isVisible();
const idle = (await state()).current;
await zoomOnFace(JSON.parse(process.env.FACE_AT ?? "[1000, 290]"));
await shot("step1-zoomed");
const lids = []; let blinkShot = false;
for (let i = 0; i < 80; i++) { // 12 s
  const f = await face(); if (f) lids.push(Math.max(f.FACIAL_L_EyelidUpperA ?? 0, f.FACIAL_R_EyelidUpperA ?? 0));
  if (!blinkShot && lids.at(-1) > 15) { await shot("step1-blink"); blinkShot = true; }
  await page.waitForTimeout(150);
}
const head = await face();
out.steps.s1 = { welcomeShown: welcome, banner, idle, head: head?.head, eyelidMaxDeg: +Math.max(...lids).toFixed(2),
  eyelidMinDeg: +Math.min(...lids).toFixed(2), faceFiles: hosted.filter(h => h.startsWith(CHINALS) && /faces-1\//.test(h)) };

// 2. Wording: the banner's More, then the picker's footer.
await page.locator("details").filter({ hasText: "Chinals mode" }).first().locator("summary").click();
await page.waitForTimeout(500);
const bannerText = (await page.locator("details").filter({ hasText: "Chinals mode" }).first().innerText()).replace(/\s+/g, " ");
await shot("step2-banner");
await page.locator("details").filter({ hasText: "Chinals mode" }).first().locator("summary").click(); // close it again
let dialog = await openPicker();
await page.waitForFunction(() => window.__rigAnim.animator.sounds.available, null, { timeout: 60000 }).catch(() => {});
const footer = (await dialog.locator("text=/Effects are not shown yet/").first().innerText()).replace(/\s+/g, " ");
await shot("step2-picker");
out.steps.s2 = { bannerSentence: bannerText.match(/Props[^.]*\./)?.[0] ?? null, footer };

// 3. Unrivaled Master: sound, props, and the surprised face about 3 s in; then back to the idle.
const mark = process.env.TRACE ? await page.evaluate(() => { window.__trace.push(`${(performance.now() / 1000).toFixed(2)} --- step 3 click`); return window.__trace.length - 1; }) : 0;
await dialog.locator('button[title^="Unrivaled Master"]').first().click();
await page.keyboard.press("Escape"); // close the picker so the face is in view (the emote keeps playing)
const wm = await follow("cn-emote-weaponmaster", "step3-weaponmaster-playing", 3.1);
if (process.env.TRACE && !wm.playedToEnd) wm.trace = (await page.evaluate(() => window.__trace)).slice(mark);
out.steps.s3 = { played: wm, soundFile: hosted.filter(h => /sounds-1\/.*WeaponMaster.*\.m4a/.test(h)),
  propFiles: hosted.filter(h => h.startsWith(CHINALS) && /props-3\//.test(h)).length,
  curves: hosted.filter(h => /faces-1\/curves\/.*WeaponMaster/.test(h)) };

// 4. Paused at 3.2 s, Facial animation off then on (the real button).
const seekAndShow = async (id, t) => { await page.evaluate(([c, s]) => window.__rigAnim.play(c, s), [id, t]); await settle(3000); };
await seekAndShow("cn-emote-weaponmaster", 3.2);
const toggle = page.getByRole("button", { name: /Facial animation/ });
const pausedOn = { ...(await face()), state: await state() };
await shot("step4-face-on");
await toggle.click(); await settle(2500);
const pausedOff = await face();
await shot("step4-face-off");
await toggle.click(); await settle(2500);
const pausedOnAgain = await face();
await shot("step4-face-on-again");
out.steps.s4 = { on: pausedOn, off: pausedOff, onAgain: pausedOnAgain };

// 5. Full Beard (the first, black tile; the site shows its wiki name), then Balaclava Cotton Black, each in Unrivaled
// Master at 3.2 s.
await equip("Facial Hair", "Full Beard");
await seekAndShow("cn-emote-weaponmaster", 3.2);
const beard = await face();
await shot("step5-beard");
const beardWraps = await page.evaluate(() => window.__rigAnim.animator.face.wraps.length);
await equip("Facewear", "Balaclava Cotton Black");
await seekAndShow("cn-emote-weaponmaster", 3.2);
const mask = await face();
const masks = await page.evaluate(() => window.__rigAnim.animator.face.masks.map(m => m.name));
await shot("step5-balaclava");
out.steps.s5 = { beard, beardWraps, balaclava: mask, masks };

// 6. Global: a global emote plays with face and sound; back to Chinals keeps the outfit.
await page.locator('button[title="THE FINALS as published worldwide"]:visible').first().click();
await page.waitForTimeout(2000);
await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
await settle(15000);
dialog = await openPicker();
await dialog.locator('button[title^="Coop Caper"]').first().click();
await page.keyboard.press("Escape");
const coop = await follow("fox-chicken", "step6-global-coop-caper", 2.5);
await page.locator('button[title^="终极角逐: THE FINALS"]:visible').first().click();
await page.waitForTimeout(2000);
await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
await settle(8000);
const body = (await page.locator("body").innerText()).toLowerCase();
await shot("step6-back-to-chinals");
out.steps.s6 = { global: coop, globalSound: hosted.filter(h => h.startsWith(GLOBAL) && /sounds-\d\/.*\.m4a/.test(h)),
  backInChinals: page.url().includes("#/chinals"), keepsBeard: body.includes("full beard"),
  keepsBalaclava: body.includes("balaclava cotton black"), edition: await page.evaluate(() => window.__rigAnim.animator.manifest.edition ?? "global") };

out.badResponses = bad; out.errors = [...new Set(errors)];
const s = out.steps;
out.ok = s.s1.banner && /idle/.test(s.s1.idle ?? "") && s.s1.eyelidMaxDeg > 10
  && s.s2.bannerSentence === "Props, sound and facial expressions are shown; effects are not."
  && /with their props, sound and facial expressions\. Effects are not shown yet\./.test(s.s2.footer)
  && s.s3.played.playedToEnd && s.s3.played.audioRunning && s.s3.soundFile.length > 0 && s.s3.propFiles > 0 && /idle/.test(s.s3.played.thenPlaying ?? "")
  && s.s4.on.FACIAL_C_Jaw > 5 && s.s4.off.maxDeg < 0.1 && Math.abs(s.s4.onAgain.FACIAL_C_Jaw - s.s4.on.FACIAL_C_Jaw) < 0.5
  && s.s5.beard.FACIAL_C_Jaw > 5 && s.s5.beardWraps > 0 && s.s5.masks.length > 0
  && s.s6.global.reached > 2 && s.s6.global.audioRunning && s.s6.global.facePeak?.maxDeg > 2
  && s.s6.backInChinals && s.s6.edition === "chinals" && s.s6.keepsBeard && s.s6.keepsBalaclava
  && bad.length === 0 && out.errors.length === 0;
fs.writeFileSync(path.resolve("_docs/chinals-faces-2026-11-21/user-steps.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
