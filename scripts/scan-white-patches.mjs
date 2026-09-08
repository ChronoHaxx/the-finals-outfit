// scan-white-patches.mjs — deterministic catalogue-wide scan for near-white patches in baked albedos.
//
// Usage:
//   node scripts/scan-white-patches.mjs
//   node scripts/scan-white-patches.mjs --output=_docs/2026-08-15-white-patch-scan.txt
//
// This is deliberately an output-only check. It reads the baked files that are already on disk;
// it does not need FINALS_DUMP and does not claim that those ignored files came from this commit.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { albedoHash, reviewFor } from "./lib/white-patch-review.mjs";

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

// The per-item verdicts live in ./lib/white-patch-review.mjs, bound to each albedo's content
// hash. Keeping them out of this file is what makes them testable without running a 2,474-file
// scan, and what stops a verdict outliving the image it was made about.

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

async function scan(file) {
  // Read once and hash the same bytes sharp decodes, so the verdict lookup cannot be keyed to a
  // different revision of the file than the one that produced these numbers.
  const bytes = readFileSync(file);
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
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
    sha256: albedoHash(bytes),
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
  const reviewed = flagged.map((result) => ({ ...result, review: reviewFor(result.path, result.sha256) }));
  if (reviewed.length === 0) lines.push("(none)");
  else {
    for (const result of reviewed) {
      lines.push(
        `- ${result.path} | near-white=${result.whitePercent.toFixed(2)}% (${result.whitePixels}/${result.pixels}) | mean=${result.meanBrightness.toFixed(1)} | review=${result.review.status}: ${result.review.note}`,
      );
    }
  }

  const withStatus = (status) => reviewed.filter((result) => result.review.status === status);
  const listOrNone = (results) => (results.length ? results.map((result) => result.path).join(", ") : "none");

  lines.push(
    "",
    "Interpretation: a flag is a screening result, not proof of a defect; compare each item with its icon.",
    `Confirmed legitimate against a catalogue icon: ${withStatus("legitimate").length}/${reviewed.length}.`,
    // Split out deliberately. These were previously counted as confirmed, which turned "nobody
    // could check this" into "somebody checked this and it is fine".
    `Unverifiable, no catalogue icon exists to compare against: ${withStatus("unverifiable").length} — ${listOrNone(withStatus("unverifiable"))}.`,
    `Stale, content changed since it was reviewed: ${withStatus("stale").length} — ${listOrNone(withStatus("stale"))}.`,
    `Unreviewed, no verdict recorded: ${withStatus("unreviewed").length} — ${listOrNone(withStatus("unreviewed"))}.`,
    `Still broken: ${listOrNone(withStatus("broken"))}.`,
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
