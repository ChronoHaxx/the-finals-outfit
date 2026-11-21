// The functional checklist's steps 1-5 (functional-checklist.md), driven by the agent on the owner's waiver (21 Nov).
// Visitor path: navigator.webdriver masked, so idle autoplay, sound and the welcome dialog behave as for a person.
// Clicks the same controls the checklist names, samples the playing clip, and saves a screenshot per step.
//
//   node _docs/all-emotes-2026-11-21/user-steps.mjs        (Git Bash, worktree root; the build served on port 4355)
//     APP_URL=<url>   default http://127.0.0.1:4355/the-finals-outfit/
import fs from "node:fs";
import path from "node:path";
const { chromium } = await import("playwright-core");
const APP = process.env.APP_URL ?? "http://127.0.0.1:4355/the-finals-outfit/";
const shots = path.resolve("scripts/generated/all-emotes-2026-11-21/user-steps");
fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
const errors = [], bad = [], hosted = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("requestfailed", r => bad.push(`failed ${r.url()}`));
page.on("response", r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  if (/fd946744|dcb131a5/.test(r.url())) hosted.push(`${r.status()} ${r.url().replace(/^https:\/\/[^/]+\//, "")}`); });
const out = { app: APP, at: new Date().toISOString(), steps: {} };
const shot = name => page.screenshot({ path: path.join(shots, `${name}.png`) });
const opener = page.locator('button[title="Play an emote"]');
const state = () => page.evaluate(() => { const a = window.__rigAnim.animator, t = a.timeline();
  return { current: a.state.current, time: t ? +t.time.toFixed(2) : null, duration: t ? +t.duration.toFixed(2) : null,
    idleTime: a.idleAction ? +a.idleAction.time.toFixed(2) : null, // the idle has no timeline(); its action's clock
    soundUnlocked: a.sounds.unlocked, soundAvailable: a.sounds.available }; });
/** Sample until the clip in front is no longer `id` (or `limit` s). Screenshot at `shotAt` s. */
async function follow(id, name, shotAt, limit = 30) {
  let reached = 0, duration = null, sound = false, ended = null; const t0 = Date.now(); let shotDone = false;
  while ((Date.now() - t0) / 1000 < limit) {
    const s = await state();
    if (s.current === id) { reached = Math.max(reached, s.time ?? 0); duration = s.duration; sound ||= s.soundUnlocked; }
    else if (reached > 0) { ended = s.current; break; }
    if (!shotDone && (Date.now() - t0) / 1000 >= shotAt) { await shot(name); shotDone = true; }
    await page.waitForTimeout(250);
  }
  return { id, reached, duration, playedToEnd: duration !== null && reached >= duration - 0.4, thenPlaying: ended, audioRunning: sound };
}
async function openPicker() {
  await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await dialog.waitFor();
  return dialog;
}
async function sectionsOf(dialog) {
  return dialog.locator("section[aria-label]").evaluateAll(els => els.map(e => `${e.getAttribute("aria-label")} · ${e.querySelectorAll("button").length}`));
}

// 1. Start: the default outfit loads and plays its idle.
await page.goto(APP, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
const welcome = await page.getByRole("dialog").first().isVisible().catch(() => false);
await page.keyboard.press("Escape");
await page.waitForFunction(() => /idle/.test(window.__rigAnim.animator.state.current ?? ""), null, { timeout: 60000 }).catch(() => {});
const idleA = await state(); await page.waitForTimeout(1000); const idleB = await state();
await shot("step1-idle");
out.steps.s1 = { welcomeShown: welcome, idle: idleA.current, idleTimes: [idleA.idleTime, idleB.idleTime],
  idleAdvancing: /idle/.test(idleA.current ?? "") && idleA.current === idleB.current && idleA.idleTime !== null && idleB.idleTime !== idleA.idleTime };
await page.waitForTimeout(20000); // the known early-stop race (README "Found in passing")

// 2. The new seasons: tab count, footer, Season 2 · 16 and Season 1 · 41 with icons.
let dialog = await openPicker();
const tab = (await dialog.getByRole("button", { name: /^Emotes \d+/ }).innerText()).replace(/\s+/g, " ");
await page.waitForFunction(() => window.__rigAnim.animator.sounds.available, null, { timeout: 60000 }).catch(() => {});
const footer = (await dialog.locator("text=/Effects are not shown yet/").first().innerText()).replace(/\s+/g, " ");
const sections = await sectionsOf(dialog);
const iconCheck = {};
for (const name of ["Season 2", "Season 1"]) {
  const tiles = dialog.locator(`section[aria-label="${name}"] button`);
  const n = await tiles.count();
  for (let i = 0; i < n; i++) await tiles.nth(i).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  iconCheck[name] = await dialog.locator(`section[aria-label="${name}"]`).evaluate(sec => {
    const imgs = [...sec.querySelectorAll("img")];
    return { tiles: sec.querySelectorAll("button").length, imgs: imgs.length, loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      noIcon: [...sec.querySelectorAll("button")].filter(b => /No icon/.test(b.innerText)).map(b => b.title),
      some: [...sec.querySelectorAll("button")].slice(0, 6).map(b => b.title) };
  });
}
await dialog.locator('section[aria-label="Season 1"]').scrollIntoViewIfNeeded();
await shot("step2-season1");
await dialog.locator('section[aria-label="Season 2"]').scrollIntoViewIfNeeded();
await shot("step2-season2");
out.steps.s2 = { tab, footer, lastSections: sections.slice(-3), icons: iconCheck };

// 3. Coop Caper (sound, to its end), then Gimme Five.
await dialog.locator('button[title^="Coop Caper"]').first().click();
// PR #58's controls (merged into main 21 Nov) must survive the merge: the speed slider while an emote is in front,
// and the Facial animation switch.
const speedControl = await page.getByRole("group", { name: "Emote speed" }).waitFor({ timeout: 15000 }).then(() => true, () => false);
const faceToggle = await page.getByRole("button", { name: /Facial animation/ }).isVisible();
const coop = await follow("fox-chicken", "step3-coop-caper", 3);
await dialog.locator('button[title^="Gimme Five"]').first().click();
const five = await follow("high-five", "step3-gimme-five", 1.5);
out.steps.s3 = { speedControl, faceToggle, coop, five, soundFiles: hosted.filter(h => /sounds-2\/.*\.m4a/.test(h)), propFiles: hosted.filter(h => /props-10\//.test(h)) };

// 4. Search "what's up", play What's Up?, then More holds only Tap Dance.
await dialog.getByPlaceholder("Search emotes").fill("what's up");
await page.waitForTimeout(800);
const found = await dialog.locator("section[aria-label] button").evaluateAll(bs => bs.map(b => b.title));
await dialog.locator('button[title^="What\'s Up?"]').first().click();
const wave = await follow("wave", "step4-whats-up", 1.5);
await dialog.getByRole("button", { name: "More", exact: true }).click();
await page.waitForTimeout(500);
const unlisted = await dialog.locator("section").filter({ has: page.locator("h3", { hasText: "Unlisted emote animations" }) })
  .locator("button").evaluateAll(bs => bs.map(b => b.innerText.trim()));
await shot("step4-more");
out.steps.s4 = { searchResults: found, wave, unlisted };

// 5. Chinals: Uncategorised · 5; clicking one plays it.
await page.keyboard.press("Escape");
await page.locator('button[title^="终极角逐: THE FINALS"]').first().click();
await page.waitForTimeout(2000);
await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
await page.waitForTimeout(20000);
dialog = await openPicker();
const cSections = await sectionsOf(dialog);
const unc = dialog.locator('section[aria-label="Uncategorised"]');
await unc.scrollIntoViewIfNeeded();
const uncTiles = await unc.locator("button").evaluateAll(bs => bs.map(b => b.title));
const uncNote = await unc.locator("p").innerText().catch(() => null);
await shot("step5-chinals-uncategorised");
await unc.locator("button").first().click();
await page.waitForFunction(() => !/idle/.test(window.__rigAnim.animator.state.current ?? "idle"), null, { timeout: 60000 }).catch(() => {});
const firstId = (await state()).current;
const cPlay = await follow(firstId, "step5-chinals-play", 1.5);
out.steps.s5 = { url: page.url(), lastSections: cSections.slice(-3), uncategorised: uncTiles, note: uncNote, played: cPlay };

out.badResponses = bad; out.errors = errors;
const s = out.steps;
// Not a checklist expectation but recorded: any emote that went back to the idle before its end (README "Found in passing").
out.earlyStops = [s.s3.coop, s.s3.five, s.s4.wave, s.s5.played].filter(p => !p.playedToEnd).map(p => `${p.id} ${p.reached}/${p.duration}`);
out.ok = s.s1.idleAdvancing && /^Emotes 295$/i.test(s.s2.tab) && /with their props, sound and facial expressions\. Effects are not shown yet\./.test(s.s2.footer)
  && s.s2.lastSections.some(x => x.startsWith("Season 2 · 16")) && s.s2.lastSections.at(-1) === "Season 1 · 41"
  && ["Season 2", "Season 1"].every(n => s.s2.icons[n].loaded === s.s2.icons[n].tiles && s.s2.icons[n].noIcon.length === 0)
  && s.s3.speedControl && s.s3.faceToggle && s.s3.coop.playedToEnd && s.s3.coop.audioRunning && s.s3.soundFiles.length > 0 && s.s3.five.reached > 1
  && s.s4.wave.reached > 0 && s.s4.unlisted.length === 1 && /tap dance/i.test(s.s4.unlisted[0])
  && s.s5.lastSections.at(-1) === "Uncategorised · 5" && (s.s5.played.reached ?? 0) > 0
  && bad.length === 0 && errors.length === 0;
fs.writeFileSync(path.resolve("_docs/all-emotes-2026-11-21/user-steps.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
