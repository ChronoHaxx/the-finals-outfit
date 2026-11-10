import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { RigAnimator, type AnimationManifest } from "../../src/rig/RigAnimator";

// The emote timeline's transport (10 Nov 2026): pause as a hold of one clip, scrub, frame steps, an inspected emote
// staying on its last frame, the frame a share records, and opening a shared pose. Same harness as
// rig-animator.test.ts: a two-bone body and clips in the converter's format, the mixer stepped by hand.

const Q = 32767, P = 1e5;
const qInts = (q: THREE.Quaternion) => q.toArray().map(v => Math.round(v * Q));
const turn = (degrees: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(degrees));

// Pelvis held at one rotation; its height runs 1.0 -> 1.1 m over the clip, so height reads the clip time back.
function clipJson(id: string, degrees: number, frames = 31) {
  return {
    formatVersion: 1, id, frameTime: 1 / 30, qScale: Q, pScale: P,
    q: [["pelvis", [0, frames - 1], [...qInts(turn(degrees)), ...qInts(turn(degrees))]]],
    p: [["pelvis", [0, frames - 1], [0, 100000, 0, 0, 110000, 0]]],
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
  globalThis.fetch = (async (url: string) => {
    const file = String(url).split("/").pop()!;
    await new Promise(resolve => setTimeout(resolve, delays[file] ?? 0));
    return { ok: file in clips, status: file in clips ? 200 : 404, json: async () => clips[file] } as Response;
  }) as typeof fetch;
}

function rig() {
  const body = new THREE.Group(), root = new THREE.Bone(), pelvis = new THREE.Bone();
  root.name = "root"; pelvis.name = "pelvis";
  pelvis.position.set(0, 1, 0);
  pelvis.quaternion.copy(turn(10)); // the still pose
  root.add(pelvis); body.add(root);
  return { body, pelvis };
}
const angle = (q: THREE.Quaternion) => THREE.MathUtils.radToDeg(2 * Math.atan2(q.z, q.w)); // about z, signed
const step = (animator: RigAnimator, seconds: number, dt = 0.05) => { for (let t = 0; t < seconds - 1e-9; t += dt) animator.update(dt); };
const heightAt = (seconds: number) => 1 + 0.1 * seconds;

test("an emote's natural end crossfades into the idle instead of snapping toward the still pose", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "idle");
  step(animator, 0.5);
  await animator.play(body, "wave");
  step(animator, 1.0);
  const angles: number[] = [];
  for (let i = 0; i < 8; i++) { animator.update(0.05); angles.push(angle(pelvis.quaternion)); }
  // Before the fix the first frame after the end fell to ~15 deg (the still pose blended in), then rose to 30.
  for (const a of angles) assert.ok(a >= 29.9 && a <= 90.1, `between the idle (30) and the emote (90), got ${angles.map(v => v.toFixed(1))}`);
  assert.ok(angles[0] > 60, `starts near the emote, got ${angles[0].toFixed(1)}`);
  assert.ok(Math.abs(angles.at(-1)! - 30) < 0.1, `ends on the idle, got ${angles.at(-1)!.toFixed(1)}`);
  assert.equal(animator.state.current, "idle");
});

test("pausing mid-crossfade holds the clip in front alone: the paused frame is exactly (clip, time)", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "idle");
  step(animator, 0.5);
  await animator.play(body, "wave");
  step(animator, 0.1); // a third of the way through the 0.3 s crossfade
  animator.setPaused(true);
  assert.equal(animator.state.paused, true);
  assert.ok(Math.abs(angle(pelvis.quaternion) - 90) < 0.05, `only the emote, got ${angle(pelvis.quaternion)}`);
  const pose = animator.sharePose()!;
  assert.equal(pose.clip, "wave");
  assert.equal(pose.paused, true);
  assert.ok(Math.abs(pelvis.position.y - heightAt(pose.time)) < 1e-4, "the bones show the recorded time");
  step(animator, 1);
  assert.ok(Math.abs(pelvis.position.y - heightAt(pose.time)) < 1e-4, "and stay there");
});

test("an inspected emote stays on its last frame; resuming there replays it; leaving returns to the idle", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "idle");
  step(animator, 0.5);
  await animator.play(body, "wave");
  step(animator, 0.4);
  animator.setPaused(true); // the viewer pauses: inspected
  animator.setPaused(false);
  step(animator, 1.0);
  assert.equal(animator.state.current, "wave", "still the emote after its end");
  assert.equal(animator.state.paused, true);
  assert.ok(Math.abs(pelvis.position.y - 1.1) < 1e-4, `on the last frame, got ${pelvis.position.y}`);
  assert.equal(animator.timeline()!.time, 1);

  animator.setPaused(false); // at the end: from the start again
  animator.update(0.05);
  assert.ok(animator.timeline()!.time < 0.1, `restarted, at ${animator.timeline()!.time}`);
  assert.equal(animator.state.moving, true);

  animator.leaveEmote();
  assert.equal(animator.timeline(), null);
  step(animator, 0.5);
  assert.equal(animator.state.current, "idle");
  assert.ok(Math.abs(angle(pelvis.quaternion) - 30) < 0.05);
  assert.equal(animator.state.moving, true);
});

test("an emote nobody touched still returns to the idle, and one opened from a playing link does too", async () => {
  stubFetch();
  const { body } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "idle");
  step(animator, 0.5);
  assert.equal(await animator.openPose(body, { clip: "wave", time: 0.6, paused: false }), true);
  assert.equal(animator.state.moving, true);
  step(animator, 0.8);
  assert.equal(animator.state.current, "idle");
});

test("a seek to the last frame with the sway preroll does not end the emote", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  // Sway with one chain: the 1.5 s preroll runs (the chain itself is irrelevant here).
  Object.defineProperty(animator.springs, "count", { get: () => 1 });
  animator.springs.update = () => {};
  await animator.play(body, "idle");
  await animator.play(body, "wave");
  animator.seek(1.0, { inspect: true });
  assert.equal(animator.state.current, "wave");
  assert.equal(animator.state.paused, true);
  assert.ok(Math.abs(pelvis.position.y - 1.1) < 1e-4);
  animator.seek(1.0); // a capture's seek (not inspected) at the end: still held there, not ended
  step(animator, 0.5);
  assert.equal(animator.state.current, "wave");
});

test("frame steps land on frame boundaries; a scrub is held once per frame, then a seek settles it", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "wave");
  animator.seek(0.41); // between frames 12 (0.4) and 13 (0.4333)
  animator.step(1);
  assert.ok(Math.abs(animator.timeline()!.time - 13 / 30) < 1e-9, `next boundary, got ${animator.timeline()!.time * 30}`);
  animator.step(1);
  assert.ok(Math.abs(animator.timeline()!.time - 14 / 30) < 1e-9);
  animator.step(-3);
  assert.ok(Math.abs(animator.timeline()!.time - 11 / 30) < 1e-9);
  animator.step(-100);
  assert.equal(animator.timeline()!.time, 0);
  animator.step(1000);
  assert.equal(animator.timeline()!.time, 1);
  assert.equal(animator.sharePose()!.frame, 30);
  assert.equal(animator.sharePose()!.lastFrame, 30);

  let notified = 0;
  const unsubscribe = animator.subscribePose(() => notified++);
  animator.scrub(0.2); animator.scrub(0.3); animator.scrub(0.5);
  assert.equal(animator.timeline()!.time, 0.5, "the timeline shows the drag at once");
  assert.ok(Math.abs(pelvis.position.y - 1.1) < 1e-4, "the bones wait for the frame");
  animator.update(0.016);
  assert.ok(Math.abs(pelvis.position.y - heightAt(0.5)) < 1e-4, `held at the latest drag, got ${pelvis.position.y}`);
  assert.ok(notified >= 3);
  unsubscribe();
  assert.equal(animator.state.paused, true);
});

test("the share pose: none while the idle simply plays, the emote playing or paused, the idle once paused", async () => {
  stubFetch();
  const { body } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  assert.equal(animator.sharePose(), null);
  await animator.play(body, "idle");
  step(animator, 0.5);
  assert.equal(animator.sharePose(), null, "the default idle shares the still pose, as before");
  animator.setPaused(true);
  assert.deepEqual({ ...animator.sharePose()!, time: 0 }, { clip: "idle", time: 0, paused: true, label: "Idle", frame: animator.sharePose()!.frame, lastFrame: 30 });
  animator.setPaused(false);
  await animator.play(body, "bow");
  step(animator, 0.35);
  const playing = animator.sharePose()!;
  assert.equal(playing.clip, "bow");
  assert.equal(playing.paused, false);
  assert.ok(Math.abs(playing.time - 0.35) < 1e-6);
  assert.equal(playing.frame, Math.round(0.35 * 30));
  animator.stop();
  assert.equal(animator.sharePose(), null, "fading back to the still pose");
});

test("opening a paused pose holds its exact frame, inspected; superseded or unknown poses do nothing", async () => {
  stubFetch({ "wave.json": 20 });
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  assert.equal(await animator.openPose(body, { clip: "nope", time: 1, paused: true }), false);
  assert.equal(animator.state.active, false);

  // 1.233 s is how a link writes frame 37 at 30 fps; it lands on the frame itself.
  const wide = { ...manifest, clips: [...manifest.clips, { id: "long", label: "Long", kind: "emote" as const, loop: false, duration: 2, file: "long.json", bytes: 0 }] };
  clips["long.json"] = clipJson("long", 45, 61);
  const long = new RigAnimator(wide, "clips/");
  assert.equal(await long.openPose(body, { clip: "long", time: 1.233, paused: true }, { idle: "idle" }), true);
  assert.equal(long.state.idle, "idle", "the idle runs under the emote");
  assert.equal(long.timeline()!.time, 37 / 30);
  assert.equal(long.state.paused, true);
  assert.ok(Math.abs(pelvis.position.y - (1 + 0.1 * (37 / 30) / 2)) < 1e-4);
  long.setPaused(false);
  step(long, 1.0);
  assert.equal(long.state.current, "long", "a paused link is inspected: it stays on the last frame");
  long.reset();

  // The viewer picks another emote while the link's clip downloads: the link must not seek or pause it.
  const opening = animator.openPose(body, { clip: "wave", time: 0.5, paused: true });
  await animator.play(body, "bow");
  assert.equal(await opening, false);
  assert.equal(animator.state.current, "bow");
  assert.equal(animator.state.paused, false);
});
