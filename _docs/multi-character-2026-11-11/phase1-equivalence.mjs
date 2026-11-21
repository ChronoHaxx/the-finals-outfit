// Phase 1 "no visible change" check (11 Nov 2026, multi-character design).
//
// Phase 1 moves the builder's outfit pipeline (CharacterViewer's big effect) into a reusable per-character unit. That
// must not change what the builder shows. This probe drives one fixed sequence of outfit changes through the app's
// own build store and, after each step settles, records the rig's structure: every object under the rig root with its
// effective visibility, mesh materials (type, name, normalised program key), non-zero morph weights, vertex count and
// world matrix, plus any error banner. It also screenshots the converged canvas. Record once on the code before the
// change and once after; `compare` must report no structural difference.
//
// Usage (Git Bash, worktree root, dev server running: node _docs/multi-character-2026-11-11/serve-5186.mjs):
//   node _docs/multi-character-2026-11-11/phase1-equivalence.mjs record <name>     -> phase1-<name>.json, shots/phase1-<name>/
//   node _docs/multi-character-2026-11-11/phase1-equivalence.mjs compare <a> <b>   -> differences, exit 1 if any
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:5186";
const here = path.dirname(fileURLToPath(import.meta.url));
const [mode, a, b] = process.argv.slice(2);

const START = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
// Each step is a whole build (slot -> id); together they walk the pipeline's branches: the face/hair transaction,
// head coverings, a mask's companion decal, glasses, a complete coat over a shirt and over an empty top, 2D decals,
// a face swap, legacy statics on bones, a hair swap, and removal back to the start.
const STEPS = [
  ["start", START],
  ["hair", { ...START, hair: "hairs-highponytail-black" }],
  ["helmet", { ...START, hair: "hairs-highponytail-black", headwear: "actionhero-sentinelhelmet-metal-yellow" }],
  ["mask", { ...START, hair: "hairs-highponytail-black", facewear: "attachment-ancientmask" }],
  ["glasses", { ...START, hair: "hairs-highponytail-black", eyewear: "attachment-roundsunglasses-metallic-gold" }],
  ["coat-over-shirt", { ...START, hair: "hairs-highponytail-black", outerwear: "casual-longcoat-leather-black" }],
  ["coat-no-shirt", { ...START, upperBody: undefined, hair: "hairs-highponytail-black", outerwear: "casual-longcoat-leather-black" }],
  ["decals", { ...START, hair: "hairs-highponytail-black", tattoo: "bodycosmetics-tattoos-axolotl-01",
    eyes: "bodycosmetics-eyes-blue", nailPolish: "bodycosmetics-nails-black-01", blush: "bodycosmetics-makeup-americanfootball-01" }],
  ["face-03", { ...START, face: "head-face-03-base", hair: "hairs-highponytail-black", eyes: "bodycosmetics-eyes-blue" }],
  ["accessories", { ...START, face: "head-face-03-base", hair: "hairs-highponytail-black", hands: "actionhero-sentinelgloves-leather",
    upperBack: "assets-ammobackpack", wrist: "casual-bangles-metal-gold", earrings: "bodycosmetics-earrings-bullet-01" }],
  ["hair-swap", { ...START, face: "head-face-03-base", hair: "hairs-afrofade-black", hands: "actionhero-sentinelgloves-leather" }],
  // The outfit's body type (picker, 12 Nov) flows through the pass: a morph context change with the same pieces.
  ["androgynous", { ...START, hair: "hairs-highponytail-black", outerwear: "casual-longcoat-leather-black" }, "androgynous"],
  ["masculine-again", { ...START, hair: "hairs-highponytail-black", outerwear: "casual-longcoat-leather-black" }],
  ["back-to-start", START],
].map(([name, slots, bodyType = "masculine"]) => [name, Object.fromEntries(Object.entries(slots).filter(([, id]) => id)), bodyType]);

// In the page: the rig's structure. Program keys carry a global creation counter for tinted legacy materials
// (CharacterRig tintUid); that counter is normalised away, every other part of the key is kept.
const DUMP = () => {
  const root = window.__rigRoot, out = [];
  const round = (v) => Math.round(v * 1e4) / 1e4;
  const effectiveVisible = (o) => { for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p === root) return true; } return true; };
  const walk = (o, pathName) => {
    const entry = { path: pathName, type: o.type, visible: effectiveVisible(o) };
    if (o.isMesh) {
      const list = Array.isArray(o.material) ? o.material : [o.material];
      entry.materials = list.map(m => {
        let key = ""; try { key = m.customProgramCacheKey?.() ?? ""; } catch { key = "<throws>"; }
        return `${m.type}|${m.name}|${key.replace(/-(\d+)$/, "-#")}|${m.transparent}|${m.side}|${m.visible}`;
      });
      entry.vertices = o.geometry.attributes.position?.count ?? 0;
      if (o.morphTargetInfluences && o.morphTargetDictionary) {
        const names = Object.entries(o.morphTargetDictionary);
        entry.morphs = names.filter(([, i]) => o.morphTargetInfluences[i]).map(([n, i]) => `${n}=${round(o.morphTargetInfluences[i])}`).sort();
      }
      if (o.isSkinnedMesh) entry.bones = o.skeleton.bones.length;
    }
    entry.matrix = o.matrixWorld.elements.map(round);
    out.push(entry);
    o.children.forEach((c, i) => walk(c, `${pathName}/${c.name || c.type}#${i}`));
  };
  root.updateMatrixWorld(true);
  walk(root, "root");
  const alert = document.querySelector("[data-viewer] [role=alert]")?.textContent?.trim() ?? null;
  return { objects: out, alert };
};

async function record(name) {
  const shots = path.join(here, "shots", `phase1-${name}`);
  mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL ?? "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  await page.goto(`${BASE}/?reconstructed=1&anim=0`, { waitUntil: "load", timeout: 300000 });
  const intro = page.getByRole("button", { name: /View shared outfit|Enter builder/ });
  await page.waitForFunction("window.__rigIdle === true && !!window.__rigRoot && !!window.__temporalPreview", null, { timeout: 300000 });
  if (await intro.count()) await intro.first().click();
  const result = { base: BASE, when: new Date().toISOString(), steps: [] };
  for (const [step, slots, bodyType] of STEPS) {
    await page.evaluate(async ({ s, b }) => {
      const m = await import("/src/store/useBuildStore.ts");
      window.__rigIdle = false; // the pass this load starts sets it true when it settles
      m.useBuildStore.getState().load(s, b); // load(slots, bodyType) since the body-type picker (12 Nov)
    }, { s: slots, b: bodyType });
    await page.waitForFunction("window.__rigIdle === true", null, { timeout: 300000 });
    await page.waitForTimeout(600);
    await page.waitForFunction(() => { const s = window.__temporalPreview; return s && s.samples >= s.maxSamples; }, null, { timeout: 120000 });
    const dump = await page.evaluate(DUMP);
    await page.locator("[data-viewer] canvas").screenshot({ path: path.join(shots, `${String(result.steps.length).padStart(2, "0")}-${step}.png`) });
    result.steps.push({ step, slots, bodyType, ...dump });
    console.error(`${step}: ${dump.objects.length} objects${dump.alert ? `, alert: ${dump.alert}` : ""}`);
  }
  await browser.close();
  writeFileSync(path.join(here, `phase1-${name}.json`), JSON.stringify(result, null, 1) + "\n");
}

function compare(x, y) {
  const A = JSON.parse(readFileSync(path.join(here, `phase1-${x}.json`), "utf8"));
  const B = JSON.parse(readFileSync(path.join(here, `phase1-${y}.json`), "utf8"));
  let differences = 0;
  const report = (step, message) => { differences++; if (differences <= 60) console.log(`${step}: ${message}`); };
  for (let i = 0; i < Math.max(A.steps.length, B.steps.length); i++) {
    const s = A.steps[i], t = B.steps[i];
    if (!s || !t || s.step !== t.step) { report(i, "step lists differ"); continue; }
    if (s.alert !== t.alert) report(s.step, `alert ${JSON.stringify(s.alert)} vs ${JSON.stringify(t.alert)}`);
    const byPath = (list) => new Map(list.map(o => [o.path, o]));
    const ma = byPath(s.objects), mb = byPath(t.objects);
    for (const [p, o] of ma) {
      const q = mb.get(p);
      if (!q) { report(s.step, `only in ${x}: ${p}`); continue; }
      for (const key of ["type", "visible", "vertices", "bones"]) if (o[key] !== q[key]) report(s.step, `${p} ${key} ${o[key]} vs ${q[key]}`);
      for (const key of ["materials", "morphs", "matrix"]) if (JSON.stringify(o[key]) !== JSON.stringify(q[key])) report(s.step, `${p} ${key} differ`);
    }
    for (const p of mb.keys()) if (!ma.has(p)) report(s.step, `only in ${y}: ${p}`);
  }
  console.log(differences ? `${differences} structural differences` : `no structural differences over ${A.steps.length} steps`);
  process.exitCode = differences ? 1 : 0;
}

if (mode === "record" && a) await record(a);
else if (mode === "compare" && a && b) compare(a, b);
else { console.error("Usage: phase1-equivalence.mjs record <name> | compare <a> <b>"); process.exitCode = 2; }
