// functional-checklist.md part B (23 Nov 2026), by the agent under the owner's standing waiver: the dev server with the
// preview index (scripts/generated/archetypes/preview-v2: Light only), driven as a visitor through the real picker.
// Start the server first (see the checklist), then, in this worktree's root:
//   node _docs/archetypes-2026-11-22/dev-steps.mjs [--port 5197]
// Screenshots and dev-steps.json go to scripts/generated/archetypes/dev (gitignored).
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const port = process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : "5197";
const APP = `http://127.0.0.1:${port}/`;
const out = path.join(process.cwd(), "scripts/generated/archetypes/dev");
mkdirSync(out, { recursive: true });
const HOODIE_CAP = { face: "head-face-05-base", headwear: "streetwear-baseballcap-cotton-alienpatch",
  upperBody: "streetwear-hoodie-cotton-pink", lowerBody: "military-marinepants-canvas-black",
  feet: "streetwear-shoes-rubber-graywhite" };
const link = slots => `${APP}?outfit=1.${Buffer.from(JSON.stringify({ slots })).toString("base64url")}&reconstructed=1`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [], errors = [];
const record = (step, pass, detail) => { results.push({ step, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${step}: ${detail}`); };
// A visitor: the app hides its status line under automation (navigator.webdriver), so mask it as prod-steps.mjs does.
const visitor = async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  return context;
};
const context = await visitor();
const page = await context.newPage();
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
// Settled: the rig idle, then the welcome screen closed and one-time tips dismissed (they cover the controls).
const idle = async () => {
  await page.waitForFunction(() => window.__rigIdle === true, null, { timeout: 240000 });
  if (await page.locator("dialog[open]").count()) await page.keyboard.press("Escape");
  for (const tip of await page.getByLabel("Dismiss tip").all()) await tip.click().catch(() => {});
  await page.waitForTimeout(1500);
};
const hud = () => page.evaluate(() => [...document.querySelectorAll("span.hud")].map(s => s.textContent ?? "")
  .find(t => / · \d+ piece/.test(t)) ?? "");
const notice = () => page.evaluate(() => document.querySelector("[data-class-notice]")?.textContent ?? "");
const body = () => page.evaluate(() => {
  let url = "";
  window.__rigRoot.traverse(o => { if (o.isSkinnedMesh && o.userData.sourceBody) url = o.userData.sourceBodyUrl; });
  return url.split("/").pop();
});
const choices = () => page.getByRole("radiogroup", { name: "Archetype" }).getByRole("radio").allInnerTexts();
const shot = name => page.locator("canvas").first().screenshot({ path: path.join(out, `${name}.png`) });

try {
  await page.goto(link(HOODIE_CAP), { waitUntil: "domcontentloaded", timeout: 180000 });
  await idle();
  const offered = (await choices()).map(c => c.trim().toLowerCase()); // the labels render uppercase
  record("5 picker", JSON.stringify(offered) === JSON.stringify(["light", "medium"]), `choices ${JSON.stringify(await choices())}`);
  await page.getByRole("radio", { name: "Light" }).click();
  await page.waitForTimeout(500);
  await idle();
  record("6 Light", /^Light · 5 pieces/.test(await hud()) && await body() === "SK_Body_L.glb" && await notice() === "",
    `hud "${await hud()}", body ${await body()}, notice "${await notice()}"`);
  await shot("6-light");
  // The skirt's Light mesh changed on 17 Nov: left off and named; the outfit keeps it.
  await page.goto(link({ ...HOODIE_CAP, lowerBody: "casual-shortskirt-cotton-black" }), { waitUntil: "domcontentloaded", timeout: 180000 });
  await idle();
  await page.getByRole("radio", { name: "Light" }).click();
  await page.waitForTimeout(500);
  await idle();
  const left = await notice();
  record("7 skirt left off", /Not on Light yet: .*SKIRT/i.test(left) && /^Light · 5 pieces/.test(await hud()), `notice "${left}", hud "${await hud()}"`);
  await shot("7-skirt-left-off");
  // The saved outfit, not the link (the dev server's own reconstructed=1 flag stays: it is not part of the outfit).
  await page.goto(`${APP}?reconstructed=1`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await idle();
  record("7 reload keeps Light", await body() === "SK_Body_L.glb" && /^Light · /.test(await hud()), `body ${await body()}, hud "${await hud()}"`);
  await page.getByRole("button", { name: /Share outfit/i }).first().click();
  await page.waitForTimeout(1200);
  await page.getByLabel("Share link style").selectOption("short");
  await page.waitForTimeout(800);
  const shared = await page.getByLabel("Outfit share link").inputValue();
  record("7 link carries ar=l", /[?&]ar=l(&|$)/.test(shared), shared);
  const other = await visitor();
  const fresh = await other.newPage();
  await fresh.goto(`${APP}?reconstructed=1#${new URL(shared).hash.slice(1)}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await fresh.waitForFunction(() => window.__rigIdle === true, null, { timeout: 240000 });
  await fresh.waitForTimeout(1500);
  const freshBody = await fresh.evaluate(() => {
    let url = ""; window.__rigRoot.traverse(o => { if (o.isSkinnedMesh && o.userData.sourceBody) url = o.userData.sourceBodyUrl; });
    return url.split("/").pop();
  });
  record("7 the link opens on Light", freshBody === "SK_Body_L.glb", `fresh browser body ${freshBody}`);
  await other.close();
} finally {
  writeFileSync(path.join(out, "dev-steps.json"), JSON.stringify({ when: new Date().toISOString(), results, errors }, null, 2));
  console.log(`${results.filter(r => r.pass).length}/${results.length} pass; errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  await browser.close();
}
