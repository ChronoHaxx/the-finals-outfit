# Verification Matrix (core + machine aspects) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a verdict store whose marks are keyed by a hash of the inputs they were made against, plus the five machine-decided checks that can populate it without a human.

**Architecture:** A small library under `scripts/lib/verification/` computes per-aspect input hashes, reads and writes a generated JSON store, and derives a work queue by comparing stored hashes against recomputed ones. Five independent check modules each answer one aspect for one mesh or one skin. A CLI runs them and prints a report. Nothing renders; nothing needs a browser.

**Tech Stack:** Node 22 ESM, `node --test` (built-in, no new dependency), `sharp` (already a devDependency) for texture inspection, `@gltf-transform/core` (already a devDependency) for reading GLBs.

## Global Constraints

- Node 22 ESM throughout — `.mjs`, `import`, no CommonJS.
- Write files as UTF-8 **without BOM**. `Set-Content -Encoding UTF8` in PowerShell 5.1 prepends `EF BB BF` and has broken a parse in this workspace twice.
- **Never `git add -A`.** Stage explicit paths. `scripts/discord-export/` is untracked and this repo's absolute rule is that extracted material never enters git.
- The generated store is **written only by scripts, never hand-edited**.
- No new runtime dependencies. Everything used here is already in `package.json`.
- Commit as `ChronoHaxx <35618041+ChronoHaxx@users.noreply.github.com>`; verify with `git config user.email` before the first commit.
- The dump path comes from `process.env.FINALS_DUMP`, defaulting as in `scripts/bake-composite.mjs`. Checks that need the dump must skip cleanly when it is absent, not throw.

## Scope

**In:** the store, the hashing, the queue, and the five machine aspects — transform, geometry, UV, bindings, body-culling.

**Out, deliberately:** colour, surface and effects. Those are human-judged and every mark would expire the moment lighting calibration (README roadmap item 0) lands. They need dev mode (item 2) as a review surface. Second plan.

---

## File Structure

| Path | Responsibility |
|---|---|
| `scripts/lib/verification/hash.mjs` | file + value hashing, one exported function each |
| `scripts/lib/verification/inputs.mjs` | per-aspect input sets → a single hash |
| `scripts/lib/verification/store.mjs` | load/save the generated store, hash-keyed |
| `scripts/lib/verification/queue.mjs` | derive absent/stale/current from store + inputs |
| `scripts/lib/verification/checks/geometry.mjs` | one aspect |
| `scripts/lib/verification/checks/uv.mjs` | one aspect |
| `scripts/lib/verification/checks/transform.mjs` | one aspect |
| `scripts/lib/verification/checks/bindings.mjs` | one aspect |
| `scripts/lib/verification/checks/body-culling.mjs` | one aspect |
| `scripts/verify.mjs` | CLI: run checks, write store, print report |
| `scripts/verification.generated.json` | the store (generated) |
| `tests/verification/*.test.mjs` | tests |

The store sits at `scripts/` root rather than under `scripts/visual-diff/` as the design said, because it now covers geometry, UV and transform — none of which are visual-diff concerns. Stated as a deliberate deviation.

---

### Task 1: Test harness and hashing

**Files:**
- Modify: `package.json` (add `test` script)
- Create: `scripts/lib/verification/hash.mjs`
- Test: `tests/verification/hash.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `hashFiles(paths: string[]): Promise<string>` — sha256 hex over the contents of each existing path in the order given, with missing paths contributing a fixed sentinel. `hashValues(values: unknown[]): string` — sha256 hex over `JSON.stringify` of the array.

- [ ] **Step 1: Write the failing test**

Create `tests/verification/hash.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashFiles, hashValues } from "../../scripts/lib/verification/hash.mjs";

const dir = mkdtempSync(join(tmpdir(), "vhash-"));
const a = join(dir, "a.txt");
const b = join(dir, "b.txt");
writeFileSync(a, "alpha");
writeFileSync(b, "beta");

test("hashFiles is stable for the same content", async () => {
  assert.equal(await hashFiles([a]), await hashFiles([a]));
});

test("hashFiles changes when content changes", async () => {
  const before = await hashFiles([a]);
  writeFileSync(a, "alpha!");
  assert.notEqual(await hashFiles([a]), before);
  writeFileSync(a, "alpha");
});

test("hashFiles is order-sensitive", async () => {
  assert.notEqual(await hashFiles([a, b]), await hashFiles([b, a]));
});

test("a missing file is not the same as an empty one", async () => {
  const missing = join(dir, "nope.txt");
  const empty = join(dir, "empty.txt");
  writeFileSync(empty, "");
  assert.notEqual(await hashFiles([missing]), await hashFiles([empty]));
});

test("hashValues is stable and sensitive", () => {
  assert.equal(hashValues([1, "x"]), hashValues([1, "x"]));
  assert.notEqual(hashValues([1, "x"]), hashValues([1, "y"]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verification/hash.test.mjs`
Expected: FAIL — `package.json` has no `test` script yet, or the module does not exist.

- [ ] **Step 3: Add the test script**

In `package.json`, add to `scripts`:

```json
"test": "node --test"
```

- [ ] **Step 4: Write the implementation**

Create `scripts/lib/verification/hash.mjs`:

```js
// Hashing for verification input sets. A verdict stores the hash of the inputs it was
// made against; when the recomputed hash differs, the verdict is stale.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// A missing file must hash differently from an empty one: "the mask does not exist" and
// "the mask exists and is blank" are different states and must not collide.
const MISSING = "\0<missing>";

export async function hashFiles(paths) {
  const h = createHash("sha256");
  for (const p of paths) {
    h.update(p);
    try {
      h.update(await readFile(p));
    } catch {
      h.update(MISSING);
    }
  }
  return h.digest("hex");
}

export function hashValues(values) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/verification/hash.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/lib/verification/hash.mjs tests/verification/hash.test.mjs
git commit -m "Add node --test harness and verification hashing"
```

---

### Task 2: Per-aspect input sets

**Files:**
- Create: `scripts/lib/verification/inputs.mjs`
- Test: `tests/verification/inputs.test.mjs`

**Interfaces:**
- Consumes: `hashFiles`, `hashValues` from Task 1.
- Produces:
  - `ASPECTS: readonly string[]` — `["transform","geometry","uv","bindings","bodyCulling"]`
  - `CHECK_VERSION: Record<string, number>` — bumped when a check's logic changes.
  - `aspectKey(item, aspect): { key: string, scope: "mesh"|"skin" }` — the identity a verdict is stored under.
  - `inputHash(item, aspect, root): Promise<string>` — the hash for that item and aspect.

- [ ] **Step 1: Write the failing test**

Create `tests/verification/inputs.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ASPECTS, aspectKey } from "../../scripts/lib/verification/inputs.mjs";

const shirtRed = {
  id: "shirt-red",
  model: { gltfPath: "models/cosmetics/shirt.glb", material: { bakedSet: { albedo: "a-red.webp", normal: "n.webp", orm: "o-red.webp" } } },
  slot: "upperBody",
};
const shirtBlue = {
  id: "shirt-blue",
  model: { gltfPath: "models/cosmetics/shirt.glb", material: { bakedSet: { albedo: "a-blue.webp", normal: "n.webp", orm: "o-blue.webp" } } },
  slot: "upperBody",
};

test("the five machine aspects are declared", () => {
  assert.deepEqual([...ASPECTS], ["transform", "geometry", "uv", "bindings", "bodyCulling"]);
});

test("mesh-scoped aspects share a key across colourways", () => {
  for (const aspect of ["geometry", "uv", "bodyCulling"]) {
    const a = aspectKey(shirtRed, aspect);
    const b = aspectKey(shirtBlue, aspect);
    assert.equal(a.scope, "mesh");
    assert.equal(a.key, b.key, `${aspect} must dedupe across skins`);
  }
});

test("skin-scoped aspects do not share a key", () => {
  const a = aspectKey(shirtRed, "bindings");
  const b = aspectKey(shirtBlue, "bindings");
  assert.equal(a.scope, "skin");
  assert.notEqual(a.key, b.key);
});

test("transform is mesh-scoped but slot-sensitive", () => {
  const a = aspectKey(shirtRed, "transform");
  const b = aspectKey({ ...shirtRed, slot: "earrings" }, "transform");
  assert.equal(a.scope, "mesh");
  assert.notEqual(a.key, b.key);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verification/inputs.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/verification/inputs.mjs`:

```js
// Which files each aspect depends on, and the identity its verdict is stored under.
//
// Most catalog items are colourways of a shared mesh (2,531 items over 847 meshes). Keying
// mesh-scoped aspects by the mesh means one verdict covers every colourway automatically —
// no dedupe logic, no "is this a variant of that" bookkeeping.
import { resolve } from "node:path";
import { hashFiles, hashValues } from "./hash.mjs";

export const ASPECTS = Object.freeze(["transform", "geometry", "uv", "bindings", "bodyCulling"]);

// Bump when a check's LOGIC changes, so improving a check re-runs it instead of silently
// inheriting verdicts made by the old one.
export const CHECK_VERSION = Object.freeze({
  transform: 1, geometry: 1, uv: 1, bindings: 1, bodyCulling: 1,
});

const MESH_SCOPED = new Set(["transform", "geometry", "uv", "bodyCulling"]);

export function aspectKey(item, aspect) {
  const mesh = item.model?.gltfPath ?? "";
  if (!MESH_SCOPED.has(aspect)) {
    const set = item.model?.material?.bakedSet;
    // Skin identity is the baked set when there is one, else the item itself.
    return { scope: "skin", key: set ? `${mesh}|${set.albedo}` : `${mesh}|${item.id}` };
  }
  // Transform depends on the slot it is equipped into (a mesh socketed to the ear behaves
  // differently from the same mesh on the wrist), so the slot joins the key.
  return { scope: "mesh", key: aspect === "transform" ? `${mesh}|${item.slot}` : mesh };
}

// Absolute paths of the files an aspect depends on. `root` is the repo root.
function inputPaths(item, aspect, root) {
  const pub = (rel) => resolve(root, "public", rel);
  const mesh = item.model?.gltfPath ? [pub(item.model.gltfPath)] : [];
  const set = item.model?.material?.bakedSet;
  switch (aspect) {
    case "geometry":
    case "uv":
    case "transform":
      return mesh;
    case "bodyCulling":
      return [
        ...mesh,
        pub("models/body/SK_Body_M.glb"),
        ...(item.model?.gltfPath ? [pub(item.model.gltfPath.replace(/\.glb$/, ".bodymask.png"))] : []),
      ];
    case "bindings":
      return [
        ...(set ? [pub(set.albedo), pub(set.normal), pub(set.orm)] : []),
        ...(set?.cutout ? [pub(set.cutout)] : []),
        ...(item.model?.material?.emissiveMap ? [pub(item.model.material.emissiveMap)] : []),
      ];
    default:
      throw new Error(`unknown aspect '${aspect}'`);
  }
}

export async function inputHash(item, aspect, root) {
  const files = await hashFiles(inputPaths(item, aspect, root));
  return hashValues([files, CHECK_VERSION[aspect], aspect]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/verification/inputs.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/verification/inputs.mjs tests/verification/inputs.test.mjs
git commit -m "Define per-aspect input sets and hash-based verdict keys"
```

---

### Task 3: The verdict store

**Files:**
- Create: `scripts/lib/verification/store.mjs`
- Test: `tests/verification/store.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `loadStore(path): Promise<Store>` where `Store = { version: 1, marks: Record<string, Record<string, Mark>> }` keyed `key → aspect → Mark`, and `Mark = { mark, by, at, inputs, note? }`.
  - `saveStore(path, store): Promise<void>` — stable key ordering so diffs are readable.
  - `setMark(store, key, aspect, mark): void`
  - `getMark(store, key, aspect): Mark | undefined`
  - `MARKS: readonly string[]` — `["pass","fail","na","notCheckable"]`

- [ ] **Step 1: Write the failing test**

Create `tests/verification/store.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStore, saveStore, setMark, getMark, MARKS } from "../../scripts/lib/verification/store.mjs";

const file = join(mkdtempSync(join(tmpdir(), "vstore-")), "v.json");

test("a missing store loads as empty, not an error", async () => {
  const s = await loadStore(file);
  assert.equal(s.version, 1);
  assert.deepEqual(s.marks, {});
});

test("marks round-trip", async () => {
  const s = await loadStore(file);
  setMark(s, "models/x.glb", "geometry", { mark: "pass", by: "agent", at: "2026-08-13", inputs: "abc" });
  await saveStore(file, s);
  const again = await loadStore(file);
  assert.equal(getMark(again, "models/x.glb", "geometry").mark, "pass");
});

test("saved keys are sorted so diffs stay readable", async () => {
  const s = await loadStore(file);
  setMark(s, "models/z.glb", "geometry", { mark: "pass", by: "agent", at: "2026-08-13", inputs: "z" });
  setMark(s, "models/a.glb", "geometry", { mark: "pass", by: "agent", at: "2026-08-13", inputs: "a" });
  await saveStore(file, s);
  const text = readFileSync(file, "utf8");
  assert.ok(text.indexOf('"models/a.glb"') < text.indexOf('"models/z.glb"'));
});

test("an unknown mark value is rejected", async () => {
  const s = await loadStore(file);
  assert.throws(() => setMark(s, "k", "geometry", { mark: "probably", by: "agent", at: "x", inputs: "y" }));
  assert.ok(MARKS.includes("notCheckable"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verification/store.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/verification/store.mjs`:

```js
// The generated verdict store. Written ONLY by scripts — never hand-edited. A file a human
// can edit starts drifting, and this workspace has already lost a dashboard twice that way.
//
// `stale` is deliberately NOT a stored mark. It is derived by comparing a mark's `inputs`
// against a freshly computed hash, so a re-bake produces no diff at all.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const MARKS = Object.freeze(["pass", "fail", "na", "notCheckable"]);

export async function loadStore(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return { version: 1, marks: parsed.marks ?? {} };
  } catch {
    return { version: 1, marks: {} };
  }
}

export function setMark(store, key, aspect, mark) {
  if (!MARKS.includes(mark.mark)) {
    throw new Error(`invalid mark '${mark.mark}' (expected one of ${MARKS.join(", ")})`);
  }
  (store.marks[key] ??= {})[aspect] = mark;
}

export function getMark(store, key, aspect) {
  return store.marks[key]?.[aspect];
}

export async function saveStore(path, store) {
  const marks = {};
  for (const key of Object.keys(store.marks).sort()) {
    marks[key] = {};
    for (const aspect of Object.keys(store.marks[key]).sort()) marks[key][aspect] = store.marks[key][aspect];
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version: 1, marks }, null, 2) + "\n", "utf8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/verification/store.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/verification/store.mjs tests/verification/store.test.mjs
git commit -m "Add the generated verdict store with sorted, script-only writes"
```

---

### Task 4: Queue derivation

**Files:**
- Create: `scripts/lib/verification/queue.mjs`
- Test: `tests/verification/queue.test.mjs`

**Interfaces:**
- Consumes: `getMark` (Task 3), `ASPECTS`, `aspectKey`, `inputHash` (Task 2).
- Produces: `deriveQueue(items, store, root, { aspects }): Promise<Entry[]>` where `Entry = { itemId, key, aspect, state: "absent"|"stale"|"current", scope }`. Deduplicated: one entry per `(key, aspect)`, carrying the first item id that maps to it.

- [ ] **Step 1: Write the failing test**

Create `tests/verification/queue.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { deriveQueue } from "../../scripts/lib/verification/queue.mjs";
import { loadStore, setMark } from "../../scripts/lib/verification/store.mjs";
import { inputHash } from "../../scripts/lib/verification/inputs.mjs";

const root = mkdtempSync(join(tmpdir(), "vqueue-"));
const glb = join(root, "public", "models", "cosmetics", "shirt.glb");
mkdirSync(dirname(glb), { recursive: true });
writeFileSync(glb, "MESHBYTES");

const mk = (id) => ({ id, slot: "upperBody", model: { gltfPath: "models/cosmetics/shirt.glb" } });
const items = [mk("shirt-red"), mk("shirt-blue")];

test("unmarked aspects are absent, and colourways collapse to one entry", async () => {
  const store = await loadStore(join(root, "none.json"));
  const q = await deriveQueue(items, store, root, { aspects: ["geometry"] });
  assert.equal(q.length, 1, "two colourways of one mesh must produce one geometry entry");
  assert.equal(q[0].state, "absent");
  assert.equal(q[0].scope, "mesh");
});

test("a matching hash reads as current; changing the mesh makes it stale", async () => {
  const store = await loadStore(join(root, "none.json"));
  const item = items[0];
  const { key } = (await import("../../scripts/lib/verification/inputs.mjs")).aspectKey(item, "geometry");
  setMark(store, key, "geometry", {
    mark: "pass", by: "agent", at: "2026-08-13",
    inputs: await inputHash(item, "geometry", root),
  });

  let q = await deriveQueue(items, store, root, { aspects: ["geometry"] });
  assert.equal(q[0].state, "current");

  writeFileSync(glb, "DIFFERENTBYTES");
  q = await deriveQueue(items, store, root, { aspects: ["geometry"] });
  assert.equal(q[0].state, "stale");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verification/queue.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/verification/queue.mjs`:

```js
// The queue is DERIVED, never maintained. "What should I work on" is a query, not a
// judgement call — which is what stops it rotting the way a hand-kept list does.
import { ASPECTS, aspectKey, inputHash } from "./inputs.mjs";
import { getMark } from "./store.mjs";

export async function deriveQueue(items, store, root, { aspects = ASPECTS } = {}) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item.model?.gltfPath) continue; // icon-only items have no mesh to check
    for (const aspect of aspects) {
      const { key, scope } = aspectKey(item, aspect);
      const dedupe = `${key}::${aspect}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const mark = getMark(store, key, aspect);
      let state = "absent";
      if (mark) {
        const current = await inputHash(item, aspect, root);
        state = mark.inputs === current ? "current" : "stale";
      }
      out.push({ itemId: item.id, key, aspect, state, scope });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/verification/queue.test.mjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/verification/queue.mjs tests/verification/queue.test.mjs
git commit -m "Derive the verification queue from stored vs recomputed hashes"
```

---

### Task 5: The geometry and UV checks

**Files:**
- Create: `scripts/lib/verification/checks/geometry.mjs`
- Create: `scripts/lib/verification/checks/uv.mjs`
- Test: `tests/verification/checks.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: each module exports `check(absGlbPath): Promise<{ mark: "pass"|"fail"|"na", note?: string }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/verification/checks.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { check as geometry } from "../../scripts/lib/verification/checks/geometry.mjs";
import { check as uv } from "../../scripts/lib/verification/checks/uv.mjs";

const REAL = "public/models/body/SK_Body_M.glb";

test("a missing file fails rather than throwing", async () => {
  const g = await geometry("does/not/exist.glb");
  assert.equal(g.mark, "fail");
  assert.match(g.note, /unreadable|missing/i);
});

test("the base body passes geometry", async () => {
  const g = await geometry(REAL);
  assert.equal(g.mark, "pass", g.note);
});

test("the base body passes UV", async () => {
  const u = await uv(REAL);
  assert.equal(u.mark, "pass", u.note);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verification/checks.test.mjs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the geometry check**

Create `scripts/lib/verification/checks/geometry.mjs`:

```js
// Geometry: does this mesh contain renderable triangles at a sane scale?
// Catches the census's `wrong-mesh` and `missing-part` classes at their cheapest —
// a collapsed or empty mesh is detectable without rendering anything.
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

// A character cosmetic larger than this is certainly mis-scaled; the tallest body is ~2m.
const MAX_EXTENT_M = 4;

export async function check(absGlbPath) {
  let doc;
  try {
    doc = await io.read(absGlbPath);
  } catch (e) {
    return { mark: "fail", note: `unreadable: ${e.message}` };
  }
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (!prims.length) return { mark: "fail", note: "no primitives" };

  let tris = 0;
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    const pos = p.getAttribute("POSITION");
    if (!pos) return { mark: "fail", note: "primitive has no POSITION" };
    const idx = p.getIndices();
    tris += (idx ? idx.getCount() : pos.getCount()) / 3;
    const min = pos.getMin([]);
    const max = pos.getMax([]);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], min[i]);
      hi[i] = Math.max(hi[i], max[i]);
    }
  }
  if (tris < 1) return { mark: "fail", note: "zero triangles" };

  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!Number.isFinite(extent)) return { mark: "fail", note: "non-finite bounds" };
  if (extent <= 0) return { mark: "fail", note: "degenerate bounds — mesh is collapsed" };
  if (extent > MAX_EXTENT_M) return { mark: "fail", note: `extent ${extent.toFixed(2)}m exceeds ${MAX_EXTENT_M}m` };

  return { mark: "pass", note: `${Math.round(tris)} triangles, extent ${extent.toFixed(2)}m` };
}
```

- [ ] **Step 4: Write the UV check**

Create `scripts/lib/verification/checks/uv.mjs`:

```js
// UV: is there a usable TEXCOORD_0, and is it in a sane range?
// Wildly out-of-range UVs are the signature behind the census's `artifact` class —
// smeared vertical stripes are what a mis-mapped texture looks like on a garment.
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

// Tiling is legitimate, so do not demand 0..1 — but a garment atlas never needs ±16.
const UV_LIMIT = 16;

export async function check(absGlbPath) {
  let doc;
  try {
    doc = await io.read(absGlbPath);
  } catch (e) {
    return { mark: "fail", note: `unreadable: ${e.message}` };
  }
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (!prims.length) return { mark: "fail", note: "no primitives" };

  let checked = 0;
  for (const p of prims) {
    const uv = p.getAttribute("TEXCOORD_0");
    if (!uv) return { mark: "fail", note: "primitive has no TEXCOORD_0" };
    const min = uv.getMin([]);
    const max = uv.getMax([]);
    for (let i = 0; i < 2; i++) {
      if (!Number.isFinite(min[i]) || !Number.isFinite(max[i])) {
        return { mark: "fail", note: "non-finite UV bounds" };
      }
      if (min[i] < -UV_LIMIT || max[i] > UV_LIMIT) {
        return { mark: "fail", note: `UV out of range: ${min[i].toFixed(1)}..${max[i].toFixed(1)}` };
      }
    }
    checked++;
  }
  return { mark: "pass", note: `${checked} primitives with TEXCOORD_0` };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/verification/checks.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/verification/checks/geometry.mjs scripts/lib/verification/checks/uv.mjs tests/verification/checks.test.mjs
git commit -m "Add geometry and UV checks reading GLBs directly"
```

---

### Task 6: The bindings, transform and body-culling checks

**Files:**
- Create: `scripts/lib/verification/checks/bindings.mjs`
- Create: `scripts/lib/verification/checks/transform.mjs`
- Create: `scripts/lib/verification/checks/body-culling.mjs`
- Test: `tests/verification/checks-material.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `bindings.check(item, root): Promise<{mark, note?}>`
  - `transform.check(absGlbPath, slot): Promise<{mark, note?}>`
  - `bodyCulling.check(item, root): Promise<{mark, note?}>`

- [ ] **Step 1: Write the failing test**

Create `tests/verification/checks-material.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { check as bindings } from "../../scripts/lib/verification/checks/bindings.mjs";
import { check as bodyCulling } from "../../scripts/lib/verification/checks/body-culling.mjs";

const ROOT = process.cwd();

test("an item with no baked set is n/a, not a failure", async () => {
  const r = await bindings({ id: "x", model: { gltfPath: "models/cosmetics/x.glb" } }, ROOT);
  assert.equal(r.mark, "na");
});

test("a baked set pointing at a missing file fails and names it", async () => {
  const r = await bindings({
    id: "x",
    model: { gltfPath: "models/cosmetics/x.glb", material: { bakedSet: {
      albedo: "models/cosmetics/nope.albedo.webp",
      normal: "models/cosmetics/nope.normal.webp",
      orm: "models/cosmetics/nope.orm.webp",
    } } },
  }, ROOT);
  assert.equal(r.mark, "fail");
  assert.match(r.note, /nope\.albedo\.webp/);
});

test("a mesh with no bodymask fails, and says so", async () => {
  const r = await bodyCulling({ id: "x", model: { gltfPath: "models/cosmetics/definitely-not-real.glb" } }, ROOT);
  assert.equal(r.mark, "fail");
  assert.match(r.note, /bodymask/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verification/checks-material.test.mjs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the bindings check**

Create `scripts/lib/verification/checks/bindings.mjs`:

```js
// Bindings: do the maps this item claims actually exist, and does the albedo carry data?
// This is the measurable half of "material" — "the albedo is the 1x1 white fallback" is a
// fact, not an opinion. Covers the census's `material-flat` and `emissive-missing` classes.
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

// An albedo with almost no tonal variation is the neutral fallback, not a garment.
const MIN_STDDEV = 2;

export async function check(item, root) {
  const set = item.model?.material?.bakedSet;
  if (!set) return { mark: "na", note: "no baked set — region-tint or plain path" };

  const rel = [set.albedo, set.normal, set.orm, set.cutout, item.model?.material?.emissiveMap].filter(Boolean);
  const missing = [];
  for (const r of rel) {
    try {
      await access(resolve(root, "public", r));
    } catch {
      missing.push(r);
    }
  }
  if (missing.length) return { mark: "fail", note: `missing: ${missing.join(", ")}` };

  try {
    const stats = await sharp(resolve(root, "public", set.albedo)).stats();
    const flat = stats.channels.every((c) => c.stdev < MIN_STDDEV);
    if (flat) return { mark: "fail", note: "albedo is uniform — neutral fallback, not a baked garment" };
  } catch (e) {
    return { mark: "fail", note: `albedo unreadable: ${e.message}` };
  }
  return { mark: "pass", note: `${rel.length} maps resolved` };
}
```

- [ ] **Step 4: Write the transform check**

Create `scripts/lib/verification/checks/transform.mjs`:

```js
// Transform: is this mesh authored where the rig expects for its slot?
//
// Statics for socketed slots (earrings, eyewear, facewear, headwear, wrist) are authored at
// the ORIGIN and re-parented onto a bone at runtime. Body-authored statics already sit at
// their part. Getting this wrong renders a 0.35m helmet 2m tall, or puts glasses behind the
// face — both observed. The check is that the mesh sits in the half the rig assumes.
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

const SOCKETED = new Set(["earrings", "eyewear", "facewear", "headwear", "wrist"]);
// Origin-authored means the mesh centre sits near y=0 rather than up at head height.
const ORIGIN_BAND_M = 0.35;

export async function check(absGlbPath, slot) {
  let doc;
  try {
    doc = await io.read(absGlbPath);
  } catch (e) {
    return { mark: "fail", note: `unreadable: ${e.message}` };
  }
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (!prims.length) return { mark: "fail", note: "no primitives" };

  let lo = Infinity;
  let hi = -Infinity;
  for (const p of prims) {
    const pos = p.getAttribute("POSITION");
    if (!pos) return { mark: "fail", note: "primitive has no POSITION" };
    lo = Math.min(lo, pos.getMin([])[1]);
    hi = Math.max(hi, pos.getMax([])[1]);
  }
  const centreY = (lo + hi) / 2;
  if (!Number.isFinite(centreY)) return { mark: "fail", note: "non-finite bounds" };

  if (!SOCKETED.has(slot)) return { mark: "na", note: `slot '${slot}' is body-authored` };

  return Math.abs(centreY) <= ORIGIN_BAND_M
    ? { mark: "pass", note: `origin-authored (centre y=${centreY.toFixed(2)}m)` }
    : { mark: "fail", note: `socketed slot but centre y=${centreY.toFixed(2)}m — not origin-authored` };
}
```

- [ ] **Step 5: Write the body-culling check**

Create `scripts/lib/verification/checks/body-culling.mjs`:

```js
// Body culling: does this mesh ship the body-hide mask the rig looks for?
//
// CharacterRig maps any equipped item to a `<name>.bodymask.png` sibling and discards the
// body texels it covers. 392 masks exist, covering 363 of 847 meshes — so the common case
// today is a garment with the whole body still rendering underneath it.
//
// Presence and non-emptiness only. Whether the mask covers the RIGHT texels needs the
// coverage bake that generates them, and belongs with that work.
import { resolve } from "node:path";
import sharp from "sharp";

// Slots that never occlude body skin, so a missing mask is correct rather than a gap.
const NO_BODY_CONTACT = new Set(["earrings", "eyewear", "facewear", "headwear", "hair", "emote"]);

export async function check(item, root) {
  const glb = item.model?.gltfPath;
  if (!glb) return { mark: "na", note: "no mesh" };
  if (NO_BODY_CONTACT.has(item.slot)) return { mark: "na", note: `slot '${item.slot}' does not occlude body skin` };

  const mask = resolve(root, "public", glb.replace(/\.glb$/, ".bodymask.png"));
  let stats;
  try {
    stats = await sharp(mask).stats();
  } catch {
    return { mark: "fail", note: "no bodymask — body renders through this garment" };
  }
  const covers = stats.channels.some((c) => c.max > 0);
  return covers
    ? { mark: "pass", note: "bodymask present and non-empty" }
    : { mark: "fail", note: "bodymask is entirely black — hides nothing" };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/verification/checks-material.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/verification/checks/bindings.mjs scripts/lib/verification/checks/transform.mjs scripts/lib/verification/checks/body-culling.mjs tests/verification/checks-material.test.mjs
git commit -m "Add bindings, transform and body-culling checks"
```

---

### Task 7: The CLI

**Files:**
- Create: `scripts/verify.mjs`
- Modify: `package.json` (add `verify` script)
- Test: `tests/verification/cli.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: `npm run verify` — runs machine checks over absent/stale entries, writes `scripts/verification.generated.json`, prints a per-aspect summary. `--dry` skips the write. `--aspect=<name>` narrows.

- [ ] **Step 1: Write the failing test**

Create `tests/verification/cli.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runVerification } from "../../scripts/verify.mjs";

test("a dry run reports counts and writes nothing", async () => {
  const report = await runVerification({ root: process.cwd(), dry: true, aspects: ["geometry"], limit: 5 });
  assert.ok(report.checked > 0, "should have checked at least one mesh");
  assert.ok(["pass", "fail"].includes(report.entries[0].mark));
  assert.equal(report.written, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verification/cli.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the CLI**

Create `scripts/verify.mjs`:

```js
// Run the machine-decided verification checks and record their verdicts.
//
//   npm run verify                     every machine aspect, whole catalog
//   npm run verify -- --aspect=uv      one aspect
//   npm run verify -- --dry            report only, write nothing
//   npm run verify -- --limit=50       first N queue entries (smoke testing)
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ASPECTS, aspectKey, inputHash } from "./lib/verification/inputs.mjs";
import { loadStore, saveStore, setMark } from "./lib/verification/store.mjs";
import { deriveQueue } from "./lib/verification/queue.mjs";
import { check as geometry } from "./lib/verification/checks/geometry.mjs";
import { check as uv } from "./lib/verification/checks/uv.mjs";
import { check as transform } from "./lib/verification/checks/transform.mjs";
import { check as bindings } from "./lib/verification/checks/bindings.mjs";
import { check as bodyCulling } from "./lib/verification/checks/body-culling.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORE = resolve(ROOT, "scripts", "verification.generated.json");

async function runOne(aspect, item, root) {
  const abs = resolve(root, "public", item.model.gltfPath);
  switch (aspect) {
    case "geometry": return geometry(abs);
    case "uv": return uv(abs);
    case "transform": return transform(abs, item.slot);
    case "bindings": return bindings(item, root);
    case "bodyCulling": return bodyCulling(item, root);
    default: throw new Error(`unknown aspect '${aspect}'`);
  }
}

export async function runVerification({ root = ROOT, dry = false, aspects = ASPECTS, limit = Infinity } = {}) {
  const items = JSON.parse(await readFile(resolve(root, "src/data/items.json"), "utf8"));
  const byId = new Map(items.map((i) => [i.id, i]));
  const store = await loadStore(STORE);

  const queue = (await deriveQueue(items, store, root, { aspects }))
    .filter((e) => e.state !== "current")
    .slice(0, limit);

  const entries = [];
  for (const e of queue) {
    const item = byId.get(e.itemId);
    const result = await runOne(e.aspect, item, root);
    setMark(store, e.key, e.aspect, {
      mark: result.mark,
      by: "agent",
      at: new Date().toISOString().slice(0, 10),
      inputs: await inputHash(item, e.aspect, root),
      ...(result.note ? { note: result.note } : {}),
    });
    entries.push({ ...e, mark: result.mark, note: result.note });
  }

  if (!dry) await saveStore(STORE, store);
  return { checked: entries.length, entries, written: !dry };
}

function summarise(report) {
  const byAspect = new Map();
  for (const e of report.entries) {
    const t = byAspect.get(e.aspect) ?? { pass: 0, fail: 0, na: 0 };
    t[e.mark] = (t[e.mark] ?? 0) + 1;
    byAspect.set(e.aspect, t);
  }
  console.log(`checked ${report.checked} entries${report.written ? "" : " (dry run — nothing written)"}\n`);
  for (const [aspect, t] of [...byAspect].sort()) {
    console.log(`  ${aspect.padEnd(13)} pass ${String(t.pass).padStart(5)}   fail ${String(t.fail).padStart(5)}   n/a ${String(t.na).padStart(5)}`);
  }
  const fails = report.entries.filter((e) => e.mark === "fail");
  if (fails.length) {
    console.log(`\nfirst failures:`);
    for (const f of fails.slice(0, 15)) console.log(`  [${f.aspect}] ${f.itemId} — ${f.note}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n, d) => {
    const m = process.argv.find((a) => a.startsWith(`--${n}=`));
    return m ? m.split("=")[1] : d;
  };
  const aspect = arg("aspect");
  summarise(await runVerification({
    dry: process.argv.includes("--dry"),
    aspects: aspect ? [aspect] : ASPECTS,
    limit: Number(arg("limit", Infinity)),
  }));
}
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `scripts`:

```json
"verify": "node scripts/verify.mjs"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/verification/cli.test.mjs`
Expected: PASS, 1 test.

- [ ] **Step 6: Run it for real and read the output**

Run: `npm run verify -- --dry --limit=200`
Expected: a per-aspect summary with non-zero counts, and a list of first failures. **Read the failures.** If `bodyCulling` reports near-100% failure that is expected and correct — 484 of 847 meshes have no mask. If `geometry` fails broadly, the check is wrong, not the catalog.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify.mjs package.json tests/verification/cli.test.mjs
git commit -m "Add npm run verify: machine checks over the derived queue"
```

---

### Task 8: Seed from the existing census

**Files:**
- Create: `scripts/lib/verification/seed-census.mjs`
- Modify: `scripts/verify.mjs` (add `--seed-census`)
- Test: `tests/verification/seed.test.mjs`

**Interfaces:**
- Consumes: `setMark` (Task 3), `aspectKey`/`inputHash` (Task 2).
- Produces: `seedFromCensus(items, store, root, verdicts): Promise<number>` — returns how many marks it wrote.

The 239 existing verdicts are real human judgements and should not be discarded. They map only onto the **human** aspects, which this plan does not check — so they are imported as `fail` marks on `colour` where the category says so, giving the future human-review plan a starting queue instead of a blank one.

- [ ] **Step 1: Write the failing test**

Create `tests/verification/seed.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedFromCensus } from "../../scripts/lib/verification/seed-census.mjs";
import { loadStore, getMark } from "../../scripts/lib/verification/store.mjs";
import { aspectKey } from "../../scripts/lib/verification/inputs.mjs";

const item = { id: "a", slot: "upperBody", model: { gltfPath: "models/cosmetics/a.glb" } };

test("colour categories seed a colour fail carrying the reviewer's note", async () => {
  const store = await loadStore("/nonexistent.json");
  const n = await seedFromCensus([item], store, process.cwd(), {
    a: { category: "color-wrong", issue: "reads grey, icon is black", score: 40 },
  });
  assert.equal(n, 1);
  const { key } = aspectKey(item, "colour");
  const m = getMark(store, key, "colour");
  assert.equal(m.mark, "fail");
  assert.equal(m.by, "human");
  assert.match(m.note, /grey/);
});

test("framing becomes notCheckable, not a failure", async () => {
  const store = await loadStore("/nonexistent.json");
  await seedFromCensus([item], store, process.cwd(), {
    a: { category: "framing", issue: "icon is a hand close-up", score: 45 },
  });
  const { key } = aspectKey(item, "colour");
  assert.equal(getMark(store, key, "colour").mark, "notCheckable");
});

test("a `good` verdict seeds nothing — it predates every current asset", async () => {
  const store = await loadStore("/nonexistent.json");
  const n = await seedFromCensus([item], store, process.cwd(), {
    a: { category: "good", issue: "matches", score: 85 },
  });
  assert.equal(n, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verification/seed.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/verification/seed-census.mjs`:

```js
// Import the 239 existing census verdicts as a starting position for the human aspects.
//
// Only FAILURES are imported. A `good` verdict is not imported as a pass, because those
// judgements were made against assets that have since been re-baked — importing them as
// passes would manufacture exactly the stale green checkmarks this system exists to stop.
// A failure is safe to import: the worst case is re-checking something already fixed.
import { aspectKey, inputHash } from "./inputs.mjs";
import { setMark } from "./store.mjs";

const CATEGORY_TO_ASPECT = {
  "color-wrong": "colour",
  "color-too-light": "colour",
  "material-flat": "surface",
  "metal-grey": "surface",
  "emissive-missing": "effects",
};

export async function seedFromCensus(items, store, root, verdicts) {
  const byId = new Map(items.map((i) => [i.id, i]));
  let written = 0;
  for (const [id, v] of Object.entries(verdicts)) {
    const item = byId.get(id);
    if (!item?.model?.gltfPath) continue;

    if (v.category === "framing") {
      const { key } = aspectKey(item, "colour");
      setMark(store, key, "colour", {
        mark: "notCheckable", by: "human", at: v.at?.slice(0, 10) ?? "2026-07-05",
        inputs: await inputHash(item, "bindings", root),
        note: v.issue ?? "icon cannot be framed by the body camera",
      });
      written++;
      continue;
    }

    const aspect = CATEGORY_TO_ASPECT[v.category];
    if (!aspect) continue; // `good`, and the mesh-level categories the machine checks own

    const { key } = aspectKey(item, aspect);
    setMark(store, key, aspect, {
      mark: "fail", by: "human", at: v.at?.slice(0, 10) ?? "2026-07-05",
      inputs: await inputHash(item, "bindings", root),
      note: v.issue ?? `census: ${v.category}`,
    });
    written++;
  }
  return written;
}
```

- [ ] **Step 4: Wire it into the CLI**

In `scripts/verify.mjs`, add the import:

```js
import { seedFromCensus } from "./lib/verification/seed-census.mjs";
```

and inside `runVerification`, immediately after `const store = await loadStore(STORE);`:

```js
  if (seedCensus) {
    const verdicts = JSON.parse(
      await readFile(resolve(root, "scripts/visual-diff/verdicts.generated.json"), "utf8"),
    );
    const n = await seedFromCensus(items, store, root, verdicts);
    console.log(`seeded ${n} human marks from the census`);
  }
```

Add `seedCensus = false` to the destructured options, and in the CLI block pass
`seedCensus: process.argv.includes("--seed-census")`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 6: Seed for real**

Run: `npm run verify -- --seed-census --dry`
Expected: `seeded N human marks from the census` where N is roughly 80 — the colour, surface, effects and framing subset of 239, not all of them.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/verification/seed-census.mjs scripts/verify.mjs tests/verification/seed.test.mjs
git commit -m "Seed human-aspect failures from the existing 239-item census"
```

---

## Self-review notes

**Spec coverage.** Eight aspects — five implemented here, three deferred with a stated reason. Hash-keyed marks: Task 2. Variations sharing verdicts: Task 2, tested. Derived staleness with no stored `stale`: Tasks 3 and 4. Script-only writes: Task 3. Derived queue: Task 4. Census seeding as priority 1: Task 8. `n/a` derived rather than hand-marked: Tasks 6 and 8.

**Deliberate deviations from the spec**, both stated at the point they occur: the store lives at `scripts/` root rather than under `visual-diff/`, because it now covers non-visual aspects; and `CHECK_VERSION` is added to the input hash so that improving a check re-runs it, which the spec did not mention and needs.

**Not covered, and correctly so.** Shared-outfit-link priority (spec priority 2) needs link telemetry that does not exist. Whether a bodymask covers the *right* texels needs the coverage bake that generates masks — that belongs with README roadmap item 3, not here.
