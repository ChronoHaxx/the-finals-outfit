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
import { seedFromCensus } from "./lib/verification/seed-census.mjs";
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

export async function runVerification({ root = ROOT, dry = false, aspects = ASPECTS, limit = Infinity, seedCensus = false } = {}) {
  const items = JSON.parse(await readFile(resolve(root, "src/data/items.json"), "utf8"));
  const byId = new Map(items.map((i) => [i.id, i]));
  const store = await loadStore(STORE);

  if (seedCensus) {
    const verdicts = JSON.parse(
      await readFile(resolve(root, "scripts/visual-diff/verdicts.generated.json"), "utf8"),
    );
    const n = await seedFromCensus(items, store, root, verdicts);
    console.log(`seeded ${n} human marks from the census`);
  }

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
    seedCensus: process.argv.includes("--seed-census"),
  }));
}
