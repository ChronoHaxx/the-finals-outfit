#!/usr/bin/env node
// Download a published faces set (build-face.mjs output) exactly as hosted: the index and every file it names (heads,
// their pose files, curves, cage skins, masks). The Chinals faces reuse the global head rig byte for byte, so they are
// copied from the live global animations host rather than rebuilt.
// Usage (any shell with Node, worktree root):
//   node _docs/chinals-faces-2026-11-21/tools/fetch-faces.mjs https://17ec92c3.the-finals-outfit-assets.pages.dev/faces-1/ <new empty dir>
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [base, out] = process.argv.slice(2);
if (!base?.endsWith("/") || !out) throw new Error("usage: fetch-faces.mjs <faces base URL ending in /> <new empty dir>");
if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty`);

async function get(rel) {
  const response = await fetch(base + rel);
  if (!response.ok) throw new Error(`${rel}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(join(out, rel)), { recursive: true });
  writeFileSync(join(out, rel), bytes);
  return bytes;
}

const index = JSON.parse(await get("faces.json"));
if (index.formatVersion !== 1) throw new Error(`unsupported faces index ${index.formatVersion}`);
const files = new Set([
  ...Object.values(index.heads),
  ...index.curves.map(source => `curves/${source}.json`),
  ...Object.values(index.wraps ?? {}),
  ...Object.values(index.masks ?? {}),
]);
const poses = new Set();
const list = [...files];
for (let i = 0; i < list.length; i += 16) {
  await Promise.all(list.slice(i, i + 16).map(async rel => {
    const bytes = await get(rel);
    if (rel.startsWith("heads/")) poses.add(JSON.parse(bytes).pose);
  }));
}
for (const rel of poses) await get(rel);
console.log(JSON.stringify({ base, files: 1 + files.size + poses.size, heads: Object.keys(index.heads).length,
  poses: poses.size, curves: index.curves.length, wraps: Object.keys(index.wraps ?? {}).length,
  masks: Object.keys(index.masks ?? {}).length }));
