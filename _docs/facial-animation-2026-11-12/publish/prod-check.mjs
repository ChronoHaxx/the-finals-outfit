// Production check (12 Nov 2026): build the app with deploy.yml's production settings and the new animations host,
// serve it at /the-finals-outfit/, and hold two emote frames headless (a balaclava, a beard). Proves the hosted face
// data (faces-1) loads cross-origin in a production bundle (no dev server, no local /animations/) and drives the face,
// the wrap cage and the item's mask.
//   node _docs/facial-animation-2026-11-12/publish/prod-check.mjs [--skip-build]   (Git Bash or PowerShell, worktree root)
import { build, preview } from "vite";
import { chromium } from "playwright-core";
import { copyFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const here = path.join(root, "_docs/facial-animation-2026-11-12/publish");
const scratch = path.join(root, "scripts/generated/face-anim/prod");
const outDir = path.join(scratch, "dist"), publicDir = path.join(scratch, "public");
const ANIM = "https://e5250f94.the-finals-outfit-assets.pages.dev/";
Object.assign(process.env, { // .github/workflows/deploy.yml, production build
  VITE_BASE: "/the-finals-outfit/",
  VITE_ASSETS_BASE: "https://f4a8e069.the-finals-outfit-assets.pages.dev/",
  VITE_MODELS_BASE: "https://a029b249.the-finals-outfit-assets.pages.dev/",
  VITE_RECONSTRUCTION_BASE: "https://c062af24.the-finals-outfit-assets.pages.dev/",
  VITE_SHARE_PREVIEW_BASE: "https://the-finals-outfit-share.chronohaxx.workers.dev",
  VITE_ANIMATIONS_BASE: ANIM,
  VITE_RECONSTRUCTION_ROUTES_FILE: "src/data/reconstruction-routes.json",
});
if (!process.argv.includes("--skip-build")) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true }); // our own scratch build output only
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(path.join(root, "public/favicon.svg"), path.join(publicDir, "favicon.svg")); // what CI's public/ holds
  await build({ root, configFile: path.join(root, "vite.config.ts"), publicDir, mode: "production", logLevel: "warn",
    build: { outDir, emptyOutDir: true } });
}
const server = await preview({ root, configFile: path.join(root, "vite.config.ts"), build: { outDir },
  preview: { port: 4352, strictPort: true, host: "127.0.0.1" } });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
const errors = [], faces = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
page.on("console", m => { if (m.type() === "error" || /\[face\]/.test(m.text())) errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
page.on("response", r => { if (r.url().startsWith(ANIM + "faces-1/")) faces.push(`${r.status()} ${r.url().slice(ANIM.length)}`); });
const BODY = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const enc = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const cases = [
  { name: "balaclava", slots: { ...BODY, facewear: "streetwear-balaclava-cotton-black" }, anim: "take-a-bow", time: 1.2 },
  { name: "beard", slots: { ...BODY, facialHair: "facialhairs-beardfull-black" }, anim: "evil-jester", time: 1.3 },
];
const result = { anim: ANIM, cases: [] };
for (const c of cases) {
  faces.length = 0; errors.length = 0;
  const row = { name: c.name };
  try {
    await page.goto(`http://127.0.0.1:4352/the-finals-outfit/?outfit=${enc(c.slots)}&anim=${c.anim}&animTime=${c.time}`,
      { waitUntil: "load", timeout: 180000 });
    await page.keyboard.press("Escape"); // welcome dialog, if any
    await page.waitForFunction(() => {
      const a = window.__rigAnim?.animator, s = a?.state;
      return !!(s?.active && s.paused && a.face.head && a.face.wrapped);
    }, null, { timeout: 180000 });
    await page.waitForTimeout(4000); // the still view converges
    Object.assign(row, await page.evaluate(() => {
      const a = window.__rigAnim.animator, f = a.face, s = a.state;
      return { clip: s.current, paused: s.paused, head: f.head?.key, bones: f.head?.bones.length,
        masks: f.masks.map(m => m.name), wraps: f.wraps.length, posed: f.posed, wrapped: f.wrapped };
    }));
    await page.screenshot({ path: path.join(scratch, `prod-${c.name}.png`) });
  } catch (e) { row.error = String(e).slice(0, 300); }
  row.faceFiles = [...faces]; row.faceNon200 = faces.filter(f => !f.startsWith("200")); row.errors = [...new Set(errors)].slice(0, 8);
  result.cases.push(row);
}
result.ok = result.cases.every(c => !c.error && c.posed && c.wrapped && !c.faceNon200.length && c.faceFiles.length > 0);
writeFileSync(path.join(here, "prod-check.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close(); await server.close();
