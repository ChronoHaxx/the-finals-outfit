import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { EmoteProps, sampleCurve, type PropsManifest, type PropTemplate } from "../../src/rig/EmoteProps";
import { propClock } from "../../src/rig/RigAnimator";
import { missingSummary, missingBadge } from "../../src/components/EmotePicker";
import type { ClipInfo } from "../../src/rig/RigAnimator";

// Emote props (6 Nov 2026): when a prop shows, where it attaches, and which clock its own animation runs on. No
// browser and no GLB decoding: props.json is stubbed through fetch and templates come from an injected loader.

const SEQ = "HM_Test_Emote_00";
const SEQ_TRANSFORMS = "HM_Test_Emote_Transforms_00";
const SEQ_CURVE = "HM_Test_Emote_Curve_00";
// A CurveDrivenTransformPrefix window (Rocking Chair's mirrored gun): keys at frames 0 and 30 (1 s), x from 0.5 to 1.5 m
// and a quarter turn about z, under a notify that offsets 1 m and mirrors x.
const curve = { prefix: "Prop01", frameTime: 1 / 30, frames: 31,
  translation: [[0, 30], [0.5, 0, 0, 1.5, 0, 0]] as [number[], number[]],
  rotation: [[0, 30], [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2]] as [number[], number[]] };
const manifest: PropsManifest = {
  formatVersion: 1,
  sockets: { item_attach: { bone: "hand_r", translation: [0.1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
  actors: {
    Bat: { file: "Bat.glb", bytes: 1, kind: "static" },
    Wings: { file: "Wings.glb", bytes: 1, kind: "skeletal", animated: true, clock: "emote-curve" },
    Teddy: { file: "Teddy.glb", bytes: 1, kind: "skeletal", animated: true, clock: "spawn" },
  },
  emotes: {
    [SEQ]: [
      { actor: "Bat", socket: "prop_01", start: 1, duration: 2, shown: true },
      { actor: "Wings", socket: null, start: 0.5, duration: 5, shown: true },
      { actor: "Teddy", socket: "item_attach", start: 1, duration: 3, shown: true },
      { actor: "Sparks_FX", socket: null, start: 0, duration: 1, shown: false },
    ],
    // The spawn notify's RelativeTransform (football: scale 0.16; office chair: 90 degrees), next to a plain spawn of the
    // same actor on the same socket, and a socket on a bone chain under the root (ik_hand_root > ik_hand_l).
    [SEQ_TRANSFORMS]: [
      { actor: "Bat", socket: "prop_01", start: 0, duration: 4, shown: true,
        transform: { translation: [0.3, 0, 0], rotation: [0.7071068, 0, 0, 0.7071068], scale: [0.16, 0.16, 0.16] } },
      { actor: "Bat", socket: "prop_01", start: 0, duration: 4, shown: true },
      { actor: "Bat", socket: "ik_hand_l", start: 0, duration: 4, shown: true },
    ],
    [SEQ_CURVE]: [
      { actor: "Bat", socket: null, start: 0, duration: 4, shown: true, curve,
        transform: { translation: [-1, 0, 0], scale: [-1, 1, 1] } },
    ],
  },
};
globalThis.fetch = (async () => ({ ok: true, json: async () => manifest })) as unknown as typeof fetch;

// A template whose one node's x position equals the animation time it was set to (track: x = t over 0..10 s).
function template(name: string, animated: boolean): PropTemplate {
  const scene = new THREE.Group();
  const part = new THREE.Object3D();
  part.name = `${name}_part`;
  scene.add(part);
  const clips = animated ? [new THREE.AnimationClip(name, 10, [
    new THREE.VectorKeyframeTrack(`${name}_part.position`, [0, 10], [0, 0, 0, 10, 0, 0])])] : [];
  return { scene, clips };
}
const loaded: string[] = [];
const loader = async (href: string) => {
  const name = href.split("/").pop()!.replace(".glb", "");
  loaded.push(name);
  return template(name, name !== "Bat");
};

// A body with the bones props hang from: armature > root > spine_03 > hand_r.
function body() {
  const scene = new THREE.Group();
  const armature = new THREE.Object3D(); armature.name = "Armature";
  const root = new THREE.Bone(); root.name = "root";
  const spine = new THREE.Bone(); spine.name = "spine_03"; spine.position.set(0, 1.4, 0);
  const hand = new THREE.Bone(); hand.name = "hand_r"; hand.position.set(0.5, 0, 0);
  scene.add(armature); armature.add(root); root.add(spine); spine.add(hand);
  return { scene, armature, spine, hand };
}
const attachBones = [
  { name: "weapon_buffer", parent: "spine_03", position: [0, 0, 0], quaternion: [0.4609229, -0.5362369, 0.5362369, -0.4609229] },
  { name: "prop_01", parent: "weapon_buffer", position: [0.00731, 0, -1.2487], quaternion: [0, 0, 0, 1] },
];
const componentSpace = { under: "root", quaternion: [-0.7071068, 0, 0, 0.7071068] };

async function ready() {
  const props = new EmoteProps("http://test/animations/props/props.json", attachBones, componentSpace, loader);
  const rig = body();
  props.attach(rig.scene);
  await props.prepare(SEQ);
  return { props, ...rig };
}
const propNamed = (scene: THREE.Object3D, actor: string) => scene.getObjectByName(`emote-prop:${actor}`) ?? null;
const shown = (o: THREE.Object3D | null) => { let v = !!o; for (let p = o; p && v; p = p.parent) v = p.visible; return v; };

test("attach adds the clip-animated attach bones and UE component space; detach removes every added node", async () => {
  const { props, scene, spine, armature } = await ready();
  const buffer = spine.getObjectByName("weapon_buffer")!;
  assert.ok(buffer, "weapon_buffer under spine_03");
  assert.equal(buffer.getObjectByName("prop_01")?.parent, buffer);
  assert.ok(Math.abs(buffer.quaternion.x - 0.4609229) < 1e-6);
  const component = armature.getObjectByName("emote-props:component-space")!;
  assert.equal(component.parent, armature, "component space is a sibling of the root bone");
  assert.ok(Math.abs(component.quaternion.x + 0.7071068) < 1e-6);
  props.setEmote(SEQ);
  props.update(2);
  assert.ok(propNamed(scene, "Bat"));
  props.detach();
  for (const name of ["weapon_buffer", "prop_01", "emote-props:component-space", "emote-props:socket:item_attach"])
    assert.equal(scene.getObjectByName(name), undefined, `${name} removed`);
  assert.equal(propNamed(scene, "Bat"), null, "props removed");
});

test("a prop shows only inside its notify window, on its socket; effect-only actors are never loaded", async () => {
  const { props, scene, hand } = await ready();
  assert.deepEqual(loaded.filter(n => n === "Sparks_FX"), []);
  props.setEmote(SEQ);
  props.update(0.6);
  assert.equal(shown(propNamed(scene, "Bat")), false, "before its window");
  assert.equal(shown(propNamed(scene, "Wings")), true);
  props.update(1.5);
  const bat = propNamed(scene, "Bat")!;
  assert.equal(bat.parent?.name, "prop_01", "attached to the clip-animated bone");
  const teddy = propNamed(scene, "Teddy")!;
  assert.equal(teddy.parent?.name, "emote-props:socket:item_attach");
  assert.equal(teddy.parent?.parent, hand, "a skeleton socket is an offset node under its bone");
  assert.ok(Math.abs(teddy.parent!.position.x - 0.1) < 1e-9);
  assert.equal(propNamed(scene, "Wings")!.parent?.name, "emote-props:component-space", "no socket: the character origin");
  props.update(3.2);
  assert.equal(shown(bat), false, "after its window");
  assert.equal(shown(teddy), true);
});

test("skeletal props run on the emote's PropAnimSequenceTime or from spawn, set (not stepped) so a frame repeats", async () => {
  const { props, scene } = await ready();
  props.setEmote(SEQ, () => 0.22); // the Ace Pilot wings: the curve unfolds to 0.22 s and holds
  props.update(2.5);
  const wings = scene.getObjectByName("Wings_part")!, teddy = scene.getObjectByName("Teddy_part")!;
  assert.ok(Math.abs(wings.position.x - 0.22) < 1e-6, `curve clock: ${wings.position.x}`);
  assert.ok(Math.abs(teddy.position.x - 1.5) < 1e-6, `spawn clock: ${teddy.position.x}`);
  props.update(2.5);
  assert.ok(Math.abs(teddy.position.x - 1.5) < 1e-6, "the same time gives the same pose (paused frames converge)");
  props.update(2.0);
  assert.ok(Math.abs(teddy.position.x - 1.0) < 1e-6, "seeking back works");
});

test("a notify transform places that spawn only: not the socket node, the template, or another spawn of the actor", async () => {
  const bones = [...attachBones,
    { name: "ik_hand_root", parent: "root", position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    { name: "ik_hand_l", parent: "ik_hand_root", position: [0.2, 1, 0], quaternion: [0, 0, 0, 1] }];
  const props = new EmoteProps("http://test/animations/props/props.json", bones, componentSpace, loader);
  const rig = body();
  props.attach(rig.scene);
  await props.prepare(SEQ_TRANSFORMS);
  props.setEmote(SEQ_TRANSFORMS);
  props.update(1);
  const prop01 = rig.scene.getObjectByName("prop_01")!;
  const onProp01 = prop01.children.filter(c => c.name === "emote-prop:Bat");
  assert.equal(onProp01.length, 2, "both spawns hang from prop_01 itself");
  const [moved, plain] = onProp01;
  assert.deepEqual(moved.position.toArray().map(v => +v.toFixed(6)), [0.3, 0, 0]);
  assert.ok(Math.abs(moved.quaternion.x - 0.7071068) < 1e-6 && Math.abs(moved.quaternion.w - 0.7071068) < 1e-6, "90 degrees about x");
  assert.deepEqual(moved.scale.toArray().map(v => +v.toFixed(6)), [0.16, 0.16, 0.16]);
  assert.deepEqual([plain.position.toArray(), plain.quaternion.toArray(), plain.scale.toArray()], [[0, 0, 0], [0, 0, 0, 1], [1, 1, 1]],
    "a spawn without a transform stays at the socket");
  assert.deepEqual(prop01.scale.toArray(), [1, 1, 1], "the shared socket bone is not scaled");
  assert.ok(Math.abs(prop01.position.z + 1.2487) < 1e-9, "nor moved");
  const ik = rig.scene.getObjectByName("ik_hand_l")!;
  assert.equal(ik.parent?.name, "ik_hand_root", "an attach bone chain under the root is added parent first");
  assert.equal(ik.parent?.parent?.name, "root");
  assert.equal(ik.children.filter(c => c.name === "emote-prop:Bat").length, 1, "its prop hangs there, not at the character origin");
  props.detach();
});

test("a curve-driven prop is moved every frame by curve x notify, under the character's component space", async () => {
  const props = new EmoteProps("http://test/animations/props/props.json", attachBones, componentSpace, loader);
  const rig = body();
  props.attach(rig.scene);
  await props.prepare(SEQ_CURVE);
  props.setEmote(SEQ_CURVE);
  const expected = (time: number) => sampleCurve(curve, time).multiply(new THREE.Matrix4().compose(
    new THREE.Vector3(-1, 0, 0), new THREE.Quaternion(), new THREE.Vector3(-1, 1, 1)));
  const close = (a: THREE.Matrix4, b: THREE.Matrix4) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-6);
  props.update(0);
  const gun = rig.scene.getObjectByName("emote-prop:Bat")!;
  assert.equal(gun.parent?.name, "emote-props:component-space", "no socket: the curve frame is the character's component space");
  assert.ok(close(gun.matrix, expected(0)));
  // Frame 0: curve at x 0.5, no turn; the notify's -1 m lands the mirrored gun at x -0.5, mirror kept.
  assert.ok(Math.abs(gun.matrix.elements[12] + 0.5) < 1e-6);
  assert.ok(gun.matrix.determinant() < 0, "the mirror (scale -1) survives");
  props.update(0.5); // halfway: x 1.0, 45 degrees
  assert.ok(close(gun.matrix, expected(0.5)));
  const q = new THREE.Quaternion(); sampleCurve(curve, 0.5).decompose(new THREE.Vector3(), q, new THREE.Vector3());
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(2 * Math.acos(q.w)) - 45) < 1e-4, "slerped between the keys");
  props.update(3); // past the last key (1 s): held
  assert.ok(close(gun.matrix, expected(1)));
  gun.updateMatrixWorld(true);
  assert.ok(close(gun.matrix, expected(1)), "a scene update keeps the set matrix (no position/rotation/scale rebuild)");
  props.detach();
});

test("hidden for still-pose draws, back afterwards only inside the window; a new emote drops the old props", async () => {
  const { props, scene } = await ready();
  props.setEmote(SEQ);
  props.update(1.5);
  props.setHidden(true);
  assert.equal(shown(propNamed(scene, "Bat")), false);
  props.setHidden(false);
  assert.equal(shown(propNamed(scene, "Bat")), true);
  props.update(3.5);
  props.setHidden(true); props.setHidden(false);
  assert.equal(shown(propNamed(scene, "Bat")), false, "unhiding does not show a prop outside its window");
  props.setEmote(null);
  assert.equal(propNamed(scene, "Bat"), null);
  assert.equal(propNamed(scene, "Teddy"), null);
});

test("the prop clock interpolates the curve keys and holds both ends", () => {
  const clock = propClock({ frameTime: 1 / 30, propTime: [[0, 30, 60], [0, 0, 1]] })!;
  assert.equal(clock(-1), 0);
  assert.equal(clock(0.5), 0);
  assert.ok(Math.abs(clock(1.5) - 0.5) < 1e-9);
  assert.equal(clock(5), 1);
  assert.equal(propClock({ frameTime: 1 / 30 }), null);
});

test("the picker says only what is still missing once props.json says which props are shown", async () => {
  const { props } = await ready();
  const info = { id: "test", label: "Test", kind: "emote", loop: false, duration: 5, file: "x.json", bytes: 0, source: SEQ,
    emote: { props: ["Bat", "Teddy", "Wings", "BP_Emote_Smoke_Prop"], fx: ["Sparks_FX"] } } as ClipInfo;
  assert.match(missingSummary(info) ?? "", /props \(Bat, Teddy, Wings, Smoke\) and effects/, "without props.json: all listed");
  assert.equal(missingSummary(info, props), "Not shown: prop (Smoke) and effects");
  assert.equal(missingBadge(info, props), "Prop");
  const complete = { ...info, emote: { props: ["Bat"], fx: [] } } as ClipInfo;
  assert.equal(missingSummary(complete, props), null);
  assert.equal(missingBadge(complete, props), null);
});
