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
import { pathToFileURL } from "node:url";

const pkgOf = ref => ref?.ObjectPath ? ref.ObjectPath.replace(/\.\d+$/, "") : ref?.AssetPathName?.split(".")[0] ?? null;
const nameOf = ref => ref?.ObjectName?.match(/'([^']+)'/)?.[1]?.split(":").at(-1) ?? null;

/** One prop actor Blueprint (its CUE4Parse JSON exports) -> its survey entry. `file` only fills `package`. */
export function surveyActor(exports, actor, file = "") {
  const cls = exports.find(e => e.Type === "BlueprintGeneratedClass");
  const nodes = exports.filter(e => e.Type === "SCS_Node");
  // The Blueprint's component tree (SimpleConstructionScript). A root node names its parent in
  // ParentComponentOrVariableName (an inherited component such as "Mesh"); every other node is listed in its parent's
  // ChildNodes, and AttachToName is the socket (usually a bone) on that parent. Until 11 Nov 2026 only the first was
  // read, so children lost their parent: the Puppeteer doll lost its 0.3-scaled leader (3.3x too big) and the
  // CoconutRider cans fell off the leader skeleton's prop_01 / weapon_root to the actor origin.
  const templateOf = n => nameOf(n.Properties?.ComponentTemplate);
  const nodeByName = new Map(nodes.map(n => [n.Name, n]));
  const parentOf = new Map(), socketOf = new Map(); // component name -> parent component / socket on it
  for (const n of nodes) {
    const p = n.Properties ?? {};
    if (p.ParentComponentOrVariableName) parentOf.set(templateOf(n), p.ParentComponentOrVariableName);
    if (p.AttachToName && p.AttachToName !== "None") socketOf.set(templateOf(n), p.AttachToName);
    for (const child of p.ChildNodes ?? []) {
      const childNode = nodeByName.get(nameOf(child)?.split(".").at(-1));
      if (childNode) parentOf.set(templateOf(childNode), templateOf(n));
    }
  }
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
      attachSocket: p.AttachSocketName ?? socketOf.get(e.Name) ?? null,
    });
  }
  const meshes = components.filter(c => (c.staticMesh || c.skeletalMesh) && c.visible);
  return {
    actor, package: file.replace(/\\/g, "/").split("json-prop-actors/")[1]?.replace(/\.json$/, ".uasset"),
    parentClass: nameOf(cls?.SuperStruct) ?? cls?.SuperStruct?.ObjectName ?? null,
    kind: meshes.some(c => c.skeletalMesh) ? "skeletal" : meshes.length ? "static" : components.some(c => /Niagara/.test(c.type)) ? "effects" : "empty",
    components,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
    arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const survey = walk(resolve(args.json)).map(file => surveyActor(JSON.parse(readFileSync(file, "utf8")), basename(file, ".json"), file));
  survey.sort((a, b) => a.actor.localeCompare(b.actor));
  writeFileSync(resolve(args.out), JSON.stringify(survey, null, 2));
  const count = k => survey.filter(s => s.kind === k).length;
  console.log(`${survey.length} actors: static ${count("static")}, skeletal ${count("skeletal")}, effects-only ${count("effects")}, empty ${count("empty")}`);
  const anim = survey.flatMap(s => s.components.filter(c => c.skeletalMesh && c.visible).map(c => c.animClass ? "AnimBlueprint" : c.animToPlay ? "AnimSequence" : "none"));
  console.log("skeletal prop animation:", Object.entries(anim.reduce((m, k) => (m[k] = (m[k] ?? 0) + 1, m), {})));
  console.log("parent classes:", Object.entries(survey.reduce((m, s) => (m[s.parentClass] = (m[s.parentClass] ?? 0) + 1, m), {})));
  console.log("mesh components per actor:", Object.entries(survey.reduce((m, s) => { const n = s.components.filter(c => (c.staticMesh || c.skeletalMesh) && c.visible).length; m[n] = (m[n] ?? 0) + 1; return m; }, {})));
}
