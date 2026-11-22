// Back-to-back trace (21 Nov 2026): an emote picked right after another one ended went back to the idle mid-play,
// intermittently, about 30 s after load (reported from PR #62's user-steps.mjs: Coop Caper to its end, then Gimme Five
// stopped at 1.49/5.67 in one run of three). Repeats that sequence on fresh pages as a visitor (navigator.webdriver
// masked) and logs every clip switch inside the page: play / stop / leaveEmote / openPose / playUnder / reset /
// returnFromEmote calls, the mixer's "finished" events, and each change of the clip in front, with call stacks.
// Prints each run's result; for a run where the second emote stops early, the log from the second click on.
//
//   node _docs/emote-early-stop-2026-11-21/back-to-back-trace.mjs "Coop Caper" "Gimme Five"     (Git Bash, worktree root)
//     RUNS=<n>       repeats (default 4)          WAIT=<ms>   wait after load before the picker (default 20000)
//     APP_URL=<url>  page to open (default: prod-build.mjs --anim=...'s build, served here on port 4357)
//     SHOTS=1        screenshots at user-steps.mjs's moments (3 s into the first emote, 1.5 s into the second)
const [firstTitle = "Coop Caper", secondTitle = "Gimme Five"] = process.argv.slice(2).filter(a => !a.startsWith("--"));
process.env.VITE_BASE = "/the-finals-outfit/";
const { chromium } = await import("playwright-core");
const { preview } = await import("vite");
const path = await import("node:path");
const root = process.cwd();
const server = process.env.APP_URL ? null : await preview({ root, configFile: path.join(root, "vite.config.ts"),
  build: { outDir: path.join(root, "scripts/generated/emote-early-stop-2026-11-21/prod-anim/dist") },
  preview: { port: 4357, strictPort: true, host: "127.0.0.1" } });
const APP = process.env.APP_URL ?? "http://127.0.0.1:4357/the-finals-outfit/";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=user-gesture-required"] });
const SHOTS = !!process.env.SHOTS;
const shotDir = path.join(root, "scripts/generated/emote-early-stop-2026-11-21/back-to-back");

function instrument() {
  Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
  const log = (window.__trace = []);
  const at = () => (performance.now() / 1000).toFixed(2);
  const stack = () => new Error().stack.split("\n").slice(3, 9).map(s => s.trim().replace(/^at /, "")
    .replace(/https?:\/\/[^ )]*\/assets\//g, "")).join(" < ");
  const describe = a => { const t = a.timeline(); return `front=${a.state.current} idle=${a.state.idle} loading=${a.state.loading}${t ? ` ${t.time.toFixed(2)}/${t.duration.toFixed(2)}` : ""}`; };
  const poll = setInterval(() => {
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
      a.mixer.addEventListener("finished", e => log.push(`${at()} mixer finished ${e.action.getClip().name} t=${e.action.time.toFixed(2)}/${e.action.getClip().duration.toFixed(2)} emote=${e.action === a.emoteAction} paused=${e.action.paused} weight=${e.action.getEffectiveWeight().toFixed(2)} ${describe(a)}`));
    }
  }, 20);
}

const front = page => page.evaluate(() => { const a = window.__rigAnim.animator, t = a.timeline();
  return { current: a.state.current, loading: a.state.loading, time: t?.time ?? null, duration: t?.duration ?? null }; });
const runs = Number(process.env.RUNS ?? 4);
for (let run = 1; run <= runs; run++) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(instrument);
  await page.goto(APP, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(Number(process.env.WAIT ?? 20000));
  await page.locator('button[title="Play an emote"]').click();
  const dialog = page.getByRole("dialog", { name: "Emotes" });
  await dialog.waitFor();
  await dialog.locator(`button[title^="${firstTitle}"]`).first().click();
  await page.waitForFunction(() => { const s = window.__rigAnim.animator.state; return !!s.current && s.current !== s.idle; }, null, { timeout: 60000 });
  const firstId = (await front(page)).current;
  let firstReached = 0, firstDuration = null;
  let firstShot = !SHOTS; const f0 = Date.now();
  for (;;) {
    const s = await front(page); if (s.current !== firstId) break; firstReached = Math.max(firstReached, s.time ?? 0); firstDuration = s.duration;
    if (!firstShot && Date.now() - f0 >= 3000) { firstShot = true; await page.screenshot({ path: path.join(shotDir, `run${run}-first.png`) }); }
    await page.waitForTimeout(250);
  }
  const mark = await page.evaluate(() => { window.__trace.push(`${(performance.now() / 1000).toFixed(2)} --- second click`); return window.__trace.length - 1; });
  await dialog.locator(`button[title^="${secondTitle}"]`).first().click();
  await page.waitForFunction(() => { const s = window.__rigAnim.animator.state; return s.loading === null && !!s.current && s.current !== s.idle; }, null, { timeout: 60000 }).catch(() => {});
  const secondId = (await front(page)).current;
  let reached = 0, duration = null, after = null;
  const t0 = Date.now(); let secondShot = !SHOTS;
  while (Date.now() - t0 < 20000) {
    if (!secondShot && Date.now() - t0 >= 1500) { secondShot = true; await page.evaluate(() => window.__trace.push(`${(performance.now() / 1000).toFixed(2)} --- screenshot`)); await page.screenshot({ path: path.join(shotDir, `run${run}-second.png`) }); }
    const s = await front(page);
    if (s.current === secondId) { reached = Math.max(reached, s.time ?? 0); duration = s.duration; }
    else { after = s.current; break; }
    await page.waitForTimeout(250);
  }
  const early = duration !== null && reached < duration - 0.4;
  console.log(`run ${run}: ${firstId} ${firstReached.toFixed(2)}/${firstDuration?.toFixed(2)} then ${secondId} ${reached.toFixed(2)}/${duration?.toFixed(2)} -> ${after}${early ? "  EARLY STOP" : ""}`);
  if (early || process.env.VERBOSE) console.log((await page.evaluate(() => window.__trace)).slice(mark).map(l => "    " + l).join("\n"));
  await page.close();
}
await browser.close(); await server?.close();
