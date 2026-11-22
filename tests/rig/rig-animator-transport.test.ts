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

// Emote speed (21 Nov 2026): a time scale on the emote's own clock. The mixer's timeScale stays the pause switch.

test("speed scales the emote's clock; pause still holds; the idle under it keeps normal speed", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "idle");
  animator.setSpeed(4);
  step(animator, 0.2);
  animator.setPaused(true);
  assert.ok(Math.abs(animator.sharePose()!.time - 0.2) < 1e-6, `the idle ran at normal speed (${animator.sharePose()!.time})`);
  animator.setPaused(false);

  await animator.play(body, "wave");
  animator.setSpeed(2);
  step(animator, 0.25);
  assert.ok(Math.abs(animator.timeline()!.time - 0.5) < 1e-6, `0.25 s at 2x is 0.5 s into the emote (${animator.timeline()!.time})`);
  animator.setPaused(true);
  step(animator, 0.3);
  assert.equal(animator.state.paused, true);
  assert.ok(Math.abs(animator.timeline()!.time - 0.5) < 1e-6, "paused: the clock does not move at any speed");
  assert.ok(Math.abs(pelvis.position.y - heightAt(0.5)) < 1e-4);
  animator.setSpeed(0.5); // a held frame stays where it is
  assert.ok(Math.abs(animator.timeline()!.time - 0.5) < 1e-6);
  animator.setPaused(false);
  step(animator, 0.2);
  assert.ok(Math.abs(animator.timeline()!.time - 0.6) < 1e-6, `resumed at the new speed (${animator.timeline()!.time})`);
  assert.equal(animator.state.speed, 0.5);
});

test("a later emote starts at the chosen speed; it ends at the scaled time and the idle returns", async () => {
  stubFetch();
  const { body } = rig();
  const animator = new RigAnimator(manifest, "clips/", { speed: 4 });
  assert.equal(animator.state.speed, 4);
  await animator.play(body, "idle");
  await animator.play(body, "wave");
  step(animator, 0.2);
  assert.ok(Math.abs(animator.timeline()!.time - 0.8) < 1e-6, `${animator.timeline()!.time}`);
  step(animator, 0.1); // past the 1 s clip at 4x
  assert.equal(animator.state.current, "idle", "the untouched emote ended and returned to the idle");
  assert.equal(new RigAnimator(manifest, "clips/", { speed: 40 }).state.speed, 4, "clamped");
});

test("a paused link opens on its exact frame whatever the speed, and plays on at that speed", async () => {
  const wide = { ...manifest, clips: [...manifest.clips, { id: "long", label: "Long", kind: "emote" as const, loop: false, duration: 2, file: "long.json", bytes: 0 }] };
  clips["long.json"] = clipJson("long", 45, 61);
  stubFetch();
  const heights: number[] = [];
  for (const speed of [1, 0.25, 4]) {
    const { body, pelvis } = rig();
    const animator = new RigAnimator(wide, "clips/", { speed });
    assert.equal(await animator.openPose(body, { clip: "long", time: 1.233, paused: true }, { idle: "idle" }), true);
    assert.equal(animator.timeline()!.time, 37 / 30, `frame 37 at ${speed}x`);
    heights.push(pelvis.position.y);
    assert.equal(animator.sharePose()!.time, 37 / 30, "and a share of it records the same frame");
    animator.setPaused(false);
    step(animator, 0.1);
    assert.ok(Math.abs(animator.timeline()!.time - (37 / 30 + 0.1 * speed)) < 1e-6, `plays on at ${speed}x`);
  }
  assert.ok(heights.every(h => h === heights[0]), `the same pose at every speed: ${heights}`);
});

test("the sounds are told the emote speed with the clock", async () => {
  stubFetch();
  const { body } = rig();
  const animator = new RigAnimator(manifest, "clips/", { speed: 2 });
  const rates: (number | undefined)[] = [];
  animator.sounds.update = (clock) => { if (clock) rates.push(clock.rate); };
  await animator.play(body, "wave");
  step(animator, 0.1);
  animator.setSpeed(0.25);
  step(animator, 0.1);
  assert.deepEqual([...new Set(rates)], [2, 0.25]);
});

test("facial animation switched off fetches nothing; switched on, it fetches the faces index and the clip's curves", async () => {
  const requested: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requested.push(String(url));
    const file = String(url).split("/").pop()!;
    return { ok: file in clips, status: file in clips ? 200 : 404, json: async () => clips[file] } as Response;
  }) as typeof fetch;
  const { body } = rig();
  const sourced = { ...manifest, clips: manifest.clips.map(c => ({ ...c, source: `HM_${c.id}` })) };
  const animator = new RigAnimator(sourced, "clips/", { facesUrl: "faces/index.json", face: false });
  const warn = console.warn;
  console.warn = () => {}; // the stub serves no faces index: the face then rests, with a warning
  try {
    assert.equal(animator.face.available, true, "the set has faces: the switch is offered");
    await animator.play(body, "wave");
    assert.ok(!requested.some(url => url.startsWith("faces/")), `off: no face files (${requested})`);
    assert.equal(animator.state.face, false);
    animator.setFace(true);
    assert.equal(animator.state.face, true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(requested.includes("faces/index.json"), `on: the index is fetched (${requested})`);
  } finally { console.warn = warn; }
  assert.equal(new RigAnimator(manifest, "clips/").face.available, false, "a set without faces offers no switch");
});

test("a looping emote wraps on the scaled clock and stays in front", async () => {
  stubFetch();
  const { body } = rig();
  const animator = new RigAnimator(manifest, "clips/", { loopEmote: true, speed: 2 });
  await animator.play(body, "idle");
  await animator.play(body, "wave");
  step(animator, 0.75); // 1.5 s of a 1 s clip at 2x
  assert.equal(animator.state.current, "wave");
  assert.ok(Math.abs(animator.timeline()!.time - 0.5) < 1e-6, `wrapped to 0.5 s (${animator.timeline()!.time})`);
});

// The startup race (21 Nov 2026, _docs/emote-early-stop-2026-11-21): the emote button works from the body's load, but
// the default idle starts once the outfit has loaded. An emote the viewer picked in between must stay in front: the
// idle goes under it (playUnder), to come back when the emote ends, as if the viewer had waited for the outfit.
test("the default idle started during the viewer's emote goes under it: the emote plays to its end, then the idle", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  await animator.play(body, "wave");
  step(animator, 0.4);
  assert.equal(await animator.playUnder(body, "idle"), true);
  assert.equal(animator.state.current, "wave", "the emote stays in front");
  assert.equal(animator.state.idle, "idle", "the idle runs under it");
  step(animator, 0.2);
  assert.ok(Math.abs(angle(pelvis.quaternion) - 90) < 0.05, `only the emote shows, got ${angle(pelvis.quaternion)}`);
  assert.ok(Math.abs(animator.timeline()!.time - 0.6) < 1e-6, "its clock ran on");
  step(animator, 0.45); // past its end (1 s), into the crossfade
  assert.equal(animator.state.current, "idle", "it ended into the idle");
  step(animator, 0.4);
  assert.ok(Math.abs(angle(pelvis.quaternion) - 30) < 0.05, `on the idle, got ${angle(pelvis.quaternion)}`);
  assert.equal(animator.state.moving, true);
});

test("an emote still downloading is not superseded by the idle started under it", async () => {
  stubFetch({ "wave.json": 30 });
  const { body } = rig();
  const animator = new RigAnimator(manifest, "clips/");
  const picked = animator.play(body, "wave");
  const under = animator.playUnder(body, "idle"); // the idle's file lands first
  await picked;
  assert.equal(animator.state.current, "wave", "the viewer's emote played");
  assert.equal(await under, true);
  assert.equal(animator.state.current, "wave");
  assert.equal(animator.state.idle, "idle");
  step(animator, 1.4);
  assert.equal(animator.state.current, "idle");
});

test("playUnder with nothing up plays the idle; after the viewer's stop, or with an idle already running, it does nothing", async () => {
  stubFetch();
  const { body, pelvis } = rig();
  const plain = new RigAnimator(manifest, "clips/");
  assert.equal(await plain.playUnder(body, "idle"), true);
  assert.equal(plain.state.current, "idle");
  assert.equal(await plain.playUnder(body, "idle"), false, "an idle already runs");
  plain.reset();

  stubFetch({ "idle.json": 20 });
  const stopped = new RigAnimator(manifest, "clips/");
  await stopped.play(body, "wave");
  step(stopped, 0.2);
  const under = stopped.playUnder(body, "idle");
  stopped.stop(); // the viewer stops while the idle downloads
  step(stopped, 0.5);
  assert.equal(await under, false);
  assert.equal(stopped.state.active, false, "back to the still pose");
  assert.ok(Math.abs(angle(pelvis.quaternion) - 10) < 0.05);
});
