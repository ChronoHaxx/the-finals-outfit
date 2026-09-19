// Discover complete assemblies using the same resolver used by the viewer.
// This measures asset readiness for the medium preview, not matched game fitting.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [definitionsPath, assetsPath, outputPath, resolverPath, catalogPath] = process.argv.slice(2);
const { resolveSourceOutfit, resolveSourceRigParts } = await import(resolverPath
  ? pathToFileURL(resolve(resolverPath)).href : new URL("../../src/rig/SourceAssembly.ts", import.meta.url).href);
if (!outputPath) throw new Error("Usage: node --import tsx check-assembly-coverage.mjs <customization.json> <assets.json> <supported-items.json>");
const read = path => JSON.parse(readFileSync(path, "utf8"));
const data = read(definitionsPath), assets = read(assetsPath);
const catalog = new Map(read(catalogPath ?? "src/data/items.json").map(item => [item.id, item]));
const items = [], ready = [], exceptions = [];
for (const [id, name] of Object.entries(data.catalog)) {
  const item = catalog.get(id);
  if (!item) continue;
  const definition = { ...data.definitions[name], id, formatVersion: 1 };
  const source = resolveSourceOutfit([definition], ["Customization.Archetype.Medium"]).items[id];
  try {
    const parts = resolveSourceRigParts(source, assets);
    if (!parts.length) throw new Error("No visible source geometry");
    items.push(id);
    ready.push({ id, slot: item.slot, parts, source: source.source,
      fittingPending: true });
  } catch (error) {
    exceptions.push({ id, reason: error.message });
  }
}
const report = { formatVersion: 1, context: ["Customization.Archetype.Medium"],
  scope: "Complete mesh/material bindings in standalone medium preview; outfit-dependent replacements are checked again at runtime. Fitting and matched in-game appearance remain pending.",
  items, ready, exceptions };
writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ supported: items.length, items, exceptions: exceptions.length }, null, 2));
