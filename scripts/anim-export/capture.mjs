// Showcase-animation captures (5 Nov 2026): several outfits x clips x frozen times x camera angles, full size, for
// review by eye. Drives the isolated dev server (_docs/showcase-animation-2026-11-05/serve-5181.mjs) with headless
// Chrome/Edge through playwright-core, the same launcher as scripts/visual-diff/render.mjs.
//
//   node scripts/anim-export/capture.mjs [--only=<outfit>] [--out=<dir>] [--moving]   (Git Bash or PowerShell, worktree root)
//
// One page load per outfit and angle; clips and times are then switched in place through window.__rigAnim, and each
// frame is held paused until the still-view accumulator has converged (or reports inactive) before the screenshot.
// --moving instead opens each page with the default idle playing (?anim=outfit-idle: automated browsers otherwise
// open still) and screenshots it live, twice, a second apart: the plain per-frame render a viewer sees while the
// pose moves (the accumulator is off then), not a converged paused frame.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5181";
const ONLY = (process.argv.find(a => a.startsWith("--only=")) ?? "").slice(7);
const OUT = resolve((process.argv.find(a => a.startsWith("--out=")) ?? "").slice(6) || "_docs/showcase-animation-2026-11-05/captures");

const DEFAULT = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black",
  lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const OUTFITS = {
  default: { slots: DEFAULT, clips: [["outfit-idle", 6], ["wave", 1.6], ["disco-00", 3], ["take-a-bow", 3.4], ["kung-fu-tiger", 4]] },
  longcoat: { slots: { ...DEFAULT, outerwear: "casual-longcoat-leather-black" }, clips: [["take-a-bow", 3.4], ["kung-fu-tiger", 4], ["disco-00", 3]] },
  helmet: { slots: { ...DEFAULT, headwear: "attachment-cowmascothead-cotton" }, clips: [["react-head", 1.5], ["face-palm", 2.5], ["take-a-bow", 3.4]] },
  hathair: { slots: { ...DEFAULT, hair: "hairs-highponytail-black", headwear: "cowboy-casualhat-wool" }, clips: [["react-head", 1.5], ["disco-00", 3], ["take-a-bow", 3.4]] },
  gloves: { slots: { ...DEFAULT, hands: "actionhero-sentinelgloves-leather" }, clips: [["wave", 1.6], ["clap", 1.5], ["react-hands", 2]] },
  suit: { slots: { face: DEFAULT.face, upperBody: "deepsea-deepseasuit-canvas", feet: DEFAULT.feet }, clips: [["kung-fu-tiger", 4], ["take-a-bow", 3.4], ["flex", 3]] },
  // Jiggle-bone items (garment-owned *_jj chains): tail, Santa-hat tip, ponytail.
  jiggle: { slots: { ...DEFAULT, lowerBack: "cute-tigertail-tiger", headwear: "attachment-santahat-cotton-green", hair: "hairs-highponytail-black" },
    clips: [["take-a-bow", 4.5], ["disco-00", 3], ["shadow-boxing", 2.5]] },
  // Alpha-tested and hashed surfaces (hair cards, mesh skirt, fishnet gloves): the ones a live, unaccumulated frame
  // draws differently from the converged still view.
  masked: { slots: { ...DEFAULT, hair: "hairs-highponytail-black", lowerBody: "casual-shortskirt-blackmesh",
    hands: "winter-fingerlessgloves-fishnet" }, clips: [["wave", 1.6]] },
  // Catalog emotes (set-3): prop emotes play body-only; a flag, a guitar, wings, a surfboard ride (root travel), a
  // sword, and three emotes with nothing missing.
  emotes: { slots: DEFAULT, clips: [["ace-pilot", 3], ["mariachi-guitar", 6], ["flag-japan", 3], ["rocket-surf-02", 5],
    ["samurai-cut", 3.5], ["frog", 3], ["wolf-mask", 3], ["c-pop-01", 3]] },
  // Emote props (props-3): static props on prop_01 (guitar, rocket), skeletal props playing their own sequence
  // (wings, teddy, dragon, fan, notepad) and hologram partners (two-person emotes).
  props: { slots: DEFAULT, clips: [["mariachi-guitar", 6], ["rocket-surf-02", 2.5], ["ace-pilot", 3], ["bear-hug", 3],
    ["luchador", 3], ["knighted", 4], ["summon-dragon", 4], ["sensu-fan", 3], ["detective", 3]] },
  // Props whose animation keys the root in character space (props.json space "component"), and the sensu fan
  // (an M_Invisible section left out).
  propsSpace: { slots: DEFAULT, clips: [["detective", 3], ["pirate", 4], ["judge", 2.5], ["adventurer-map", 3],
    ["stick-around", 2], ["turret-buddy", 3], ["sensu-fan", 3], ["bear-hug", 3]] },
  // The checklist emotes: tea set + twisted wrist, the samurai cut targets, the hologram partner.
  checklist: { slots: DEFAULT, clips: [["tea-bag", 3.5], ["samurai-cut", 1.5], ["luchador", 1.5]] },
};
const MOVING = process.argv.includes("--moving");
// --legacy: the complete legacy comparison path (no ?reconstructed=1), where legacy items keep their own bones.
const LEGACY = process.argv.includes("--legacy");
const ANGLES = { front: [0, 1.0, 3.6, 0, 0.9, 0], side: [3.6, 1.0, 0, 0, 0.9, 0] };

// src/lib/share-url.ts still reads the legacy ?outfit=1.<base64url {slots}> link.
const encodeOutfit = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* try next */ }
  }
  throw new Error("no Chrome/Edge found for playwright-core");
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1150 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
const log = [];
for (const [name, outfit] of Object.entries(OUTFITS)) {
  if (ONLY && name !== ONLY) continue;
  const folder = (LEGACY ? `${name}-legacy` : name) + (MOVING ? "-live" : "");
  mkdirSync(join(OUT, folder), { recursive: true });
  for (const [angle, cam] of Object.entries(ANGLES)) {
    errors.length = 0;
    const url = `${BASE}/?${LEGACY ? "" : "reconstructed=1&"}outfit=${encodeOutfit(outfit.slots)}&cam=${cam.join(",")}&fov=35`
      + (MOVING ? "&anim=outfit-idle" : "");
    await page.goto(url, { waitUntil: "load", timeout: 180000 }); // a fresh dev server optimises dependencies first
    await page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (MOVING) {
      await page.waitForFunction(() => window.__rigAnim.state().moving, null, { timeout: 30000 });
      // Two idle frames a second apart, then the outfit's first emote caught mid-motion (fast limbs: trails show here).
      const live = [["idle", 2000], ["idle", 1000], [outfit.clips[0][0], 1200]];
      for (const [clip, at] of live) {
        if (clip !== "idle") await page.evaluate(id => window.__rigAnim.play(id), clip);
        await page.waitForTimeout(at);
        const state = await page.evaluate(() => ({ ...window.__rigAnim.state(), temporal: window.__temporalPreview ? { ...window.__temporalPreview } : null }));
        const file = join(OUT, folder, `live-${clip}-${log.filter(e => e.outfit === folder && e.angle === angle).length}-${angle}.png`);
        await page.screenshot({ path: file, clip: box });
        log.push({ outfit: folder, angle, clip: `${clip} (live)`, state, file });
        console.log(`${folder} ${angle} live ${clip} (moving ${state.moving}, motion ${state.temporal?.motion}, clamp ${state.temporal?.motionClamp?.toFixed?.(2)}, px ${state.temporal?.motionPixels?.toFixed?.(2)})`);
      }
      if (errors.length) log.push({ outfit: folder, angle, errors: [...new Set(errors)] });
      continue;
    }
    // The still pose first: the baseline every animated frame is compared against.
    const shots = [["static", 0], ...outfit.clips];
    for (const [clip, time] of shots) {
      if (clip !== "static") await page.evaluate(([id, t]) => window.__rigAnim.play(id, t), [clip, time]);
      // Converged still view (32 samples) or none active (no masked/additive items); then two extra frames.
      await page.waitForFunction(() => {
        const t = window.__temporalPreview;
        return !t || !t.active || t.samples >= t.maxSamples;
      }, null, { timeout: 30000 });
      await page.waitForTimeout(250);
      const file = join(OUT, folder, `${clip}${clip === "static" ? "" : "@" + time}-${angle}.png`);
      await page.screenshot({ path: file, clip: box });
      log.push({ outfit: folder, angle, clip, time, file });
      console.log(`${folder} ${angle} ${clip}@${time}`);
    }
    if (errors.length) log.push({ outfit: folder, angle, errors: [...new Set(errors)] });
  }
}
await browser.close();
writeFileSync(join(OUT, `capture-log${ONLY ? "-" + ONLY : ""}${LEGACY ? "-legacy" : ""}${MOVING ? "-live" : ""}.json`), JSON.stringify({ base: BASE, outfits: OUTFITS, angles: ANGLES, log }, null, 2));
console.log(`done -> ${OUT}`);
