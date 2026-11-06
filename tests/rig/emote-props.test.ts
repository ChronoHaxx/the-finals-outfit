import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { EmoteProps, type PropsManifest, type PropTemplate } from "../../src/rig/EmoteProps";
import { propClock } from "../../src/rig/RigAnimator";
import { missingSummary, missingBadge } from "../../src/components/EmotePicker";
import type { ClipInfo } from "../../src/rig/RigAnimator";

// Emote props (6 Nov 2026): when a prop shows, where it attaches, and which clock its own animation runs on. No
// browser and no GLB decoding: props.json is stubbed through fetch and templates come from an injected loader.

const SEQ = "HM_Test_Emote_00";
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
