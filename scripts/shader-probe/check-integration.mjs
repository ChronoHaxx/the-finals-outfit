// Exercise the recovered preview in the real app, including navigation and failures.
// Generated reports/screenshots contain local game data and remain ignored.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const out = resolve("visual-diff/reconstructed");
// A fresh server avoids importing a second Zustand store after Vite has hot-
// replaced the catalog in a long-running development session.
const appUrl = (process.env.APP_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1000 } });
const report = [];
let errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

const id = (suffix) => `casual-longcoat-${suffix}`;
const expectedMaterials = suffix => [id(suffix), ...(suffix === "leather-black" ? ["casual-bandagedtanktop-cotton"]
  : suffix === "satin" ? ["fancydress-lawyersuitjacket-velvet"]
  : ["medieval-tacticalknighttop-cotton", "medieval-tacticalknightshoulderpads-metal", "medieval-tacticalknightbracers-metal"])]
  .map(id => `${id}:recovered`).sort();
function url(suffix = "leather-black") {
  const outfit = "1." + Buffer.from(JSON.stringify({ slots: { outerwear: id(suffix) } })).toString("base64url");
  return `${appUrl}/?outfit=${outfit}&reconstructed=1&isolate=1&pose=a`;
}
async function state() {
  return page.evaluate(() => {
    const meshes = [];
    window.__rigRoot?.traverse((o) => {
      if (!o.isMesh) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      meshes.push({ uuid: o.uuid, visible: o.visible, inspection: typeof o.userData.reconstructionOriginalVisibility === "boolean",
        recovered: materials.filter((m) => m.userData.reconstructed).map((m) => m.name) });
    });
    return meshes;
  });
}
async function ready(suffix) {
  await page.waitForFunction((expected) => {
    if (!window.__rigIdle) return false;
    let found = !expected;
    window.__rigRoot?.traverse((o) => {
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        if (m.name === expected) found = true;
      }
    });
    return found;
  }, suffix ? `${id(suffix)}:recovered` : null, { timeout: 60000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function swap(slots) {
  await page.evaluate(async (next) => {
    const { useBuildStore } = await import("/src/store/useBuildStore.ts");
    window.__rigIdle = false;
    useBuildStore.getState().load(next);
  }, slots);
}
function pass(name, details = {}) {
  assert.deepEqual(errors, [], `Unexpected browser errors: ${errors.join("\n")}`);
  report.push({ name, passed: true, ...details });
  writeFileSync(resolve(out, "integration-checks.json"), JSON.stringify(report, null, 2));
  console.log(`${name}: passed`);
}
async function trackTextures() {
  return page.evaluate(() => {
    window.__disposedRecoveredTextures = [];
    const textures = new Map();
    window.__rigRoot.traverse((o) => {
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        if (m.userData.reconstructed) {
          for (const t of Object.values(m.userData)) if (t?.isTexture) textures.set(t.uuid, t);
        }
      }
    });
    textures.forEach((t) => t.addEventListener("dispose", () => window.__disposedRecoveredTextures.push(t.uuid)));
    return [...textures.keys()].sort();
  });
}
async function assertDisposed(expected) {
  const actual = await page.evaluate(() => [...new Set(window.__disposedRecoveredTextures)].sort());
  assert.deepEqual(actual, expected, "Old recovered textures must be released on swap");
}

try {
  await page.goto(url(), { waitUntil: "networkidle" });
  await ready("leather-black");
  const initial = await state();
  assert(initial.filter((m) => m.visible).every((m) => m.recovered.length));
  const bodyIds = initial.filter((m) => m.inspection && !m.recovered.length).map((m) => m.uuid);
  assert(bodyIds.length > 0);
  pass("Isolated black coat");

  for (const suffix of ["leather-camo", "satin"]) {
    const textures = await trackTextures();
    await swap({ outerwear: id(suffix) });
    await ready(suffix);
    await assertDisposed(textures);
    const meshes = await state();
    assert.deepEqual(meshes.flatMap((m) => m.recovered).sort(), expectedMaterials(suffix));
    assert(meshes.filter((m) => m.visible).every((m) => m.recovered.length));
    pass(`Swap to ${suffix} and release old textures`, { releasedTextures: textures.length });
  }

  await page.getByRole("combobox", { name: "Recovered material view" }).selectOption("specular");
  await page.waitForURL((u) => u.searchParams.get("surface") === "specular");
  await ready();
  const selected = await page.evaluate(async () => (await import("/src/store/useBuildStore.ts")).useBuildStore.getState().build.outerwear);
  assert.equal(selected, id("satin"), "Changing the view must preserve the current outfit, including in-page edits");
  await ready("satin");
  assert.equal(await page.getByRole("combobox", { name: "Recovered material view" }).inputValue(), "specular");
  pass("Specular view preserves edited outfit");

  await page.getByRole("combobox", { name: "Recovered material view" }).selectOption("ao");
  await page.waitForURL((u) => u.searchParams.get("surface") === "ao");
  await ready("satin");
  pass("AO view renders");

  await page.getByRole("checkbox", { name: "Isolate recovered items" }).uncheck();
  await page.waitForURL((u) => u.searchParams.get("isolate") === "0");
  await ready("satin");
  assert((await state()).some((m) => m.visible && !m.recovered.length));
  pass("Disabling isolation restores assembled character");

  await page.getByRole("checkbox", { name: "Isolate recovered items" }).check();
  await page.waitForURL((u) => u.searchParams.get("isolate") === "1");
  await ready("satin");
  await page.getByTitle("Toggle scene lighting").click();
  await page.getByRole("button", { name: "Lobby", exact: true }).waitFor();
  await ready("satin");
  await page.getByTitle("Toggle scene lighting").click();
  await page.getByRole("button", { name: "Studio", exact: true }).waitFor();
  await ready("satin");
  pass("Shader survives both lighting changes");

  const textures = await trackTextures();
  await swap({ upperBody: "casual-basictshirt-cotton-black" });
  await ready();
  await assertDisposed(textures);
  const restored = await state();
  assert(restored.some((m) => m.visible));
  assert(restored.every((m) => !m.recovered.length && !m.inspection));
  assert.equal(await page.getByRole("combobox", { name: "Recovered material view" }).count(), 0);
  pass("Leaving recovered family restores visibility and releases textures");

  // A slow, superseded coat load must never replace the latest selection.
  await page.route("**/models/reconstructed-assemblies-v1/casual-longcoat-leather-black.json*", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const pending = page.waitForRequest((r) => r.url().includes("/reconstructed-assemblies-v1/casual-longcoat-leather-black.json"));
  await swap({ outerwear: id("leather-black") });
  await pending;
  await swap({ outerwear: id("satin") });
  await page.waitForLoadState("networkidle");
  await ready("satin");
  await page.waitForTimeout(1800);
  assert.deepEqual((await state()).flatMap((m) => m.recovered).sort(), expectedMaterials("satin"));
  await page.unrouteAll({ behavior: "wait" });
  pass("Rapid swap ignores superseded shader loads");

  // Intercept responses locally; no source files or generated assets are altered.
  const manifest = JSON.parse(readFileSync(resolve("public/models/reconstructed-assemblies-v1", `${id("satin")}.json`)));
  for (const kind of ["missing-texture", "shader-hash", "texture-hash"]) {
    errors = [];
    const pattern = kind === "missing-texture" ? `**/${manifest.textures[0].file}`
      : kind === "shader-hash" ? `**/${manifest.shader}` : `**/models/reconstructed-assemblies-v1/${id("satin")}.json*`;
    await page.route(pattern, async (route) => {
      if (kind === "missing-texture") return route.fulfill({ status: 404, body: "Missing test fixture" });
      if (kind === "shader-hash") return route.fulfill({ status: 200, body: "Corrupt shader test fixture" });
      const altered = structuredClone(manifest);
      altered.textures[0].sha256 = "0".repeat(64);
      return route.fulfill({ json: altered });
    });
    await page.goto(url("satin"), { waitUntil: "networkidle" });
    await page.getByText("Couldn’t load this shader preview.", { exact: true }).waitFor({ timeout: 60000 });
    await ready();
    assert.equal((await state()).flatMap((m) => m.recovered).length, 0);
    assert(errors.some((e) => e.includes(kind === "missing-texture" ? "404" : "hash mismatch")));
    const expectedErrors = errors;
    errors = [];
    pass(`Visible failure for ${kind}`, { expectedErrors });
    await page.unrouteAll({ behavior: "wait" });
    await swap({ upperBody: "casual-basictshirt-cotton-black" });
    await ready();
    assert.equal(await page.getByText("Couldn’t load this shader preview.", { exact: true }).count(), 0);
    assert((await state()).some((m) => m.visible));
    pass(`Recovery after ${kind}`);
  }
} catch (error) {
  report.push({ passed: false, error: String(error), errors, url: page.url(), meshes: await state() });
  writeFileSync(resolve(out, "integration-checks.json"), JSON.stringify(report, null, 2));
  await page.screenshot({ path: resolve(out, "integration-failure.png") });
  throw error;
} finally {
  await browser.close();
}
