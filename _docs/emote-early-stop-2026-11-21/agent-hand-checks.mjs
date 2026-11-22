// Agent run of functional-checklist.md, steps 1-5 (22 Nov 2026, on the owner's waiver of the hand checks). A real,
// headed Chrome window (GPU rendering and real frame timing, unlike the headless probes; Playwright's flags keep it
// running when covered), a fresh profile for each window as a private window would have, navigator.webdriver masked
// so the app behaves as for a visitor, sound muted. Clicks are real mouse input on the same buttons a visitor uses.
//
//   node _docs/emote-early-stop-2026-11-21/agent-hand-checks.mjs            (Git Bash, worktree root)
//     AFTER_URL=<url>   the build with the fix (default: the live site, deployed from main with PR #69)
//     BEFORE_URL=<url>  the build without it (default: main just before the merge, 4848a7f, built to
//                       scripts/generated/emote-early-stop-2026-11-21/before-4848a7f/dist, served here on port 4358;
//                       made on 22 Nov with a copy of prod-build.mjs under scripts/generated/ whose output folder was
//                       renamed to before-4848a7f, run in a clean checkout at `git checkout --detach 4848a7f`)
//     THROTTLE=1        roughly DevTools' Fast 4G for every load (a longer gap between the character and the outfit)
//     ATTEMPTS=<n>      fresh windows per quick-click step while the click keeps landing after the outfit loaded (3)
// Screenshots and results.json: scripts/generated/emote-early-stop-2026-11-21/hand-checks/
process.env.VITE_BASE = "/the-finals-outfit/";
const { chromium } = await import("playwright-core");
const { preview } = await import("vite");
const path = await import("node:path");
const { mkdirSync, writeFileSync } = await import("node:fs");
const root = process.cwd();
const out = path.join(root, "scripts/generated/emote-early-stop-2026-11-21/hand-checks");
mkdirSync(out, { recursive: true });
const AFTER = process.env.AFTER_URL ?? "https://chronohaxx.github.io/the-finals-outfit/";
const server = process.env.BEFORE_URL ? null : await preview({ root, configFile: path.join(root, "vite.config.ts"),
  build: { outDir: path.join(root, "scripts/generated/emote-early-stop-2026-11-21/before-4848a7f/dist") },
  preview: { port: 4358, strictPort: true, host: "127.0.0.1" } });
const BEFORE = process.env.BEFORE_URL ?? "http://127.0.0.1:4358/the-finals-outfit/";
const ATTEMPTS = Number(process.env.ATTEMPTS ?? 3);
const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--mute-audio"] });
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

// In the page: the visitor mask, and a log of every change the checklist talks about (button enabled, outfit pass
// flag, "Loading outfit…" HUD, clip in front, idle) plus each picker click with the outfit state at that instant.
function recorder() {
  Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
  const log = (window.__hand = []);
  const at = () => (performance.now() / 1000).toFixed(2);
  const hud = () => [...document.querySelectorAll(".hud")].some(e => e.textContent.includes("Loading outfit"));
  document.addEventListener("click", e => {
    const b = e.target.closest?.("button[title], button[aria-label]");
    if (b) log.push(`${at()} click "${b.title || b.getAttribute("aria-label")}" outfitLoaded=${window.__rigIdle === true} hud=${hud()}`);
  }, true);
  let last = {};
  setInterval(() => {
    const a = window.__rigAnim?.animator, button = document.querySelector('button[title="Play an emote"]');
    const now = { emotesEnabled: !!button && !button.disabled, outfitLoaded: window.__rigIdle === true, hud: hud(),
      front: a?.state.current ?? null, idle: a?.state.idle ?? null };
    for (const k of Object.keys(now)) if (now[k] !== last[k]) log.push(`${at()} ${k}=${now[k]}`);
    last = now;
  }, 50);
}
const state = page => page.evaluate(() => {
  const a = window.__rigAnim?.animator, t = a?.timeline();
  return { front: a?.state.current ?? null, idle: a?.state.idle ?? null, active: a?.state.active ?? null,
    loading: a?.state.loading ?? null, time: t?.time ?? null, duration: t?.duration ?? null,
    outfitLoaded: window.__rigIdle === true,
    hud: [...document.querySelectorAll(".hud")].some(e => e.textContent.includes("Loading outfit")) };
});
const pageLog = page => page.evaluate(() => window.__hand);

async function openWindow() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(recorder);
  if (process.env.THROTTLE) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150,
      downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  }
  return { context, page };
}
// Step 1: open (or reload), Esc on the welcome screen, wait for the Emotes button.
async function start(page, url) {
  if (url) await page.goto(url, { waitUntil: "load", timeout: 180000 }); else await page.reload({ waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000, polling: 50 });
  await page.keyboard.press("Escape");
  return state(page);
}
const dialogOf = page => page.getByRole("dialog", { name: "Emotes" });
// Pick an emote by its tile title (opening the picker if needed); resolves once it is in front, or null if never.
async function pick(page, title) {
  const dialog = dialogOf(page);
  if (!(await dialog.isVisible())) { await page.locator('button[title="Play an emote"]').click(); await dialog.waitFor(); }
  const before = await state(page);
  await dialog.locator(`button[title^="${title}"]`).first().click();
  const ok = await page.waitForFunction(prev => { const s = window.__rigAnim.animator.state;
    return s.loading === null && !!s.current && s.current !== s.idle && s.current !== prev; }, before.front,
  { timeout: 30000, polling: 50 }).then(() => true, () => false);
  return ok ? { ...(await state(page)), before } : null;
}
// Follow the clip in front until it changes; screenshots at the given clip times and just after it changes.
async function follow(page, id, tag, shots = []) {
  let reached = 0, duration = null; const due = [...shots], t0 = Date.now();
  for (;;) {
    const s = await state(page);
    if (s.front !== id || Date.now() - t0 > 40000) {
      await page.waitForTimeout(800); if (tag) await shot(page, `${tag}-after`);
      return { reached, duration, next: s.front !== id ? s.front : "timeout", early: duration !== null && reached < duration - 0.4 };
    }
    reached = Math.max(reached, s.time ?? 0); duration = s.duration ?? duration;
    if (due.length && (s.time ?? 0) >= due[0] && tag) await shot(page, `${tag}-${due.shift()}s`);
    await page.waitForTimeout(100);
  }
}
const clickedWhileLoading = (log, title) => {
  const line = log.findLast(l => l.includes(`click "${title}`));
  return line ? line.includes("outfitLoaded=false") : null;
};

// Steps 1-2 (or 3 on the build without the fix): a fresh window, Valkyria the moment Emotes is clickable.
async function quickClick(url, tag) {
  const runs = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const w = await openWindow();
    const atEnable = await start(w.page, url);
    await shot(w.page, `${tag}-a${attempt}-step1`);
    const picked = await pick(w.page, "Valkyria");
    const followed = picked ? await follow(w.page, picked.front, `${tag}-a${attempt}`, [1.5, 4]) : null;
    const log = await pageLog(w.page);
    const run = { attempt, atEnable, id: picked?.front ?? null, followed, whileLoading: clickedWhileLoading(log, "Valkyria"), log };
    runs.push(run);
    console.log(`${tag} try ${attempt}: at enable outfitLoaded=${atEnable.outfitLoaded} hud=${atEnable.hud}; click while loading=${run.whileLoading}; `
      + (followed ? `${run.id} ${followed.reached.toFixed(2)}/${followed.duration?.toFixed(2)} -> ${followed.next}${followed.early ? "  EARLY" : ""}` : "never in front"));
    if (run.whileLoading) return { runs, window: w };
    await w.context.close();
  }
  return { runs, window: null };
}

const results = { at: new Date().toISOString(), after: AFTER, before: BEFORE, throttle: !!process.env.THROTTLE, steps: {} };
// Steps 1-2: the fix.
const fix = await quickClick(AFTER, "s2-fix");
results.steps.quickFix = fix.runs.map(({ log, ...r }) => ({ ...r, log: log.slice(-40) }));
// Step 3: before the fix.
const old = await quickClick(BEFORE, "s3-before");
results.steps.quickBefore = old.runs.map(({ log, ...r }) => ({ ...r, log: log.slice(-40) }));
await old.window?.context.close();

if (fix.window) {
  const { page } = fix.window;
  // Step 4: fully loaded and idling; Valkyria, then partway another emote; then one more, closed with X.
  await page.waitForFunction(() => { const s = window.__rigAnim.animator.state; return window.__rigIdle === true && !!s.idle && s.current === s.idle; }, null, { timeout: 60000 });
  const s4 = {};
  const v = await pick(page, "Valkyria");
  await page.waitForTimeout(2000);
  s4.valkyriaAtSwitch = (await state(page)).time;
  const g = await pick(page, "Gimme Five");
  s4.second = { id: g?.front, startTime: g?.time, replaced: g?.before.front === v?.front };
  await shot(page, "s4-second-started");
  s4.secondFollowed = g ? await follow(page, g.front, "s4-second") : null;
  const c = await pick(page, "Coop Caper");
  await page.waitForTimeout(1200);
  if (await dialogOf(page).isVisible()) await page.keyboard.press("Escape");
  await shot(page, "s4-third-playing");
  const xAt = Date.now();
  await page.locator('button[aria-label="Close the emote"]').click();
  await page.waitForFunction(id => window.__rigAnim.animator.state.current !== id, c?.front, { timeout: 5000, polling: 20 }).catch(() => {});
  s4.closeX = { id: c?.front, msToChange: Date.now() - xAt, after: await state(page) };
  await page.waitForTimeout(800); await shot(page, "s4-after-x");
  results.steps.ordinary = s4;
  console.log(`step 4: Valkyria switched at ${s4.valkyriaAtSwitch?.toFixed(2)}; ${s4.second.id} started at ${s4.second.startTime?.toFixed(2)} replacing=${s4.second.replaced}, `
    + `${s4.secondFollowed?.reached.toFixed(2)}/${s4.secondFollowed?.duration?.toFixed(2)} -> ${s4.secondFollowed?.next}; X on ${s4.closeX.id}: ${s4.closeX.after.front} after ${s4.closeX.msToChange} ms`);

  // Step 5: "Animated" -> still pose, reload in the same window, quick Valkyria: to its end, then still again.
  const s5 = {};
  await page.locator('button[title="Return to the still pose"]').click();
  await page.waitForTimeout(1200);
  s5.afterToggle = await state(page);
  await shot(page, "s5-still");
  s5.tries = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const atEnable = await start(page, null);
    s5.toggleTitle = await page.locator('button[title="Return to the still pose"], button[title="Play the outfit-screen idle"]').first().getAttribute("title");
    const p = await pick(page, "Valkyria");
    const f = p ? await follow(page, p.front, `s5-a${attempt}`, [4]) : null;
    await page.waitForTimeout(5000);
    const later = await state(page);
    const log = await pageLog(page);
    const t = { attempt, atEnable, toggleTitle: s5.toggleTitle, followed: f, fiveSecondsLater: later, whileLoading: clickedWhileLoading(log, "Valkyria"), log: log.slice(-30) };
    s5.tries.push(t);
    await shot(page, `s5-a${attempt}-5s-later`);
    console.log(`step 5 try ${attempt}: toggle reads "${t.toggleTitle}"; click while loading=${t.whileLoading}; `
      + `${f ? `${p.front} ${f.reached.toFixed(2)}/${f.duration?.toFixed(2)} -> ${f.next}` : "never in front"}; 5 s later front=${later.front} active=${later.active} outfitLoaded=${later.outfitLoaded}`);
    if (t.whileLoading) break;
  }
  results.steps.still = s5;
  await fix.window.context.close();
}
writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(`results: ${path.join(out, "results.json")}`);
await browser.close(); await server?.close();
