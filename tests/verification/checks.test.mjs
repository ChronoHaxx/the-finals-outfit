import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { check as geometry } from "../../scripts/lib/verification/checks/geometry.mjs";
import { check as uv } from "../../scripts/lib/verification/checks/uv.mjs";

const REAL = "public/models/body/SK_Body_M.glb";

test("a missing file fails rather than throwing", async () => {
  const g = await geometry("does/not/exist.glb");
  assert.equal(g.mark, "fail");
  assert.match(g.note, /unreadable|missing/i);
});

test("the base body passes geometry", async () => {
  const g = await geometry(REAL);
  assert.equal(g.mark, "pass", g.note);
});

test("the base body passes UV", async () => {
  const u = await uv(REAL);
  assert.equal(u.mark, "pass", u.note);
});

test("a LINES-only mesh fails geometry — lines are not renderable triangles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vgeo-"));
  const file = join(dir, "lines.glb");
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos = doc.createAccessor("pos").setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0])).setBuffer(buf);
  const idx = doc.createAccessor("idx").setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2, 3])).setBuffer(buf);
  const prim = doc.createPrimitive().setMode(1 /* LINES */).setAttribute("POSITION", pos).setIndices(idx);
  const scene = doc.createScene("s");
  doc.getRoot().setDefaultScene(scene);
  scene.addChild(doc.createNode("lines").setMesh(doc.createMesh("lines").addPrimitive(prim)));
  writeFileSync(file, await new NodeIO().writeBinary(doc));
  const r = await geometry(file);
  assert.equal(r.mark, "fail");
  assert.match(r.note, /triangle/i);
});
