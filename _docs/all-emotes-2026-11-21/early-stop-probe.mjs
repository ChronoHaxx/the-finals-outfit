// Early-stop probe (21 Nov 2026, README.md "Found in passing"): does an emote clicked as a visitor play to its end?
// Opens the app in headless Chrome with navigator.webdriver masked (so the app behaves as for a visitor: idle autoplay,
// sound, welcome dialog), waits SETTLE ms after the emote button enables, clicks the tile whose title starts with each
// argument, and prints the page time, the clip in front and the clip's own time every 0.5 s until the idle returns.
//
//   node _docs/all-emotes-2026-11-21/early-stop-probe.mjs "Valkyria" "Applause Pause"      (Git Bash, worktree root)
//     APP_URL=<url>   page to open (default: the production build from prod-check.mjs, served here on port 4354);
//                     e.g. https://chronohaxx.github.io/the-finals-outfit/ for the live site
//     SETTLE=<ms>     wait after the button enables (default 500; 20000 makes the early stop go away)
//     --unmasked      leave navigator.webdriver set (the app's automation path: no early stop)
process.env.VITE_BASE = "/the-finals-outfit/";
const MASK = !process.argv.includes("--unmasked");
const titles = process.argv.slice(2).filter(a => !a.startsWith("--"));
const { preview } = await import("vite");
const { chromium } = await import("playwright-core");
const path = await import("node:path");
const root = process.cwd();
const server = process.env.APP_URL ? null : await preview({ root, configFile: path.join(root, "vite.config.ts"),
  build: { outDir: path.join(root, "scripts/generated/all-emotes-2026-11-21/prod/dist") },
  preview: { port: 4354, strictPort: true, host: "127.0.0.1" } });
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const title of titles) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (MASK) await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  await page.goto(process.env.APP_URL ?? "http://127.0.0.1:4354/the-finals-outfit/", { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('button[title="Play an emote"]')?.disabled === false, null, { timeout: 180000 });
  await page.keyboard.press("Escape"); // the welcome dialog
  await page.waitForTimeout(Number(process.env.SETTLE ?? 500));
  await page.locator('button[title="Play an emote"]').click();
  const picker = page.getByRole("dialog", { name: "Emotes" });
  await picker.waitFor();
  await picker.locator(`button[title^="${title}"]`).first().click();
  const samples = [];
  for (let i = 0; i < 40; i++) {
    samples.push(await page.evaluate(() => { const a = window.__rigAnim.animator, s = a.state, t = a.timeline();
      return `${(performance.now() / 1000).toFixed(1)} ${s.current} ${t ? t.time.toFixed(2) + "/" + t.duration.toFixed(2) : "-"}`; }));
    if (/idle/.test(samples.at(-1)) && samples.some(s => !/null|idle/.test(s))) break;
    await page.waitForTimeout(500);
  }
  console.log(`${title}: ${samples.filter(s => !/ null /.test(s)).join(" | ")}`);
  await page.close();
}
await browser.close(); await server?.close();
