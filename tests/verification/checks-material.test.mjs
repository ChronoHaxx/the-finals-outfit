import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import sharp from "sharp";
import { check as bindings } from "../../scripts/lib/verification/checks/bindings.mjs";
import { check as bodyCulling } from "../../scripts/lib/verification/checks/body-culling.mjs";
import { check as transform } from "../../scripts/lib/verification/checks/transform.mjs";

const ROOT = process.cwd();

test("an item with no baked set is n/a, not a failure", async () => {
  const r = await bindings({ id: "x", model: { gltfPath: "models/cosmetics/x.glb" } }, ROOT);
  assert.equal(r.mark, "na");
});

test("a baked set pointing at a missing file fails and names it", async () => {
  const r = await bindings({
    id: "x",
    model: { gltfPath: "models/cosmetics/x.glb", material: { bakedSet: {
      albedo: "models/cosmetics/nope.albedo.webp",
      normal: "models/cosmetics/nope.normal.webp",
      orm: "models/cosmetics/nope.orm.webp",
    } } },
  }, ROOT);
  assert.equal(r.mark, "fail");
  assert.match(r.note, /nope\.albedo\.webp/);
});

test("a present but undecodable map fails — existence is not readability", async () => {
  const root = mkdtempSync(join(tmpdir(), "vbnd-"));
  const dir = join(root, "public", "models", "cosmetics");
  mkdirSync(dir, { recursive: true });
  // Albado and orm are real images; the normal is a zero-byte file that exists but
  // cannot decode. Current check only decodes the albedo, so this passes today.
  const raw = Buffer.alloc(4 * 4 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = i % 251;
  await sharp(raw, { raw: { width: 4, height: 4, channels: 3 } }).png().toFile(join(dir, "a.albedo.png"));
  await sharp(raw, { raw: { width: 4, height: 4, channels: 3 } }).png().toFile(join(dir, "a.orm.png"));
  writeFileSync(join(dir, "a.normal.webp"), "");
  const r = await bindings({
    id: "x",
    model: { gltfPath: "models/cosmetics/x.glb", material: { bakedSet: {
      albedo: "models/cosmetics/a.albedo.png",
      normal: "models/cosmetics/a.normal.webp",
      orm: "models/cosmetics/a.orm.png",
    } } },
  }, root);
  assert.equal(r.mark, "fail");
  assert.match(r.note, /a\.normal\.webp/);
});

test("a uniform albedo is needs-human, not a failure — flat materials can be legitimate", async () => {
  const root = mkdtempSync(join(tmpdir(), "vbnd-"));
  const dir = join(root, "public", "models", "cosmetics");
  mkdirSync(dir, { recursive: true });
  // Uniform grey albedo (zero variance); normal and orm are readable but also uniform —
  // only the albedo flatness is being judged here.
  const flat = Buffer.alloc(4 * 4 * 3, 128);
  await sharp(flat, { raw: { width: 4, height: 4, channels: 3 } }).png().toFile(join(dir, "a.albedo.png"));
  await sharp(flat, { raw: { width: 4, height: 4, channels: 3 } }).png().toFile(join(dir, "a.normal.webp"));
  await sharp(flat, { raw: { width: 4, height: 4, channels: 3 } }).png().toFile(join(dir, "a.orm.png"));
  const r = await bindings({
    id: "x",
    model: { gltfPath: "models/cosmetics/x.glb", material: { bakedSet: {
      albedo: "models/cosmetics/a.albedo.png",
      normal: "models/cosmetics/a.normal.webp",
      orm: "models/cosmetics/a.orm.png",
    } } },
  }, root);
  assert.equal(r.mark, "needs-human");
  assert.match(r.note, /uniform/i);
});

test("a mesh with no bodymask fails, and says so", async () => {
  const r = await bodyCulling({ id: "x", slot: "upperBody", model: { gltfPath: "models/cosmetics/definitely-not-real.glb" } }, ROOT);
  assert.equal(r.mark, "fail");
  assert.match(r.note, /bodymask/i);
});

test("a slot that never registers a body mask is n/a, not a failure", async () => {
  const r = await bodyCulling({ id: "x", slot: "wrist", model: { gltfPath: "models/cosmetics/x.glb" } }, ROOT);
  assert.equal(r.mark, "na");
  assert.match(r.note, /never registers/i);
});

test("an all-black mask with opaque alpha fails — coverage is measured on colour, not alpha", async () => {
  const root = mkdtempSync(join(tmpdir(), "vbc-"));
  const dir = join(root, "public", "models", "cosmetics");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "x.glb"), "DUMMY");
  // All-black RGBA image with opaque alpha — the exact [0,0,0,255] shape that
  // previously passed on the alpha channel.
  const rgba = Buffer.alloc(4 * 4 * 4, 0);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  await sharp(rgba, { raw: { width: 4, height: 4, channels: 4 } }).png().toFile(join(dir, "x.bodymask.png"));
  const r = await bodyCulling({ id: "x", slot: "upperBody", model: { gltfPath: "models/cosmetics/x.glb" } }, root);
  assert.equal(r.mark, "fail");
  assert.match(r.note, /empty/i);
});

test("a socketed origin-authored static passes and records the convention", async () => {
  const r = await transform("public/models/earring/beetlegold-01.glb", "earrings");
  assert.equal(r.mark, "pass", r.note);
  assert.match(r.note, /origin-authored/);
});

test("a socketed body-authored static passes too — both conventions are valid", async () => {
  const r = await transform("public/models/cosmetics/attachments-aviator-sunglasses.glb", "eyewear");
  assert.equal(r.mark, "pass", r.note);
  assert.match(r.note, /body-authored/);
});

test("an oversized socketed accessory fails — wrapper scale lost", async () => {
  const r = await transform("public/models/earring/panda-01.glb", "earrings");
  assert.equal(r.mark, "fail");
  assert.match(r.note, /wrapper scale lost/i);
});

test("a skinned socketed mesh is n/a — bind pose spans the skeleton, not the object", async () => {
  const r = await transform("public/models/cosmetics/streetwear-smart-watch.glb", "wrist");
  assert.equal(r.mark, "na", r.note);
  assert.match(r.note, /skinned/i);
});

test("a large headwear static passes within its own bound", async () => {
  const r = await transform("public/models/cosmetics/mexico-mariachi-sombrero.glb", "headwear");
  assert.equal(r.mark, "pass", r.note);
});

test("a body-authored slot is n/a", async () => {
  const r = await transform("public/models/body/SK_Body_M.glb", "upperBody");
  assert.equal(r.mark, "na");
});
