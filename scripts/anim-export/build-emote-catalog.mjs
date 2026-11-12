#!/usr/bin/env node
// Emote catalog for the showcase picker (5 Nov 2026). Joins three offline reads of the installed Season 12 game:
//   * the emote inventory (DA_Emote_* + DA_UIMetaData: name, description, rarity, season tag, icon, AnimSequence),
//     scripts/generated/anim-export/research/emote-inventory.json;
//   * each AnimSequence package's exports (AnimExport json mode): its notifies say what else the game spawns while
//     the emote plays (props on sockets, Niagara effects, sounds), which this preview does not show yet;
//   * the decoded icons (AnimExport texture mode), turned into small WebP thumbnails here.
// It writes, into a NEW directory (runs are kept): requests.json for the exporter, clips.json for convert-clips.mjs
// (the base clip list's idles and reactions, every catalog emote, and the base emotes no catalog emote uses), the
// thumbnails, and emote-catalog.json with every notify's timing for the later props/FX phase.
//
// Usage (Git Bash or PowerShell, worktree root):
//   node scripts/anim-export/build-emote-catalog.mjs --research scripts/generated/anim-export/research \
//     --icons scripts/generated/anim-export/research/emote-icons-2 --out scripts/generated/anim-export/emotes-1
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import sharp from "sharp";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) =>
  arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs, []));
for (const required of ["research", "icons", "out"]) if (!args[required]) throw new Error(`--${required} is required`);
const research = resolve(args.research), icons = resolve(args.icons), out = resolve(args.out);
const baseClips = JSON.parse(readFileSync(resolve(args.base ?? "scripts/anim-export/clips.json"), "utf8"));
if (existsSync(out)) throw new Error(`Output ${out} already exists; choose a new directory (runs are kept)`);

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const inventory = JSON.parse(readFileSync(join(research, "emote-inventory.json"), "utf8"));
const sequenceFiles = new Map(walk(join(research, "json-emote-seqs")).map(f => [basename(f, ".json").toLowerCase(), f]));
const iconFiles = new Map(walk(icons).map(f => [basename(f, ".png").toLowerCase(), f]));

const kebab = id => id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
const spaced = id => id.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
const objectName = ref => ref?.ObjectName?.match(/'([^']+)'/)?.[1] ?? null; // "Class'Name'" -> Name
const assetName = path => path?.split("/").at(-1)?.split(".")[0] ?? null;

// --- What each sequence spawns, from its notifies -----------------------------------------------------------------
const KINDS = {
  AnimNotifyState_DiscoverySpawnProp: "prop", AnimNotifyState_SpawnProp: "prop",
  AnimNotifyState_CustomizationItemSpecificDiscoverySpawnProp: "itemProp",
  AnimNotifyState_PlayFX: "fx", AnimNotify_PlayFX: "fx",
  AnimNotifyState_TimedNiagaraEffect: "fx", AnimNotifyState_TimedNiagaraEffectAdvanced: "fx",
  AnimNotifyStatePlaySoundAttachedWithCleanup: "sound", AnimNotify_DiscoveryPlaySound: "sound", AnimNotifyVocalization: "sound",
  AnimNotify_ApplyForceToCloth: "cloth", AnimNotify_ApplyWindToCloth: "cloth",
};
function sequenceNotifies(sequence) {
  const file = sequenceFiles.get(sequence.toLowerCase());
  if (!file) throw new Error(`No exported JSON for ${sequence}`);
  const exports = JSON.parse(readFileSync(file, "utf8"));
  const anim = exports.find(e => e.Type === "AnimSequence");
  const byName = new Map(exports.map(e => [e.Name, e]));
  const notifies = [];
  for (const n of anim.Properties?.Notifies ?? []) {
    const ref = n.NotifyStateClass ?? n.Notify;
    const exportName = objectName(ref)?.split(":").at(-1);
    const ex = exportName && byName.get(exportName);
    if (!ex) continue;
    const kind = KINDS[ex.Type];
    if (!kind) continue; // HideWeapon and other gameplay-only notifies
    const p = ex.Properties ?? {};
    notifies.push({
      kind, type: ex.Type,
      start: +(n.LinkValue ?? 0).toFixed(4), duration: +(n.Duration ?? 0).toFixed(4),
      asset: assetName(p.PropActor?.ObjectPath ?? p.NiagaraSystem?.ObjectPath ?? p.Template?.ObjectPath ?? null),
      socket: p.AttachedSocket ?? p.AttachToSocket ?? p.SocketName ?? null,
      ...(p.CustomizationItem ? { item: assetName(p.CustomizationItem.AssetPathName) } : {}),
      ...(p.RelativeTransform ? { relativeTransform: p.RelativeTransform } : {}),
      // The emote's own float curves <prefix>_TranslateX/Y/Z, _RotateX/Y/Z, _ScaleX/Y/Z move this prop every frame
      // (build-props.mjs reads them; dropped until 11 Nov 2026, so the MonsterMan poles and the BlackSmith anvil stood
      // at the character's feet).
      ...(p.CurveDrivenTransformPrefix && p.CurveDrivenTransformPrefix !== "None" ? { curvePrefix: p.CurveDrivenTransformPrefix } : {}),
      ...(p.LocationOffset ? { locationOffset: p.LocationOffset } : {}),
      ...(p.RotationOffset ? { rotationOffset: p.RotationOffset } : {}),
    });
  }
  return { length: anim.Properties?.SequenceLength ?? null, notifies };
}

// --- Catalog emotes -------------------------------------------------------------------------------------------------
mkdirSync(join(out, "icons"), { recursive: true });
const RARITY_ORDER = ["Mythic", "Legendary", "Epic", "Rare", "Uncommon", "Common"];
const seasonOf = tag => Number(tag?.match(/^Online\.Season\.(\d+)/)?.[1]) || null;
const thumbs = new Map(); // icon package -> written thumbnail file name
const catalog = [], clips = [];
const sequencesUsed = new Set();
for (const e of [...inventory].sort((a, b) => a.id.localeCompare(b.id))) {
  const seq = sequenceNotifies(e.sequence);
  sequencesUsed.add(e.sequence.toLowerCase());
  const iconName = assetName(e.icon);
  let thumb = thumbs.get(iconName);
  if (!thumb) {
    const png = iconFiles.get(iconName.toLowerCase());
    if (!png) throw new Error(`No decoded icon ${iconName} for ${e.id}`);
    thumb = `${iconName}.webp`;
    // The game's icon is a tilted card on a pale backdrop; keep the card, drop most of the backdrop.
    const bytes = readFileSync(png); // bytes, not the path: libvips cannot open a Windows path of 260+ characters
    const meta = await sharp(bytes).metadata();
    const crop = { left: Math.round(meta.width * 0.11), top: Math.round(meta.height * 0.09), width: Math.round(meta.width * 0.78), height: Math.round(meta.height * 0.8) };
    await sharp(bytes).extract(crop).resize(160, 160, { fit: "cover", position: "centre" }).webp({ quality: 80 }).toFile(join(out, "icons", thumb));
    thumbs.set(iconName, thumb);
  }
  const of = kind => [...new Set(seq.notifies.filter(n => n.kind === kind).map(n => n.asset).filter(Boolean))];
  // Spawned actors named *_FX_Prop / *VFX* carry only particle effects (smoke, sparks, confetti): effects, not props.
  const effectActor = name => /(^|_)V?FX(_|$)|VFX/i.test(name);
  const actors = of("prop");
  const props = actors.filter(a => !effectActor(a)), fx = [...new Set([...of("fx"), ...actors.filter(effectActor)])];
  const itemProps = seq.notifies.filter(n => n.kind === "itemProp").map(n => ({ prop: n.asset, item: n.item }));
  const id = kebab(e.id);
  // The 36 flag emotes share one display name with a placeholder the game fills with the country ("Flag Wave: {0}");
  // the country is the item id's suffix (CountryFlag_IvoryCoast, FlagJapan).
  const filled = e.name?.includes("{0}") ? e.name.replace("{0}", spaced(e.id.replace(/^(CountryFlag_?|Flag)/, ""))) : e.name;
  const emote = {
    name: filled || spaced(e.id), ...(e.name ? {} : { unnamed: true }),
    description: e.description || "", rarity: e.rarity ?? null, season: seasonOf(e.season), seasonTag: e.season ?? null,
    props, itemProps, fx, sounds: seq.notifies.filter(n => n.kind === "sound").length,
  };
  catalog.push({ id, gameId: e.id, sequence: e.sequence, icon: e.icon, length: seq.length, ...emote, notifies: seq.notifies });
  clips.push({ id, source: e.sequence, label: emote.name, kind: "emote", icon: `icons/${thumb}`,
    emote: { gameId: e.id, ...emote } });
}

// --- Base clips: idles, reactions, and emotes no catalog entry plays ---------------------------------------------
const kept = baseClips.clips.filter(c => c.kind !== "emote" || !sequencesUsed.has(c.source.toLowerCase()));
const dropped = baseClips.clips.filter(c => !kept.includes(c)).map(c => c.id);
const ids = new Set(clips.map(c => c.id));
for (const c of kept) {
  if (ids.has(c.id)) throw new Error(`Clip id ${c.id} is both a base clip and a catalog emote`);
  // An emote animation in the game files that no Season 12 emote item plays (older or default emotes).
  clips.push(c.kind === "emote" ? { ...c, emote: { unlisted: true } } : c);
}
const ordered = [...clips.filter(c => c.kind !== "emote"), ...clips.filter(c => c.kind === "emote")];
const config = {
  comment: "Generated by scripts/anim-export/build-emote-catalog.mjs: base idles/reactions, every Season 12 emote item, unlisted base emotes.",
  defaultIdle: baseClips.defaultIdle, rarityOrder: RARITY_ORDER, clips: ordered,
};
writeFileSync(join(out, "clips.json"), JSON.stringify(config, null, 2));
const anims = [...new Set(ordered.map(c => c.source))];
writeFileSync(join(out, "requests.json"), JSON.stringify({ skeleton: "_3P_MasterSkeleton", meshes: ["SK_Body_M"], anims }, null, 2));
writeFileSync(join(out, "emote-catalog.json"), JSON.stringify(catalog, null, 2));

const count = pred => catalog.filter(pred).length;
console.log(`${catalog.length} emotes, ${new Set(catalog.map(c => c.sequence)).size} animations, ${thumbs.size} thumbnails`);
console.log(`props ${count(c => c.props.length)}, item-specific props ${count(c => c.itemProps.length)}, effects ${count(c => c.fx.length)}, plain ${count(c => !c.props.length && !c.fx.length && !c.itemProps.length)}; unnamed ${count(c => c.unnamed)}`);
console.log(`base clips kept ${kept.length} (dropped as catalog duplicates: ${dropped.join(", ") || "none"}); exporter requests ${anims.length}`);
