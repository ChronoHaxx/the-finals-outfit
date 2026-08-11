// Dev tool: inspect GLB skeletons and report body vs cosmetic bone-name overlap —
// the prerequisite for CharacterRig's skeleton rebind. Usage: node scripts/check-glb.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MODELS = resolve(dirname(fileURLToPath(import.meta.url)), "../public/models");

function glbJson(path) {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb: " + path);
  const chunkLen = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + chunkLen).toString("utf8"));
}

function bones(path) {
  const j = glbJson(path);
  const names = new Set();
  for (const skin of j.skins ?? [])
    for (const idx of skin.joints ?? []) names.add(j.nodes[idx]?.name ?? `#${idx}`);
  return names;
}

const body = bones(resolve(MODELS, "body/SK_Body_M.glb"));
console.log(`body SK_Body_M: ${body.size} bones`);
console.log(`  sample: ${[...body].slice(0, 8).join(", ")}`);

for (const c of [
  "actionhero-sentinel-top",
  "actionhero-sentinel-boots",
  "actionhero-sentinel-gloves",
  "actionhero-sentinel-pants",
]) {
  const cb = bones(resolve(MODELS, `cosmetics/${c}.glb`));
  const missing = [...cb].filter((n) => !body.has(n));
  console.log(
    `${c}: ${cb.size} bones, ${cb.size - missing.length}/${cb.size} found on body` +
      (missing.length ? `  MISSING: ${missing.slice(0, 10).join(", ")}` : "  ✓ all match"),
  );
}
