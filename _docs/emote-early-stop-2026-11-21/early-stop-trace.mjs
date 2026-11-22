// Early-stop trace (21 Nov 2026): who replaces an emote picked in the first seconds? Same visitor run as
// early-stop-probe.mjs (navigator.webdriver masked, welcome dialog closed, emote clicked 0.5 s after the button
// enables), plus a page-side log of every RigAnimator.play() call and every flip of window.__rigIdle (the viewer's
// "outfit pass finished" flag, CharacterViewer.tsx endOperation), with page times. Prints the log in time order.
//
//   APP_URL=https://chronohaxx.github.io/the-finals-outfit/ node _docs/emote-early-stop-2026-11-21/early-stop-trace.mjs "Valkyria"
//   (Git Bash, worktree root; without APP_URL it serves prod-build.mjs's build on port 4354, as early-stop-probe.mjs)
const title = process.argv[2] ?? "Valkyria";
process.env.VITE_BASE = "/the-finals-outfit/";
const { chromium } = await import("playwright-core");
const { preview } = await import("vite");
const path = await import("node:path");
const root = process.cwd();
const server = process.env.APP_URL ? null : await preview({ root, configFile: path.join(root, "vite.config.ts"),
  build: { outDir: path.join(root, "scripts/generated/emote-early-stop-2026-11-21/prod/dist") },
  preview: { port: 4354, strictPort: true, host: "127.0.0.1" } });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
  const log = (window.__trace = []);
  const at = () => (performance.now() / 1000).toFixed(2);
  let idleFlag;
  const poll = setInterval(() => {
    if (window.__rigIdle !== idleFlag) { idleFlag = window.__rigIdle; log.push(`${at()} __rigIdle=${idleFlag}`); }
    const a = window.__rigAnim?.animator;
    if (a && !a.__traced) {
      a.__traced = true;
      log.push(`${at()} animator published`);
      const play = a.play.bind(a);
      a.play = (root, id) => { log.push(`${at()} play(${id}) busy=${window.__rigIdle === false} current=${a.state.current}`); return play(root, id); };
      if (a.playUnder) { // the fix (absent before it)
        const under = a.playUnder.bind(a);
        a.playUnder = (root, id) => { log.push(`${at()} playUnder(${id}) busy=${window.__rigIdle === false} current=${a.state.current}`);
          return under(root, id).then(started => { log.push(`${at()} playUnder(${id}) -> ${started}`); return started; }); };
      }
    }
  }, 20);
  window.addEventListener("pagehide", () => clearInterval(poll));
});
await page.goto(process.env.APP_URL ?? "http://127.0.0.1:4354/the-finals-outfit/", { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
await page.evaluate(() => window.__trace.push(`${(performance.now() / 1000).toFixed(2)} emote button enabled`));
await page.keyboard.press("Escape");
await page.waitForTimeout(Number(process.env.SETTLE ?? 500));
await page.locator('button[title="Play an emote"]').click();
const picker = page.getByRole("dialog", { name: "Emotes" });
await picker.waitFor();
await page.evaluate(() => window.__trace.push(`${(performance.now() / 1000).toFixed(2)} viewer clicks the tile`));
await picker.locator(`button[title^="${title}"]`).first().click();
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  await page.evaluate(() => { const a = window.__rigAnim.animator, t = a.timeline();
    window.__trace.push(`${(performance.now() / 1000).toFixed(2)}   front=${a.state.current} idle=${a.state.idle} ${t ? t.time.toFixed(2) + "/" + t.duration.toFixed(2) : ""}`); });
  const done = await page.evaluate(() => { const s = window.__rigAnim.animator.state; return !!s.idle && s.current === s.idle && s.loading === null; });
  if (done && i > 2) break;
}
console.log((await page.evaluate(() => window.__trace)).join("\n"));
await browser.close(); await server?.close();
