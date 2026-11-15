#!/usr/bin/env node
// The Chinals emote set for Chinals mode (12 Nov 2026, src/lib/site-mode.ts). convert-clips.mjs wrote the clips with
// labels only, so the picker listed them as unlisted animations. This adds what the picker shows for an emote, from
// offline reads of the Chinals client's files:
//   * names: the game's English text where the emote has one (emote-names.json `src`); otherwise the Chinese name is
//     the label, and the working translation from convert-clips' label ("心动协议左 (Heartbeat Protocol, left)") is kept
//     as `translation`, which the picker marks as this site's own, unofficial;
//   * the Chinese description (DA_UIMetaData_Emote_*.json), for search;
//   * props and effects from each sequence's notifies (research/emote-catalog.json), as build-emote-catalog.mjs does;
//   * icons decoded by ChinalsProbe's texture mode, cut and sized as build-emote-catalog.mjs does.
// It copies the clip files into a NEW set directory (runs are kept), keeps the previous manifest beside the new one,
// and refuses to change any clip id: ids are part of share links (?emote=cn-…).
//
// Usage (Git Bash or PowerShell, worktree root):
//   node scripts/anim-export/chinals-emote-set.mjs --root scripts/generated/chinals-emotes \
//     --research scripts/generated/chinals-emotes/research --icons scripts/generated/chinals-emotes/research/icons-1 --to set-3
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import sharp from "sharp";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
  arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
for (const required of ["root", "research", "icons", "to"]) if (!args[required]) throw new Error(`--${required} is required`);
const root = resolve(args.root), research = resolve(args.research), icons = resolve(args.icons), to = args.to;
const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const from = manifest.base?.replace(/\/$/, "");
if (!from) throw new Error("The manifest names no set directory (base)");
const out = join(root, to);
if (existsSync(out)) throw new Error(`${out} already exists; choose a new set directory (runs are kept)`);
const backup = join(root, `manifest.${from}.json`);
if (existsSync(backup)) throw new Error(`${backup} already exists; the previous manifest would be lost`);

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const read = file => JSON.parse(readFileSync(join(research, file), "utf8"));
const names = new Map(read("emote-names.json").map(n => [n.anim.toLowerCase(), n]));
const notifies = new Map(read("emote-catalog.json").map(e => [e.sequence.toLowerCase(), e.notifies]));
const metadata = new Map(walk(join(research, "json-meta")).filter(f => f.endsWith(".json"))
  .map(f => [basename(f, ".json").replace(/^DA_UIMetaData_Emote_/, "").toLowerCase(), JSON.parse(readFileSync(f, "utf8"))]));
const iconFiles = new Map(walk(icons).filter(f => f.endsWith(".png")).map(f => [basename(f, ".png").toLowerCase(), f]));

const han = /\p{Script=Han}/u;
const assetName = path => path?.split("/").at(-1)?.split(".")[0] ?? null;
// Spawned actors named *_FX_Prop / *VFX* carry only particle effects: effects, not props (build-emote-catalog.mjs).
const effectActor = name => /(^|_)V?FX(_|$)|VFX/i.test(name);

mkdirSync(join(out, "icons"), { recursive: true });
const thumbs = new Map();
async function thumbnail(iconPath) {
  const name = assetName(iconPath);
  if (thumbs.has(name)) return thumbs.get(name);
  const png = iconFiles.get(name.toLowerCase());
  if (!png) throw new Error(`No decoded icon ${name}`);
  // The same tilted card on a pale backdrop as the global icons: keep the card, drop most of the backdrop.
  const meta = await sharp(png).metadata();
  const crop = { left: Math.round(meta.width * 0.11), top: Math.round(meta.height * 0.09), width: Math.round(meta.width * 0.78), height: Math.round(meta.height * 0.8) };
  const file = `${name}.webp`;
  await sharp(png).extract(crop).resize(160, 160, { fit: "cover", position: "centre" }).webp({ quality: 80 }).toFile(join(out, "icons", file));
  thumbs.set(name, `icons/${file}`);
  return `icons/${file}`;
}

const clips = [];
const counts = { english: 0, chinese: 0, props: 0, fx: 0 };
for (const clip of manifest.clips) {
  copyFileSync(join(root, from, clip.file), join(out, clip.file));
  if (clip.kind !== "emote") { clips.push(clip); continue; }
  const name = names.get(clip.source.toLowerCase());
  const seq = notifies.get(clip.source.toLowerCase());
  if (!name || !seq) throw new Error(`No emote record for ${clip.id} (${clip.source})`);
  const meta = metadata.get(name.id.toLowerCase())?.[0]?.Properties;
  const of = kind => [...new Set(seq.filter(n => n.kind === kind).map(n => n.asset).filter(Boolean))];
  const actors = of("prop");
  const props = actors.filter(a => !effectActor(a)), fx = [...new Set([...of("fx"), ...actors.filter(effectActor)])];
  const chinese = han.test(name.src ?? "");
  // convert-clips' label for a Chinese-only name: "<Chinese> (<working translation>)".
  const working = chinese ? /\(([^()]+)\)$/.exec(clip.label)?.[1] : undefined;
  if (chinese && !working) throw new Error(`${clip.id}: no working translation in "${clip.label}"`);
  const label = name.src || clip.label;
  counts[chinese ? "chinese" : "english"]++;
  if (props.length) counts.props++;
  if (fx.length) counts.fx++;
  clips.push({ ...clip, label, icon: await thumbnail(name.img),
    emote: { gameId: name.id, name: label, ...(working ? { translation: working } : {}),
      description: meta?.Description?.SourceString ?? "", rarity: null, season: null, props, itemProps: [], fx,
      sounds: seq.filter(n => n.kind === "sound").length } });
}

const before = manifest.clips.map(c => c.id).join("\n"), after = clips.map(c => c.id).join("\n");
if (before !== after) throw new Error("Clip ids changed: they are part of share links");
const next = { ...manifest, edition: "chinals", generatedAt: new Date().toISOString(),
  tool: "scripts/anim-export/chinals-emote-set.mjs", derivedFrom: { manifest: basename(backup), tool: manifest.tool },
  base: `${to}/`, clips };
renameSync(manifestPath, backup);
writeFileSync(manifestPath, JSON.stringify(next, null, 2));
console.log(`${clips.length} clips copied to ${to}; ${thumbs.size} icons; names: ${counts.english} English, ${counts.chinese} Chinese with a working translation; props ${counts.props}, effects ${counts.fx}`);
console.log(`previous manifest kept as ${basename(backup)}`);
