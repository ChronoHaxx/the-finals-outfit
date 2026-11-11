#!/usr/bin/env node
// Add the spawn notifies' RelativeTransform to a props.json built before 10 Nov 2026, when build-props.mjs dropped it
// (see notify-transform.mjs). The prop GLBs don't change, so a published set can be corrected without rebuilding them.
//
//   node scripts/anim-export/add-notify-transforms.mjs --props <props.json> --json <dir of emote AnimSequence JSON> \
//     --out <new props.json>
//
// The sequence JSON is AnimExport / chinals-probe json mode output for the emote sequences props.json lists (any
// layout: matched by file name). Each props.json window is matched to its notify by actor and start time (the catalog
// rounds starts to 4 decimals); a window with no match, or a sequence with no JSON, fails the run rather than leaving
// a prop silently unplaced.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { notifyTransform } from "./notify-transform.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
  arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
if (!args.props || !args.json || !args.out) throw new Error("Usage: --props <props.json> --json <dir> --out <props.json>");
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const SPAWN = /^AnimNotifyState_(Discovery)?SpawnProp$/; // build-emote-catalog.mjs's "prop" kinds
const objectName = ref => ref?.ObjectName?.match(/'([^']+)'/)?.[1] ?? null;

const props = JSON.parse(readFileSync(resolve(args.props), "utf8"));
const sequenceFiles = new Map(walk(resolve(args.json)).filter(f => f.endsWith(".json")).map(f => [basename(f, ".json"), f]));
let windows = 0, withTransform = 0;
const problems = [];
for (const [sequence, list] of Object.entries(props.emotes)) {
  const file = sequenceFiles.get(sequence);
  if (!file) { problems.push(`${sequence}: no sequence JSON`); continue; }
  const exports = JSON.parse(readFileSync(file, "utf8"));
  const anim = exports.find(e => e.Type === "AnimSequence");
  const byName = new Map(exports.map(e => [e.Name, e]));
  const notifies = [];
  for (const n of anim?.Properties?.Notifies ?? []) {
    const ex = byName.get(objectName(n.NotifyStateClass ?? n.Notify)?.split(":").at(-1));
    if (!ex || !SPAWN.test(ex.Type)) continue;
    const actor = ex.Properties?.PropActor?.ObjectPath?.split("/").at(-1)?.split(".")[0] ?? null;
    notifies.push({ actor, start: +(n.LinkValue ?? 0).toFixed(4), relativeTransform: ex.Properties?.RelativeTransform, used: false });
  }
  for (const w of list) {
    windows++;
    const match = notifies.find(n => !n.used && n.actor === w.actor && Math.abs(n.start - w.start) < 1e-3);
    if (!match) { problems.push(`${sequence}: no notify for ${w.actor} at ${w.start} s`); continue; }
    match.used = true;
    const transform = notifyTransform(match.relativeTransform);
    if (transform) { w.transform = transform; withTransform++; } else delete w.transform;
  }
}
if (problems.length) throw new Error(`${problems.length} unmatched:\n  ${problems.join("\n  ")}`);
props.notifyTransforms = { addedBy: "scripts/anim-export/add-notify-transforms.mjs", addedAt: new Date().toISOString() };
writeFileSync(resolve(args.out), JSON.stringify(props, null, 1));
console.log(`${windows} windows matched; ${withTransform} carry a transform -> ${resolve(args.out)}`);
