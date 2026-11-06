#!/usr/bin/env node
// Emote prop survey (showcase animation, props phase, 5 Nov 2026): what each spawned prop actor (BP_Emote_*_Prop)
// is made of, read from the blueprints' property JSON (AnimExport json mode). Per actor: its mesh components
// (static or skeletal), their meshes, material overrides, relative transforms and parents, the skeletal ones'
// animation (an AnimBlueprint class or a single AnimSequence), and whether it is effects-only (Niagara, no mesh).
//
//   node scripts/anim-export/survey-props.mjs --json scripts/generated/anim-export/research/json-prop-actors \
//     --out scripts/generated/anim-export/research/prop-survey.json
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
  arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const pkgOf = ref => ref?.ObjectPath ? ref.ObjectPath.replace(/\.\d+$/, "") : ref?.AssetPathName?.split(".")[0] ?? null;
const nameOf = ref => ref?.ObjectName?.match(/'([^']+)'/)?.[1]?.split(":").at(-1) ?? null;

const survey = [];
for (const file of walk(resolve(args.json))) {
  const exports = JSON.parse(readFileSync(file, "utf8"));
  const actor = basename(file, ".json");
  const cls = exports.find(e => e.Type === "BlueprintGeneratedClass");
  const nodes = exports.filter(e => e.Type === "SCS_Node");
  // Component name -> SCS parent (a native component such as "Mesh", or another SCS node's variable).
  const parentOf = new Map(nodes.map(n => [nameOf(n.Properties?.ComponentTemplate), n.Properties?.ParentComponentOrVariableName ?? null]));
  const components = [];
  for (const e of exports) {
    if (!/MeshComponent$/.test(e.Type) && !/Niagara.*Component$/.test(e.Type) && e.Type !== "PointLightComponent") continue;
    const p = e.Properties ?? {};
    components.push({
      name: e.Name, type: e.Type, parent: parentOf.get(e.Name) ?? null,
      visible: p.bVisible !== false && p.bHiddenInGame !== true,
      staticMesh: pkgOf(p.StaticMesh), skeletalMesh: pkgOf(p.SkeletalMesh ?? p.SkinnedAsset),
      animClass: pkgOf(p.AnimClass), animToPlay: pkgOf(p.AnimationData?.AnimToPlay), animationMode: p.AnimationMode ?? null,
      niagara: pkgOf(p.Asset), materials: (p.OverrideMaterials ?? []).map(pkgOf),
      location: p.RelativeLocation ?? null, rotation: p.RelativeRotation ?? null, scale: p.RelativeScale3D ?? null,
      attachSocket: p.AttachSocketName ?? null,
    });
  }
  const meshes = components.filter(c => (c.staticMesh || c.skeletalMesh) && c.visible);
  survey.push({
    actor, package: file.replace(/\\/g, "/").split("json-prop-actors/")[1]?.replace(/\.json$/, ".uasset"),
    parentClass: nameOf(cls?.SuperStruct) ?? cls?.SuperStruct?.ObjectName ?? null,
    kind: meshes.some(c => c.skeletalMesh) ? "skeletal" : meshes.length ? "static" : components.some(c => /Niagara/.test(c.type)) ? "effects" : "empty",
    components,
  });
}
survey.sort((a, b) => a.actor.localeCompare(b.actor));
writeFileSync(resolve(args.out), JSON.stringify(survey, null, 2));
const count = k => survey.filter(s => s.kind === k).length;
console.log(`${survey.length} actors: static ${count("static")}, skeletal ${count("skeletal")}, effects-only ${count("effects")}, empty ${count("empty")}`);
const anim = survey.flatMap(s => s.components.filter(c => c.skeletalMesh && c.visible).map(c => c.animClass ? "AnimBlueprint" : c.animToPlay ? "AnimSequence" : "none"));
console.log("skeletal prop animation:", Object.entries(anim.reduce((m, k) => (m[k] = (m[k] ?? 0) + 1, m), {})));
console.log("parent classes:", Object.entries(survey.reduce((m, s) => (m[s.parentClass] = (m[s.parentClass] ?? 0) + 1, m), {})));
console.log("mesh components per actor:", Object.entries(survey.reduce((m, s) => { const n = s.components.filter(c => (c.staticMesh || c.skeletalMesh) && c.visible).length; m[n] = (m[n] ?? 0) + 1; return m; }, {})));
