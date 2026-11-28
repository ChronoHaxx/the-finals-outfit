// Light unflag-bar re-check (28 Nov 2026): the 26 Nov check (light-unflag-bar-2026-11-26/capture-script.mjs) on the unflag
// branch's PRODUCTION build, served by `vite preview` with the live hosts (.env.local = deploy.yml's), and with no
// `archetypes` parameter: what a visitor gets by default. Also checks the picker in each access (default, off, on).
// Run: node capture-script.mjs <outfits.json> <out-dir> [base]   (outfits.json from outfits.ts)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [OUTFITS, OUT, BASE = "http://127.0.0.1:5181"] = process.argv.slice(2);
const outfits = JSON.parse(fs.readFileSync(OUTFITS, "utf8"));
const link = (slots, archetype, extra = "") =>
  `${BASE}/?outfit=1.${Buffer.from(JSON.stringify({ slots, archetype })).toString("base64url")}${extra}`;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const fresh = async () => {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.errors = [];
  page.on("console", m => { if (m.type() === "error") page.errors.push(m.text().split("\n")[0]); });
  page.on("pageerror", e => page.errors.push(String(e).split("\n")[0]));
  return { context, page };
};
const open = async (page, url) => {
  page.errors.length = 0;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForFunction(() => window.__rigIdle === true, undefined, { timeout: 300000 });
  // The archetype choices arrive with the index, after the body: give the picker its moment.
  await page.waitForTimeout(1500);
};
const picker = page => page.evaluate(() => {
  const group = document.querySelector('[role="radiogroup"][aria-label="Archetype"]');
  return group ? [...group.querySelectorAll('[role="radio"]')].map(b => `${b.textContent.trim()}${b.getAttribute("aria-checked") === "true" ? "*" : ""}`) : null;
});
const notice = page => page.evaluate(() => document.querySelector("[data-class-notice]")?.textContent ?? null);
const shoot = async (page, file) => {
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas"); const host = canvas?.parentElement?.parentElement;
    if (!host) throw new Error("Viewer canvas not found");
    for (let el = canvas; el && el !== document.body; el = el.parentElement)
      for (const sibling of el.parentElement?.children ?? []) if (sibling !== el) sibling.style.visibility = "hidden";
    Object.assign(host.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "9999", background: "#d3d8df" });
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(3000);
  await page.locator("canvas").first().screenshot({ path: path.join(OUT, file) });
};

const report = { access: [], outfits: [] };
const access = (step, url, result) => { report.access.push({ step, url: url.replace(BASE, ""), ...result }); console.log(step, JSON.stringify(result)); };

// 1. Default access, a first visit: the picker offers Light and Medium.
{
  const { context, page } = await fresh();
  await open(page, `${BASE}/`);
  access("default, first visit", `${BASE}/`, { picker: await picker(page), errors: [...new Set(page.errors)] });
  // 2. The bar: each outfit on Light and on Medium, by link, no parameter.
  for (const o of outfits) for (const archetype of ["light", "medium"]) {
    const url = link(o.slots, archetype);
    await open(page, url);
    const text = await notice(page), shown = await picker(page);
    const missing = text ? (text.match(/yet: ([^.]*)\./)?.[1] ?? "").split(", ").filter(Boolean) : [];
    const file = `${o.id}.${archetype}.png`;
    await shoot(page, file);
    const row = { id: o.id, name: o.name, season: o.season, archetype, pieces: Object.keys(o.slots).length, picker: shown,
      notOnClass: missing, notice: text, errors: [...new Set(page.errors)], file };
    report.outfits.push(row);
    console.log(o.id, archetype, "pieces", row.pieces, "picker", shown?.join(" "), "notOnClass", missing.length, missing.join(" | "), "errors", row.errors.length);
  }
  await context.close();
}
// 3. ?archetypes=off: no picker, a Light link renders Medium (no class notice), remembered on the next visit; default clears.
{
  const { context, page } = await fresh();
  const start = outfits.find(o => o.id === "alliancefencer") ?? outfits[0];
  let url = link(start.slots, "light", "&archetypes=off");
  await open(page, url);
  access("off: a Light link", url, { picker: await picker(page), notice: await notice(page), errors: [...new Set(page.errors)] });
  await shoot(page, `off.${start.id}.light-link.png`);
  url = link(start.slots, "light");
  await open(page, url);
  access("off remembered: the same link, no parameter", url, { picker: await picker(page), notice: await notice(page) });
  url = `${BASE}/?archetypes=default`;
  await open(page, url);
  access("default clears it", url, { picker: await picker(page) });
  await context.close();
}
// 4. ?archetypes=on (the preview): Heavy would join only with a Heavy body in the index; the live index has none.
{
  const { context, page } = await fresh();
  const url = `${BASE}/?archetypes=on`;
  await open(page, url);
  access("on (preview)", url, { picker: await picker(page), errors: [...new Set(page.errors)] });
  await context.close();
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1) + "\n");
await browser.close();
