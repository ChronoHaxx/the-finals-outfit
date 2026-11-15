import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { initialClip, RigAnimator, type AnimationManifest } from "../../src/rig/RigAnimator";

// Showcase animation playback (5 Nov 2026): the scheduling contract the viewer relies on, on a two-bone body and
// clips in the converter's format. No browser: the mixer is stepped by hand.

const Q = 32767, P = 1e5;
const qInts = (q: THREE.Quaternion) => q.toArray().map(v => Math.round(v * Q));
const turn = (degrees: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(degrees));

// A clip holding pelvis at one rotation for its whole length (two keys), with a moving pelvis position.
function clipJson(id: string, degrees: number, frames = 31) {
  return {
    formatVersion: 1, id, frameTime: 1 / 30, qScale: Q, pScale: P,
    q: [["pelvis", [0, frames - 1], [...qInts(turn(degrees)), ...qInts(turn(degrees))]]],
    p: [["pelvis", [0, frames - 1], [0, 100000, 0, 0, 110000, 0]]], // y: 1.0 m -> 1.1 m up
  };
}
const manifest: AnimationManifest = {
  formatVersion: 1, defaultIdle: "idle",
  clips: [
    { id: "idle", label: "Idle", kind: "idle", loop: true, duration: 1, file: "idle.json", bytes: 0 },
    { id: "wave", label: "Wave", kind: "emote", loop: false, duration: 1, file: "wave.json", bytes: 0 },
    { id: "bow", label: "Bow", kind: "emote", loop: false, duration: 1, file: "bow.json", bytes: 0 },
  ],
};
const clips: Record<string, unknown> = { "idle.json": clipJson("idle", 30), "wave.json": clipJson("wave", 90), "bow.json": clipJson("bow", -60) };

function stubFetch(delays: Record<string, number> = {}) {
  const requested: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const file = String(url).split("/").pop()!;
    requested.push(file);
    await new Promise(resolve => setTimeout(resolve, delays[file] ?? 0));
    return { ok: file in clips, status: file in clips ? 200 : 404, json: async () => clips[file] } as Response;
  }) as typeof fetch;
  return requested;
}

// The rig's layout: the body scene owns the driver bones; a cosmetic glTF scene beside it keeps its own unused copy
// of the same bone names. The mixer must only ever move the body's.
function rig() {
  const world = new THREE.Group();
  const body = new THREE.Group(), root = new THREE.Bone(), pelvis = new THREE.Bone();
  root.name = "root"; pelvis.name = "pelvis";
  pelvis.position.set(0, 1, 0);
  pelvis.quaternion.copy(turn(10)); // a non-rest still pose, like the viewer's static idle
  root.add(pelvis); body.add(root); world.add(body);
  const cosmetic = new THREE.Group(), decoy = new THREE.Bone();
  decoy.name = "pelvis";
  cosmetic.add(decoy); world.add(cosmetic);
  return { body, pelvis, decoy };
}
const angleTo = (a: THREE.Quaternion, degrees: number) => THREE.MathUtils.radToDeg(a.angleTo(turn(degrees)));
const step = (animator: RigAnimator, seconds: number) => { for (let t = 0; t < seconds; t += 0.05) animator.update(0.05); };

test("an idle drives the body's bones (not a cosmetic's same-named copy), dequantised", async () => {
  stubFetch();
  const { body, pelvis, decoy } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "idle");
  step(animator, 0.5); // past the 0.3 s fade-in
  assert.ok(angleTo(pelvis.quaternion, 30) < 0.05, `pelvis at ${angleTo(pelvis.quaternion, 30)} deg from the clip`);
  assert.ok(pelvis.position.y > 1.0 && pelvis.position.y < 1.1);
  assert.deepEqual(decoy.quaternion.toArray(), [0, 0, 0, 1]);
  assert.equal(animator.state.moving, true);
});

test("stopping returns the exact still pose, not the bind pose", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const still = { q: pelvis.quaternion.clone(), p: pelvis.position.clone() };
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "idle");
  step(animator, 0.5);
  await animator.play(body, "wave");
  step(animator, 0.2); // stop mid-crossfade: both actions are live
  animator.stop();
  assert.equal(animator.state.active, true, "still fading out");
  step(animator, 0.5);
  assert.equal(animator.state.active, false);
  assert.deepEqual(pelvis.quaternion.toArray(), still.q.toArray());
  assert.deepEqual(pelvis.position.toArray(), still.p.toArray());
});

test("an emote returns to the running idle, or to the still pose when none runs", async () => {
  stubFetch();
  const a = rig(), withIdle = new RigAnimator(manifest, "clips/");
  await withIdle.play(a.body, "idle");
  step(withIdle, 0.5);
  await withIdle.play(a.body, "wave");
  step(withIdle, 0.5);
  assert.equal(withIdle.state.current, "wave");
  assert.ok(angleTo(a.pelvis.quaternion, 90) < 0.05);
  step(withIdle, 1.0); // the 1 s emote ends; 0.3 s crossfade back
  assert.equal(withIdle.state.current, "idle");
  assert.ok(angleTo(a.pelvis.quaternion, 30) < 0.05);

  const b = rig(), still = b.pelvis.quaternion.clone(), alone = new RigAnimator(manifest, "clips/");
  await alone.play(b.body, "bow");
  step(alone, 0.5);
  assert.ok(angleTo(b.pelvis.quaternion, -60) < 0.05);
  step(alone, 1.5);
  assert.equal(alone.state.active, false);
  assert.deepEqual(b.pelvis.quaternion.toArray(), still.toArray());
});

test("pausing freezes the pose; seek holds an exact frame", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "wave");
  animator.seek(0.5);
  assert.equal(animator.state.paused, true);
  assert.equal(animator.state.moving, false);
  const held = pelvis.position.y;
  step(animator, 1);
  assert.equal(pelvis.position.y, held, "a paused mixer must not advance");
  assert.ok(Math.abs(held - 1.05) < 1e-4, `seek(0.5) of a 1 s 1.0->1.1 m clip holds 1.05 m, got ${held}`);
  animator.setPaused(false);
  assert.equal(animator.state.moving, true);
});

test("the latest request wins when clip downloads overlap, and failures are reported", async () => {
  const requested = stubFetch({ "bow.json": 30 });
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  const slow = animator.play(body, "bow");
  const fast = animator.play(body, "wave");
  await Promise.all([slow, fast]);
  step(animator, 0.5);
  assert.equal(animator.state.current, "wave");
  assert.ok(angleTo(pelvis.quaternion, 90) < 0.05);
  assert.deepEqual(requested.sort(), ["bow.json", "wave.json"]);

  delete clips["bow.json"];
  const broken = new RigAnimator(manifest, "clips/");
  await assert.rejects(broken.play(body, "bow"));
  assert.match(broken.state.error ?? "", /Bow/);
  clips["bow.json"] = clipJson("bow", -60);
});

test("the idle is the default; explicit requests, harnesses, reduced motion and a remembered still choice override it", () => {
  const base = { anim: null, defaultIdle: "idle", automated: false, reducedMotion: false, savedStill: false };
  assert.equal(initialClip(base), "idle");
  assert.equal(initialClip({ ...base, automated: true }), null, "visual-diff/probe harnesses compare still captures");
  assert.equal(initialClip({ ...base, reducedMotion: true }), null);
  assert.equal(initialClip({ ...base, savedStill: true }), null);
  assert.equal(initialClip({ ...base, anim: "0" }), null);
  assert.equal(initialClip({ ...base, anim: "still" }), null);
  assert.equal(initialClip({ ...base, anim: "wave", automated: true }), "wave", "an explicit clip wins in a capture");
});

test("a still draw mid-animation sees the exact static pose, including bones added during playback", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const still = { q: pelvis.quaternion.clone(), p: pelvis.position.clone() };
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "wave");
  step(animator, 0.5);
  // An outfit change while it plays adds a garment bone; then something (a spring) moves it.
  const charm = new THREE.Bone();
  charm.name = "charm_jj";
  charm.quaternion.copy(turn(5));
  pelvis.add(charm);
  animator.rememberStillPose(body);
  charm.quaternion.copy(turn(40));
  const animated = { q: pelvis.quaternion.clone(), p: pelvis.position.clone() };
  const seen = animator.withStillPose(() => ({ q: pelvis.quaternion.clone(), p: pelvis.position.clone(), charm: charm.quaternion.clone() }));
  assert.deepEqual(seen.q.toArray(), still.q.toArray());
  assert.deepEqual(seen.p.toArray(), still.p.toArray());
  assert.deepEqual(seen.charm.toArray(), turn(5).toArray());
  assert.deepEqual(pelvis.quaternion.toArray(), animated.q.toArray(), "the animated pose is back after the draw");
  assert.deepEqual(charm.quaternion.toArray(), turn(40).toArray());
});

test("holding the still pose survives frames and freezes the clock; release resumes where it was", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const still = pelvis.position.clone();
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "idle");
  step(animator, 0.5);
  const before = pelvis.position.y;
  animator.holdStill(true);
  assert.deepEqual(pelvis.position.toArray(), still.toArray(), "applied at once");
  step(animator, 0.4);
  assert.deepEqual(pelvis.position.toArray(), still.toArray(), "and kept over frames");
  animator.holdStill(false);
  animator.update(0);
  assert.ok(Math.abs(pelvis.position.y - before) < 1e-6, `resumes at the held time, ${pelvis.position.y} vs ${before}`);
});

test("an emote picked during another releases the replaced one; a seek mid-crossfade shows only the new clip", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  const mixer = () => (animator as unknown as { mixer: THREE.AnimationMixer }).mixer;
  await animator.play(body, "idle");
  step(animator, 0.5);
  // Click through emotes, each replaced mid-play: once the fades settle only the idle (faded under) and the current
  // emote stay bound; the replaced ones are stopped, not left active for good.
  for (const id of ["wave", "bow", "wave", "bow"]) { await animator.play(body, id); step(animator, 0.15); }
  step(animator, 0.5);
  assert.equal(mixer().stats.actions.inUse, 2, "idle + current emote");
  // The capture hook froze a crossfade at its start: the replaced emote stayed at full weight in the held frame.
  await animator.play(body, "wave");
  step(animator, 0.5);
  await animator.play(body, "bow");
  animator.update(0.05); // mid-crossfade
  animator.seek(0.5);
  assert.ok(angleTo(pelvis.quaternion, -60) < 0.05, `held frame is ${angleTo(pelvis.quaternion, -60)} deg from bow`);
  assert.equal(animator.state.current, "bow");
});

test("emotes sharing one animation download it once and each reports its own id", async () => {
  const shared: AnimationManifest = { ...manifest, clips: [...manifest.clips,
    { id: "bow-gold", label: "Golden bow", kind: "emote", loop: false, duration: 1, file: "bow.json", bytes: 0 }] };
  const requested = stubFetch();
  const { body } = rig();
  const animator = new RigAnimator(shared, "clips/");
  await animator.play(body, "bow");
  step(animator, 0.4);
  await animator.play(body, "bow-gold");
  assert.equal(animator.state.current, "bow-gold");
  assert.deepEqual(requested, ["bow.json"]);
});

test("prop attach bones are added before the mixer binds, so emote clips drive them; a reset removes them", async () => {
  stubFetch();
  clips["swing.json"] = { ...clipJson("swing", 0), q: [["prop_01", [0, 30], [...qInts(turn(45)), ...qInts(turn(45))]]], p: [] };
  const withProps: AnimationManifest = {
    ...manifest,
    clips: [...manifest.clips, { id: "swing", label: "Swing", kind: "emote", loop: false, duration: 1, file: "swing.json", bytes: 0 }],
    attachBones: [{ name: "prop_01", parent: "pelvis", position: [0, 0, -1.25], quaternion: [0, 0, 0, 1] }],
  };
  const { body, pelvis } = rig();
  const animator = new RigAnimator(withProps, "clips/");
  await animator.play(body, "swing");
  step(animator, 0.5);
  const prop = pelvis.getObjectByName("prop_01")!;
  assert.ok(prop, "prop_01 added under the body's pelvis");
  assert.ok(angleTo(prop.quaternion, 45) < 0.05, `prop_01 follows the clip: ${angleTo(prop.quaternion, 45)} deg off`);
  animator.reset();
  assert.equal(pelvis.getObjectByName("prop_01"), undefined, "reset removes the added bone");
});

// Chinals mode (12 Nov 2026) swaps the whole clip set by disposing the animator. A switch mid-emote must hand the next
// animator a body in its still pose, and a clip still downloading must never bind to the body afterwards.
test("dispose puts the body back to its still pose, and a play still downloading never binds", async () => {
  stubFetch({ "bow.json": 30 });
  const { body, pelvis } = rig();
  const still = pelvis.quaternion.clone();
  const first = new RigAnimator(manifest, "clips/");
  await first.play(body, "wave");
  step(first, 0.5);
  assert.ok(angleTo(pelvis.quaternion, 90) < 0.05, "mid-emote");
  const late = first.play(body, "bow"); // still downloading when the mode switches
  first.dispose();
  assert.ok(pelvis.quaternion.angleTo(still) < 1e-6, "back to the still pose at once");
  assert.equal(first.state.active, false);
  await late;
  step(first, 0.5);
  assert.ok(pelvis.quaternion.angleTo(still) < 1e-6, "the late clip did not bind");
  assert.equal(first.state.current, null);
  await first.play(body, "wave"); // a disposed animator stays inert
  assert.equal(first.state.active, false);
  const next = new RigAnimator(manifest, "clips/");
  await next.play(body, "wave");
  step(next, 0.5);
  next.stop();
  step(next, 0.5);
  assert.ok(pelvis.quaternion.angleTo(still) < 1e-4, "the next animator's still pose is the real one");
});
