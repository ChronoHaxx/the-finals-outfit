// scan-white-patches.mjs — deterministic catalogue-wide scan for near-white patches in baked albedos.
//
// Usage:
//   node scripts/scan-white-patches.mjs
//   node scripts/scan-white-patches.mjs --output=_docs/2026-08-15-white-patch-scan.txt
//
// This is deliberately an output-only check. It reads the baked files that are already on disk;
// it does not need FINALS_DUMP and does not claim that those ignored files came from this commit.
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const ALBEDO_ROOT = resolve(ROOT, "public", "models");
const SCAN_CONCURRENCY = 8;

// Keep these thresholds identical to the heuristic recorded in _docs/2026-08-14-white-patches.md.
// A flagged image is a candidate for a white patch on an otherwise dark garment, not an automatic
// defect: genuinely white and two-tone items still need comparison with their icon.
const WHITE_CHANNEL_THRESHOLD = 245;
const WHITE_FRACTION_THRESHOLD = 0.005;
const DARK_MEAN_THRESHOLD = 170;

// Human review of the current flagged set against public/items/*.webp and the corresponding
// albedo UVs. Keep this alongside the scanner so --output reproduces the committed report rather
// than leaving the numeric result without the decision that makes the heuristic actionable.
const REVIEW_RULES = [
  ["public/models/earring/miniature-ak-01.", "legitimate", "metal hardware is white/silver in the matching miniature-AK icon"],
  ["public/models/cosmetics/casual-tall-sneakers.", "legitimate", "matching icons show white soles, toes, and laces"],
  ["public/models/cosmetics/cute-devil-horns.", "legitimate", "matching icon has a white head/base around the orange horns"],
  ["public/models/cosmetics/cowboy-low-boots.", "legitimate", "wedding icon is an intentionally white boot"],
  ["public/models/cosmetics/mexico-mariachi-sombrero.", "legitimate", "matching icon is an intentional black-and-white sombrero"],
  ["public/models/cosmetics/streetwear-oversized-bomber-jacket.", "legitimate", "matching icon includes a white under-layer and bright trim"],
  ["public/models/cosmetics/casual-sandals-with-socks.", "legitimate", "matching alien icon has bright stars, buckles, and socks"],
  ["public/models/cosmetics/military-assault-pants.", "legitimate", "matching icon is an intentional white/black camouflage variant"],
  ["public/models/cosmetics/scifi-tech-bomber-jacket.", "legitimate", "matching icon has white piping, panels, and hardware on the red jacket"],
  ["public/models/cosmetics/streetwear-commando-jacket.", "legitimate", "matching icons show white/grey hardware and two-tone camouflage panels"],
  ["public/models/cosmetics/medieval-elf-skirt-belt.", "legitimate", "albedo islands are white belt hardware; no current catalog icon exists for this legacy asset"],
  ["public/models/cosmetics/traditional-lunar-dress.", "legitimate", "matching icon has white embroidery, closures, and under-layer detail"],
  ["public/models/cosmetics/space-alien-boots.", "legitimate", "matching icons show white straps, soles, and the white/black colourway"],
  ["public/models/cosmetics/military-sniper-pants.", "legitimate", "matching icon has intentional white skull/lettering details"],
  ["public/models/cosmetics/military-assault-vest.", "legitimate", "matching icon has intentional white straps and vest hardware"],
  ["public/models/cosmetics/sport-roller-derby-hand-guards.", "legitimate", "matching icons show white hand/edge details and bright team patches"],
  ["public/models/cosmetics/traditional-lunar-bolero-short-sleeve.", "legitimate", "albedo islands are white embroidery/trim; no current catalog icon exists for this legacy asset"],
  ["public/models/cosmetics/streetwear-tech-gloves.", "legitimate", "matching icon has a white/silver team label and glove details"],
  ["public/models/cosmetics/medieval-elf-quiver.", "legitimate", "matching icons show white arrow fletching and decorative glyphs"],
  ["public/models/cosmetics/military-tactical-helmet.", "legitimate", "matching icons keep the visible helmet dark; white islands are hidden mask/attachment parts"],
  ["public/models/cosmetics/military-combat-vest.", "legitimate", "matching icon is an intentional stars-and-stripes variant"],
  ["public/models/cosmetics/military-beret.", "legitimate", "matching icon keeps the beret dark; the bright patterned island is not a visible white patch"],
  ["public/models/cosmetics/streetwear-cargo-pants.", "legitimate", "matching icons are intentional black/white, orange/green, and yellow/black variants"],
];

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    return match ? [match[1], match[2] ?? true] : [arg, true];
  }),
);

function allAlbedos(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...allAlbedos(file));
    else if (entry.isFile() && entry.name.endsWith(".albedo.webp")) files.push(file);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function displayPath(file) {
  return relative(ROOT, file).split("\\").join("/");
}

function reviewFor(path) {
  const rule = REVIEW_RULES.find(([prefix]) => path.startsWith(prefix));
  return rule ? { status: rule[1], note: rule[2] } : null;
}

async function scan(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  if (info.channels < 3) throw new Error(`${displayPath(file)} decoded with ${info.channels} channels`);
  let whitePixels = 0;
  let brightnessTotal = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > WHITE_CHANNEL_THRESHOLD && g > WHITE_CHANNEL_THRESHOLD && b > WHITE_CHANNEL_THRESHOLD) whitePixels++;
    brightnessTotal += (r + g + b) / 3;
  }
  const pixels = info.width * info.height;
  const whiteFraction = whitePixels / pixels;
  const meanBrightness = brightnessTotal / pixels;
  return {
    path: displayPath(file),
    pixels,
    whitePixels,
    whitePercent: whiteFraction * 100,
    meanBrightness,
    flagged: whiteFraction > WHITE_FRACTION_THRESHOLD && meanBrightness < DARK_MEAN_THRESHOLD,
  };
}

function report(results) {
  const flagged = results
    .filter((result) => result.flagged)
    .sort((a, b) => b.whitePercent - a.whitePercent || a.path.localeCompare(b.path));
  const lines = [
    "White-patch scan",
    "================",
    `Input: ${displayPath(ALBEDO_ROOT)}/**/*.albedo.webp`,
    `Rule: >${WHITE_FRACTION_THRESHOLD * 100}% of pixels have R/G/B > ${WHITE_CHANNEL_THRESHOLD} and mean byte brightness < ${DARK_MEAN_THRESHOLD}`,
    `Albedos scanned: ${results.length}`,
    `Albedos flagged: ${flagged.length}`,
    "",
    "Flagged albedos (descending near-white pixel incidence):",
  ];
  if (flagged.length === 0) lines.push("(none)");
  else {
    for (const result of flagged) {
      const review = reviewFor(result.path);
      lines.push(
        `- ${result.path} | near-white=${result.whitePercent.toFixed(2)}% (${result.whitePixels}/${result.pixels}) | mean=${result.meanBrightness.toFixed(1)} | review=${review?.status ?? "unreviewed"}${review ? `: ${review.note}` : ""}`,
      );
    }
  }
  lines.push(
    "",
    "Interpretation: a flag is a screening result, not proof of a defect; compare each item with its icon.",
    `Icon review: ${flagged.filter((result) => reviewFor(result.path)?.status === "legitimate").length}/${flagged.length} flagged items are confirmed legitimate white/two-tone detail or non-visible UV islands.`,
    `Still broken: ${flagged.some((result) => reviewFor(result.path)?.status === "broken") ? flagged.filter((result) => reviewFor(result.path)?.status === "broken").map((result) => result.path).join(", ") : "none identified among the flagged items"}.`,
    "Provenance: these are the baked albedos present on disk at scan time. The ignored outputs cannot be attributed to a particular commit range without bake metadata.",
  );
  return `${lines.join("\n")}\n`;
}

if (!existsSync(ALBEDO_ROOT)) {
  throw new Error(`missing baked albedo directory: ${displayPath(ALBEDO_ROOT)}`);
}

const files = allAlbedos(ALBEDO_ROOT);
const results = [];
for (let i = 0; i < files.length; i += SCAN_CONCURRENCY) {
  results.push(...(await Promise.all(files.slice(i, i + SCAN_CONCURRENCY).map(scan))));
}
const output = report(results);
process.stdout.write(output);

if (args.output) {
  const outputFile = resolve(ROOT, String(args.output));
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, output);
}
