#!/usr/bin/env node
// Every emote item in the installed game, and a census against the animation manifests a site serves (21 Nov 2026).
//
// THE FINALS keeps two families of emote items, both of class CharacterInGameEmoteDataAsset:
//   * DataAssets/Emotes/<Id>/DA_Emote_<Id>            the emotes added from Season 3 on;
//   * DataAssets/Emotes/InGame/DA_InGameEmote_<Id>    the Season 1-2 emotes (Applause Pause, Make It Rain, Keyed Up...).
// The 5 Nov picker inventory read only the first family, so the 66 Season 1-2 emotes were missing, and the 8 of their
// animations that the base clip list had were shown as "unlisted" animations no item plays. Each item has a
// DA_UIMetaData_* (name, description, icon) and a DA_Persistence_* (gameplay tag) beside it.
//
// Read the item JSON with a mapping that matches the build: after the 17 Nov 2026 update the 12.00 mapping misreads
// EmoteAnimSequence, RandomEmoteAnimSequences and LoopingAnimation (now soft references); patch-usmap.mjs fixes it.
//
// Usage (worktree root):
//   node scripts/anim-export/build-emote-inventory.mjs --items <json dir of DA_Emote_*/DA_InGameEmote_*> \
//     --meta <json dir holding DA_UIMetaData_*> --out <new dir> [--manifest <live manifest.json> ...]
// Writes emote-inventory.json (build-emote-catalog.mjs input) and census.json (+ census.md) into a new directory.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const multi = name => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
const one = name => multi(name)[0];
for (const required of ["items", "meta", "out"]) if (!one(required)) throw new Error(`--${required} is required`);
const out = resolve(one("out"));
if (existsSync(out)) throw new Error(`${out} already exists; choose a new directory (runs are kept)`);

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const read = file => JSON.parse(readFileSync(file, "utf8"));
const assetName = path => path?.split("/").at(-1)?.split(".")[0] ?? null;
const softPath = ref => ref?.AssetPathName ?? ref?.ObjectPath?.replace(/\.\d+$/, "") ?? null;
const enumValue = v => (typeof v === "string" ? v.split("::")[1] ?? v : null);

const metaFiles = new Map(walk(resolve(one("meta"))).filter(f => /DA_UIMetaData_(Emote|InGameEmote)_.*\.json$/.test(f)).map(f => [basename(f, ".json"), f]));
const items = [];
for (const file of walk(resolve(one("items"))).filter(f => /DA_(Emote|InGameEmote)_.*\.json$/.test(f))) {
  const inGame = basename(file).startsWith("DA_InGameEmote_");
  const id = basename(file, ".json").replace(/^DA_(InGame)?Emote_/, "");
  const da = read(file).find(e => e.Type === "CharacterInGameEmoteDataAsset");
  if (!da) throw new Error(`${file}: no CharacterInGameEmoteDataAsset export`);
  const p = da.Properties ?? {};
  const metaFile = metaFiles.get(`DA_UIMetaData_${inGame ? "InGameEmote" : "Emote"}_${id}`);
  const meta = metaFile ? read(metaFile).find(e => /MetaDataItem$/.test(e.Type))?.Properties ?? {} : {};
  const sequence = assetName(softPath(p.EmoteAnimSequence));
  const tags = p.Tags ?? [];
  items.push({
    id, family: inGame ? "inGame" : "emote", package: da.Package,
    name: meta.PrettyName?.SourceString ?? meta.PrettyName?.LocalizedString ?? null,
    description: meta.Description?.SourceString ?? "",
    sequence, sequencePath: softPath(p.EmoteAnimSequence),
    randomSequences: (p.RandomEmoteAnimSequences ?? []).map(r => assetName(softPath(r))).filter(Boolean),
    loopingSequence: assetName(softPath(p.LoopingAnimation)),
    // An unset Rarity is the class default; the Season 1-2 items set none (the store showed them without a tier).
    rarity: enumValue(p.Rarity), availability: enumValue(p.DevelopmentAvailability) ?? "DeveloperOnly",
    season: tags.find(t => t.startsWith("Online.Season.")) ?? null, tags,
    icon: meta.Image?.AssetPathName ?? null,
    hasMeta: Boolean(metaFile),
  });
}
items.sort((a, b) => a.family.localeCompare(b.family) || a.id.localeCompare(b.id));

// --- Census against the manifests the site serves ------------------------------------------------------------------
const manifests = multi("manifest").map(f => ({ file: f, manifest: read(resolve(f)) }));
const served = new Map(); // game id -> clip id, for catalog emotes; sequence (lowercase) -> clip ids for any clip
for (const { manifest } of manifests)
  for (const c of manifest.clips) {
    if (c.emote?.gameId) served.set(c.emote.gameId, c.id);
    const list = served.get(`seq:${c.source.toLowerCase()}`) ?? [];
    served.set(`seq:${c.source.toLowerCase()}`, [...list, c.id]);
  }
const census = items.map(i => {
  const asItem = served.get(i.id);
  const bySequence = i.sequence ? served.get(`seq:${i.sequence.toLowerCase()}`) ?? [] : [];
  return { id: i.id, family: i.family, name: i.name, season: i.season, availability: i.availability,
    status: asItem ? "listed" : bySequence.length ? "animation only (unlisted)" : "missing",
    clip: asItem ?? bySequence[0] ?? null, sequence: i.sequence, icon: Boolean(i.icon) };
});

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "emote-inventory.json"), JSON.stringify(items, null, 2));
writeFileSync(join(out, "census.json"), JSON.stringify({ manifests: manifests.map(m => m.file), census }, null, 2));
const count = (list, pred) => list.filter(pred).length;
const lines = [`# Emote census (${new Date().toISOString().slice(0, 10)})`, "",
  `Items: ${items.length} (${count(items, i => i.family === "emote")} DA_Emote, ${count(items, i => i.family === "inGame")} DA_InGameEmote).`,
  `User-facing: ${count(items, i => i.availability === "UserFacing")}; without a sequence: ${count(items, i => !i.sequence)}; without an icon: ${count(items, i => !i.icon)}.`,
  manifests.length ? `Against ${manifests.map(m => m.file).join(", ")}: listed ${count(census, c => c.status === "listed")}, animation only ${count(census, c => c.status.startsWith("animation"))}, missing ${count(census, c => c.status === "missing")}.` : "",
  "", "| Item | Family | Name | Season | Availability | Status | Clip | Sequence | Icon |", "|---|---|---|---|---|---|---|---|---|",
  ...census.map(c => `| ${c.id} | ${c.family} | ${c.name ?? "–"} | ${c.season?.replace("Online.Season.", "") ?? "–"} | ${c.availability} | ${c.status} | ${c.clip ?? "–"} | ${c.sequence ?? "–"} | ${c.icon ? "yes" : "no"} |`)];
writeFileSync(join(out, "census.md"), lines.join("\n") + "\n");
console.log(lines.slice(0, 5).join("\n"));
