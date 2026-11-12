// Agent re-check of the functional checklist's steps 5 and 6 (12 Nov 2026), headless against the dev server:
//  5. a held emote frame poses the face and re-wraps the beard; a seek follows; stop() puts the beard's geometry and
//     the face's bones back EXACTLY (bitwise) to the still state.
//  6. changing the face while an emote plays binds the new head, which then animates.
//   node _docs/facial-animation-2026-11-12/publish/check-stop-and-swap.mjs   (worktree root; CAPTURE_BASE, default :5193)
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:5193";
const BODY = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const enc = slots => "1." + Buffer.from(JSON.stringify({ slots })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
page.on("console", m => { if (/\[face\]/.test(m.text()) || (m.type() === "error" && !/403/.test(m.text()))) errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
const ready = () => page.waitForFunction("window.__rigIdle === true && !!window.__rigAnim", null, { timeout: 180000 });
// A fingerprint of the worn beard's geometry and the face's FACIAL bone locals (exact float values).
const snapshot = () => page.evaluate(() => {
  const root = window.__rigRoot, geo = [], bones = [];
  root.traverse(o => {
    if (o.isMesh && /beard/i.test(`${o.name} ${o.parent?.name ?? ""} ${o.parent?.parent?.name ?? ""}`))
      for (const key of ["position", "normal"]) { const a = o.geometry.attributes[key]; if (a) geo.push(Array.from(a.array)); }
  });
  for (const b of window.__rigAnim.animator.face.head?.bones ?? []) bones.push([...b.bone.position.toArray(), ...b.bone.quaternion.toArray()]);
  const flat = a => a.flat(Infinity);
  return { geo: flat(geo), bones: flat(bones) };
});
const differs = (a, b) => a.length !== b.length || a.some((v, i) => v !== b[i]);
const result = { base: BASE, step5: {}, step6: {} };

// Step 5: beard, held frame, seek, stop.
await page.goto(`${BASE}/?reconstructed=1&outfit=${enc({ ...BODY, facialHair: "facialhairs-beardfull-black" })}`, { waitUntil: "load", timeout: 180000 });
await ready();
await page.evaluate(() => window.__rigAnim.play("evil-jester", 0)); // binds the face (play awaits its data)
await page.evaluate(() => window.__rigAnim.stop());
await page.waitForFunction(() => !window.__rigAnim.state().active, null, { timeout: 30000 });
const still = await snapshot();
await page.evaluate(() => window.__rigAnim.play("evil-jester", 1.3));
const held = await snapshot();
await page.evaluate(() => window.__rigAnim.seek(0.6));
const seeked = await snapshot();
await page.evaluate(() => window.__rigAnim.stop());
await page.waitForFunction(() => !window.__rigAnim.state().active, null, { timeout: 30000 });
const after = await snapshot();
const face = await page.evaluate(() => { const f = window.__rigAnim.animator.face; return { posed: f.posed, wrapped: f.wrapped, wraps: f.wraps.length }; });
result.step5 = {
  beardValues: still.geo.length, faceBoneValues: still.bones.length,
  heldMovesBeard: differs(still.geo, held.geo), heldMovesFace: differs(still.bones, held.bones),
  seekMovesBeard: differs(held.geo, seeked.geo), seekMovesFace: differs(held.bones, seeked.bones),
  stopRestoresBeardExactly: !differs(still.geo, after.geo), stopRestoresFaceExactly: !differs(still.bones, after.bones),
  afterStop: face,
};
result.step5.pass = still.geo.length > 0 && Object.entries(result.step5).filter(([k]) => /Moves|Restores/.test(k)).every(([, v]) => v === true)
  && !face.posed && !face.wrapped;

// Step 6: change the face while an emote plays.
await page.goto(`${BASE}/?reconstructed=1&outfit=${enc(BODY)}`, { waitUntil: "load", timeout: 180000 });
await ready();
await page.evaluate(() => window.__rigAnim.play("take-a-bow")); // playing, not held
const before = await page.evaluate(() => window.__rigAnim.animator.face.head?.key);
await page.evaluate(async () => {
  const [{ useBuildStore }, { getItemById }] = await Promise.all([import("/src/store/useBuildStore.ts"), import("/src/lib/catalog.ts")]);
  useBuildStore.getState().equip(getItemById("head-face-20-base"));
});
await page.waitForFunction(() => window.__rigAnim.animator.face.head?.key === "SK_Head_Face_20_Base", null, { timeout: 180000 });
await page.evaluate(() => window.__rigAnim.seek(1.2));
await page.waitForTimeout(500);
result.step6 = await page.evaluate(() => {
  const a = window.__rigAnim.animator, f = a.face, s = a.state;
  const finite = (f.head?.bones ?? []).every(b => [...b.bone.position.toArray(), ...b.bone.quaternion.toArray()].every(Number.isFinite));
  return { clip: s.current, active: s.active, head: f.head?.key, bones: f.head?.bones.length, posed: f.posed, finite };
});
result.step6.before = before;
result.step6.pass = result.step6.before === "SK_Head_Face_01_Base" && result.step6.head === "SK_Head_Face_20_Base"
  && result.step6.posed && result.step6.finite && result.step6.clip === "take-a-bow";
result.errors = [...new Set(errors)];
result.pass = result.step5.pass && result.step6.pass && !result.errors.length;
writeFileSync(path.join("_docs/facial-animation-2026-11-12/publish", "check-stop-and-swap.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
