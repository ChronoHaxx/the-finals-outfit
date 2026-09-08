// Run with: node --import tsx scripts/shader-probe/check-source-assembly.mjs
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { resolveSourceOutfit } from "../../src/rig/SourceAssembly.ts";

const path = (value = "") => ({ AssetPathName: value });
function fixture(id, tags = [], overrides = [], effect = "") {
  return { formatVersion: 1, id, source: `fixture/${id}`, sourceSha256: "synthetic",
    properties: { ActivatesTags: tags, Slots: ["EBodySlot::Wrist"],
      VisualParts: [{ StaticMesh: path("mesh"), SkeletalMesh: path(), Effect: path(effect), TagOverrides: overrides }] } };
}
const hide = { MatchingTags: ["Covered"], bOverrideMesh: true, ReplacementStaticMesh: path(), ReplacementSkeletalMesh: path() };
const watch = fixture("watch", [], [hide]);
const coat = fixture("coat", ["Covered.Wrists"]);
assert.equal(resolveSourceOutfit([watch]).items.watch.hidden, false);
assert.equal(resolveSourceOutfit([watch, coat]).items.watch.hidden, true);
assert.equal(resolveSourceOutfit([watch]).items.watch.hidden, false, "Removing the source of a tag must restore the item");
assert.equal(resolveSourceOutfit([watch, coat, fixture("shirt", ["Covered"])]).items.watch.hidden, true);
assert.equal(resolveSourceOutfit([fixture("effect", [], [hide], "spark"), coat]).items.effect.hidden, false);
assert.equal(resolveSourceOutfit([fixture("ambiguous", [], [hide, { ...hide, ReplacementStaticMesh: path("replacement") }]), coat]).items.ambiguous.hidden, false);
assert.equal(resolveSourceOutfit([fixture("multi", [], [{ ...hide, MatchingTags: ["Covered", "Other"] }]), coat]).items.multi.hidden, false);
assert.equal(resolveSourceOutfit([watch, fixture("occupant")]).items.watch.hidden, false, "Occupied slots are not hide instructions");
const noParts = fixture("decal"); noParts.properties.VisualParts = [];
assert.equal(resolveSourceOutfit([noParts]).items.decal.hidden, false);
const recolor = { MatchingTags: ["Covered"], bOverrideMaterials: true,
  MaterialOverrides: [{ Key: "NativeSlot", Value: path("changed-material") }] };
const materialItem = fixture("material-item", [], [recolor]);
materialItem.properties.MaterialOverrides = [{ Key: "NativeSlot", Value: path("base-material") }];
assert.equal(resolveSourceOutfit([materialItem]).items["material-item"].parts[0].materials.NativeSlot, "base-material");
assert.equal(resolveSourceOutfit([materialItem, coat]).items["material-item"].parts[0].materials.NativeSlot, "changed-material");
const conflict = fixture("material-conflict", [], [recolor, { ...recolor,
  MaterialOverrides: [{ Key: "NativeSlot", Value: path("other-material") }] }]);
assert(resolveSourceOutfit([conflict, coat]).items["material-conflict"].parts[0].unresolved.includes("conflicting material overrides: NativeSlot"));
const offset = fixture("offset", [], [{ MatchingTags: ["Covered"], bOffsetTransform: true }]);
assert(resolveSourceOutfit([offset, coat]).items.offset.parts[0].unresolved.length > 0);
if (process.argv.includes("--synthetic-only")) {
  console.log("Synthetic source-assembly fixtures passed");
  process.exit(0);
}

const load = id => JSON.parse(readFileSync(`public/models/reconstructed-assembly-v2/items/${id}.json`, "utf8"));
const coatId = "casual-longcoat-leather-black";
const watchId = "watches-digitalretro-01";
const helmetId = "actionhero-sentinelhelmet-metal-blackdissun";
const hairId = "hairs-afrofade";
const source = resolveSourceOutfit([load(watchId), load(coatId)], ["Customization.Archetype.Medium"]);
assert.equal(source.items[watchId].hidden, true);
assert.equal(resolveSourceOutfit([load(hairId), load(helmetId)]).items[hairId].hidden, true);
const camo = resolveSourceOutfit([load("casual-longcoat-leather-camo")], ["Customization.Archetype.Light"]);
assert.equal(camo.items["casual-longcoat-leather-camo"].parts.length, 4);
assert(camo.items["casual-longcoat-leather-camo"].parts.every(p => p.skeletalMesh.includes("_L.")));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = [];
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const initial = "1." + Buffer.from(JSON.stringify({ slots: { wrist: watchId } })).toString("base64url");
  await page.goto(`http://127.0.0.1:5173/?outfit=${initial}&reconstructed=1&pose=a`, { waitUntil: "networkidle" });
  async function check(name, item, hidden) {
    await page.waitForFunction(() => window.__rigIdle === true && !!window.__sourceAssembly, undefined, { timeout: 60000 });
    const state = await page.evaluate((id) => {
      const objects = [];
      window.__rigRoot.traverse(o => { if (o.userData.rigItemId === id) objects.push({ visible: o.visible, type: o.type }); });
      return { hidden: window.__sourceAssembly.items[id]?.hidden, objects };
    }, item);
    assert.equal(state.hidden, hidden, name);
    assert(state.objects.length > 0 && state.objects.every(o => o.visible === !hidden), `${name}: ${JSON.stringify(state)}`);
    assert.deepEqual(errors, []);
    report.push({ name, passed: true, state });
  }
  async function swap(slots) {
    await page.evaluate(async value => {
      const { useBuildStore } = await import("/src/store/useBuildStore.ts");
      window.__rigIdle = false;
      useBuildStore.getState().load(value);
    }, slots);
  }
  await check("Watch visible without covered wrists", watchId, false);
  await swap({ wrist: watchId, outerwear: coatId });
  await check("Coat hides attached watch", watchId, true);
  await swap({ wrist: watchId });
  await check("Removing coat restores attached watch", watchId, false);
  await swap({ hair: hairId });
  await check("Hair visible without helmet", hairId, false);
  await swap({ hair: hairId, headwear: helmetId });
  await check("Helmet hides hair", hairId, true);
  await swap({ hair: hairId });
  await check("Removing helmet restores hair", hairId, false);
  // A malformed definition must be visible as an error, then retryable in the
  // same page after the source response recovers (not stuck in the JSON cache).
  await page.route(`**/reconstructed-assembly-v2/items/${coatId}.json`, route => route.fulfill({ json: {} }));
  // The coat was already cached in this page, so start a fresh page load once to
  // inject the failure. Recovery below deliberately uses the same loaded page.
  const invalidOutfit = "1." + Buffer.from(JSON.stringify({ slots: { wrist: watchId, outerwear: coatId } })).toString("base64url");
  await page.goto(`http://127.0.0.1:5173/?outfit=${invalidOutfit}&reconstructed=1&pose=a`, { waitUntil: "networkidle" });
  await page.getByText("Couldn’t load outfit fitting data.", { exact: true }).waitFor();
  assert(errors.some(e => e.includes("Invalid source definition")));
  errors.length = 0;
  await page.unrouteAll({ behavior: "wait" });
  await swap({ wrist: watchId, outerwear: coatId });
  await check("Malformed source definition is retryable", watchId, true);
  writeFileSync("visual-diff/reconstructed/source-assembly-checks.json", JSON.stringify(report, null, 2));
  console.log(`Source-rule fixtures and ${report.length} browser outfit changes passed`);
} finally { await browser.close(); }
