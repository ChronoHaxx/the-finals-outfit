import { test } from "node:test";
import assert from "node:assert/strict";
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
